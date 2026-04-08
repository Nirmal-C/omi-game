// omi-game/src/roomManager.js
const { v4: uuidv4 } = require('uuid');
const { dealHands, trickWinner, getValidCards, scoreRound, SUIT_NAMES } = require('./gameLogic');

const rooms = new Map();

function createRoom() {
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  const room = {
    code,
    id: uuidv4(),
    players: [], // [{id, name, ws, seatIndex, connected}]
    state: 'waiting', // waiting | trump_select | playing | round_end | game_over
    game: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code.toUpperCase());
}

function broadcast(room, msg, excludeId = null) {
  for (const p of room.players) {
    if (p.id !== excludeId && p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(msg));
    }
  }
}

function sendTo(player, msg) {
  if (player.ws && player.ws.readyState === 1) {
    player.ws.send(JSON.stringify(msg));
  }
}

function sendGameState(room) {
  // Send each player their personalised view
  for (const player of room.players) {
    const state = buildPlayerView(room, player.seatIndex);
    sendTo(player, { type: 'game_state', state });
  }
}

function buildPlayerView(room, seatIndex) {
  const g = room.game;
  if (!g) return null;

  const view = {
    phase: room.state,
    seatIndex,
    players: room.players.map(p => ({
      name: p.name,
      seat: p.seatIndex,
      connected: p.connected,
      trickCount: g.trickCounts[p.seatIndex % 2 === 0 ? 0 : 1], // approximate per-team
    })),
    dealerSeat: g.dealerSeat,
    trumpChooserSeat: g.trumpChooserSeat,
    trumpSuit: g.trumpSuit,
    currentTrick: g.currentTrick,
    currentTurn: g.currentTurn,
    trickCounts: g.trickCounts,
    teamTokens: g.teamTokens,
    pendingToken: g.pendingToken,
    lastTrickWinner: g.lastTrickWinner,
    lastTrickCards: g.lastTrickCards,
    roundResult: g.roundResult,
    hand: g.hands[seatIndex] || [],
    validCards: g.phase === 'playing' && g.currentTurn === seatIndex
      ? getValidCards(g.hands[seatIndex], g.leadSuit)
      : [],
    needsTrumpSelect: room.state === 'trump_select' && g.currentTurn === seatIndex,
    firstBatchHand: g.phase === 'trump_select' ? g.firstBatch[seatIndex] : null,
    gameOver: g.gameOver,
    winner: g.winner,
  };
  return view;
}

function startRound(room) {
  const g = room.game;
  g.dealerSeat = (g.dealerSeat - 1 + 4) % 4; // dealer moves right (counter-clockwise)
  g.trumpChooserSeat = (g.dealerSeat - 1 + 4) % 4; // player to dealer's right
  g.currentTurn = g.trumpChooserSeat;

  const { firstBatch, fullHands } = dealHands(g.dealerSeat);
  g.firstBatch = firstBatch;
  g.hands = fullHands;
  g.trumpSuit = null;
  g.currentTrick = [];
  g.trickCounts = { 0: 0, 1: 0 };
  g.leadSuit = null;
  g.trickNumber = 0;
  g.lastTrickWinner = null;
  g.lastTrickCards = null;
  g.roundResult = null;
  g.phase = 'trump_select';

  room.state = 'trump_select';
  sendGameState(room);

  broadcast(room, {
    type: 'message',
    text: `New round! ${room.players.find(p => p.seatIndex === g.trumpChooserSeat)?.name} chooses trumps.`
  });
}

function handleAction(ws, data) {
  const room = findRoomByWs(ws);
  if (!room) return;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;

  switch (data.action) {
    case 'choose_trump': {
      if (room.state !== 'trump_select') return;
      if (room.game.currentTurn !== player.seatIndex) return;
      const suit = data.suit;
      if (!['♠','♥','♦','♣'].includes(suit)) return;

      room.game.trumpSuit = suit;
      room.game.trumpChooserTeam = player.seatIndex % 2 === 0 ? 0 : 1;
      room.game.phase = 'playing';
      room.game.currentTurn = room.game.trumpChooserSeat; // trump chooser leads first
      room.state = 'playing';

      broadcast(room, {
        type: 'message',
        text: `${player.name} chose ${SUIT_NAMES[suit]} ${suit} as trumps! ${player.name} leads first.`
      });
      sendGameState(room);
      break;
    }

    case 'play_card': {
      if (room.state !== 'playing') return;
      const g = room.game;
      if (g.currentTurn !== player.seatIndex) return;

      const cardId = data.cardId;
      const handIdx = g.hands[player.seatIndex].findIndex(c => c.id === cardId);
      if (handIdx === -1) return;

      const validIds = getValidCards(g.hands[player.seatIndex], g.leadSuit);
      if (!validIds.includes(cardId)) return;

      const card = g.hands[player.seatIndex].splice(handIdx, 1)[0];

      if (g.currentTrick.length === 0) {
        g.leadSuit = card.suit;
      }
      g.currentTrick.push({ playerIndex: player.seatIndex, card });

      broadcast(room, {
        type: 'message',
        text: `${player.name} played ${card.rank}${card.suit}`
      });

      if (g.currentTrick.length === 4) {
        // Resolve trick
        const winnerSeat = trickWinner(g.currentTrick, g.leadSuit, g.trumpSuit);
        const winnerTeam = winnerSeat % 2 === 0 ? 0 : 1;
        g.trickCounts[winnerTeam]++;
        g.lastTrickWinner = winnerSeat;
        g.lastTrickCards = [...g.currentTrick];
        g.trickNumber++;

        const winnerPlayer = room.players.find(p => p.seatIndex === winnerSeat);
        broadcast(room, {
          type: 'message',
          text: `${winnerPlayer?.name || 'Player'} wins the trick! (Team ${winnerTeam === 0 ? 'A' : 'B'}: ${g.trickCounts[winnerTeam]} tricks)`
        });

        // Short pause then clear trick
        setTimeout(() => {
          g.currentTrick = [];
          g.leadSuit = null;

          if (g.trickNumber === 8) {
            // Round over
            endRound(room);
          } else {
            g.currentTurn = winnerSeat;
            sendGameState(room);
          }
        }, 1800);

        sendGameState(room);
      } else {
        // Next player counter-clockwise
        g.currentTurn = (player.seatIndex - 1 + 4) % 4;
        sendGameState(room);
      }
      break;
    }

    case 'next_round': {
      if (room.state !== 'round_end') return;
      if (!room.game.gameOver) {
        startRound(room);
      }
      break;
    }
  }
}

function endRound(room) {
  const g = room.game;
  const result = scoreRound(g.trickCounts, g.trumpChooserTeam);
  g.roundResult = result;
  room.state = 'round_end';

  let tokensToAward = result.tokens;
  if (g.pendingToken) {
    tokensToAward += 1;
    g.pendingToken = false;
  }

  if (result.draw) {
    g.pendingToken = true;
    broadcast(room, { type: 'message', text: `4-4 draw! An extra token next round.` });
  } else {
    g.teamTokens[result.winner] += tokensToAward;
    const teamName = result.winner === 0 ? 'Team A (N/S)' : 'Team B (E/W)';
    const msg = result.kapothi
      ? `KAPOTHI! ${teamName} won all 8 tricks! +${tokensToAward} tokens!`
      : `${teamName} wins the round! +${tokensToAward} token${tokensToAward > 1 ? 's' : ''}.`;
    broadcast(room, { type: 'message', text: msg });

    // Check game over (10+ tokens)
    if (g.teamTokens[0] >= 10 || g.teamTokens[1] >= 10) {
      g.gameOver = true;
      g.winner = g.teamTokens[0] >= 10 ? 0 : 1;
      room.state = 'game_over';
      const winTeam = g.winner === 0 ? 'Team A (N/S)' : 'Team B (E/W)';
      broadcast(room, { type: 'message', text: `🎉 GAME OVER! ${winTeam} wins with ${g.teamTokens[g.winner]} tokens!` });
    }
  }

  sendGameState(room);
}

function handleJoin(ws, data) {
  let room;
  if (data.create) {
    room = createRoom();
  } else {
    room = getRoom(data.code);
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', text: 'Room not found. Check the code and try again.' }));
      return;
    }
  }

  if (room.players.length >= 4 && !data.rejoin) {
    ws.send(JSON.stringify({ type: 'error', text: 'Room is full (4 players max).' }));
    return;
  }

  // Reconnection logic
  const existing = room.players.find(p => p.name === data.name && !p.connected);
  if (existing) {
    existing.ws = ws;
    existing.connected = true;
    ws._playerId = existing.id;
    ws._roomCode = room.code;
    sendTo(existing, { type: 'joined', code: room.code, seat: existing.seatIndex, name: existing.name });
    broadcast(room, { type: 'message', text: `${existing.name} reconnected.` }, existing.id);
    sendGameState(room);
    return;
  }

  const seatIndex = room.players.length;
  const playerId = uuidv4();
  const player = {
    id: playerId,
    name: data.name || `Player ${seatIndex + 1}`,
    ws,
    seatIndex,
    connected: true,
  };
  room.players.push(player);
  ws._playerId = playerId;
  ws._roomCode = room.code;

  sendTo(player, { type: 'joined', code: room.code, seat: seatIndex, name: player.name });
  broadcast(room, { type: 'player_joined', players: room.players.map(p => ({ name: p.name, seat: p.seatIndex, connected: p.connected })) });
  broadcast(room, { type: 'message', text: `${player.name} joined (seat ${seatIndex + 1}/4).` });

  if (room.players.length === 4 && !room.game) {
    // Auto-start game
    initGame(room);
  }
}

function initGame(room) {
  const dealerSeat = Math.floor(Math.random() * 4);
  room.game = {
    dealerSeat: (dealerSeat + 1) % 4, // will be decremented in startRound
    trumpChooserSeat: null,
    trumpChooserTeam: null,
    trumpSuit: null,
    hands: [[], [], [], []],
    firstBatch: [[], [], [], []],
    currentTrick: [],
    leadSuit: null,
    currentTurn: 0,
    trickCounts: { 0: 0, 1: 0 },
    teamTokens: { 0: 0, 1: 0 },
    pendingToken: false,
    trickNumber: 0,
    lastTrickWinner: null,
    lastTrickCards: null,
    roundResult: null,
    phase: 'trump_select',
    gameOver: false,
    winner: null,
  };
  broadcast(room, { type: 'message', text: `All 4 players joined! Game starting...` });
  setTimeout(() => startRound(room), 1000);
}

function handleDisconnect(ws) {
  const room = findRoomByWs(ws);
  if (!room) return;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;
  player.connected = false;
  player.ws = null;
  broadcast(room, { type: 'message', text: `${player.name} disconnected. They can rejoin with code ${room.code}.` });
  sendGameState(room);
}

function findRoomByWs(ws) {
  if (!ws._roomCode) return null;
  return rooms.get(ws._roomCode);
}

module.exports = { handleJoin, handleAction, handleDisconnect };
