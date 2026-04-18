// omi-game/src/roomManager.js
const { v4: uuidv4 } = require('uuid');
const { buildDeck, shuffle, cutDeck, trickWinner, getValidCards, scoreRound, SUIT_NAMES } = require('./gameLogic');

const rooms = new Map();

function dealToSeat(game, seatIndex, count) {
  const start = game.deckIndex;
  const end = start + count;
  const slice = game.deck.slice(start, end);
  game.hands[seatIndex].push(...slice);
  game.deckIndex = end;
  return slice;
}

function broadcastWaitingPlayers(room) {
  broadcast(room, {
    type: 'player_joined',
    players: room.players.map(p => ({ name: p.name, seat: p.seatIndex, connected: p.connected }))
  });
}

function findPlayerByNameDisconnected(room, name) {
  if (!name) return null;
  return room.players.find(p => p.name === name && !p.connected);
}

function findAvailableSeat(room) {
  for (let seat = 0; seat < 4; seat++) {
    const p = room.players.find(x => x.seatIndex === seat);
    if (!p) return seat;
    if (!p.connected) return seat;
  }
  return null;
}

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
    kapothiDeclared: g.kapothiDeclared,
    kapothiDecisionTeam: g.kapothiDecisionTeam,
    needsKapothiDecide: room.state === 'kapothi_decision' && (seatIndex % 2 === 0 ? 0 : 1) === g.kapothiDecisionTeam,
    hand: g.hands[seatIndex] || [],
    // During trump_select, hands not yet fully dealt show 0 — use firstBatch length as fallback
    handCounts: g.hands.map((h, i) =>
      h.length > 0 ? h.length : (g.firstBatch && g.firstBatch[i] ? g.firstBatch[i].length : 0)
    ),
    validCards: room.state === 'playing' && g.currentTurn === seatIndex
      ? getValidCards(g.hands[seatIndex], g.leadSuit)
      : [],
    needsTrumpSelect: room.state === 'trump_select' && g.currentTurn === seatIndex,
    needsHalfCourtTrumpSelect: room.state === 'half_court_select' && g.currentTurn === seatIndex,
    firstBatchHand: ['trump_select', 'half_court_offer', 'half_court_select'].includes(room.state) ? g.firstBatch[seatIndex] : null,
    halfCourtDeclarer: g.halfCourtDeclarer,
    halfCourtDeclarerTeam: g.halfCourtDeclarerTeam,
    halfCourtPassed: g.halfCourtPassed || [],
    needsHalfCourtDecide: room.state === 'half_court_offer' && !(g.halfCourtPassed || []).includes(seatIndex),
    gameOver: g.gameOver,
    winner: g.winner,
  };
  return view;
}

function startRound(room) {
  const g = room.game;
  g._startingRound = false; // clear the double-trigger lock
  g.dealerSeat = (g.dealerSeat - 1 + 4) % 4; // dealer moves right (counter-clockwise)
  g.trumpChooserSeat = (g.dealerSeat - 1 + 4) % 4; // player to dealer's right
  g.currentTurn = g.trumpChooserSeat;

  // Deck prep: dealer shuffles, dealer's left cuts into 2 or 3 piles, dealer re-stacks.
  const cutterSeat = (g.dealerSeat + 1) % 4;
  const cutParts = Math.random() < 0.5 ? 2 : 3;
  g.deck = cutDeck(shuffle(buildDeck()), cutParts);
  g.deckIndex = 0;

  // Deal first 4 cards to ALL players counter-clockwise from dealer's right.
  // Everyone sees their 4 cards for the Half Court offer.
  // If the game proceeds to normal trump select, the second batch is dealt then.
  g.hands = [[], [], [], []];
  g.firstBatch = [null, null, null, null];

  const dealOrder = [];
  for (let i = 0; i < 4; i++) dealOrder.push((g.dealerSeat - 1 - i + 8) % 4);
  for (const seat of dealOrder) {
    g.firstBatch[seat] = dealToSeat(g, seat, 4);
  }

  g.trumpSuit = null;
  g.currentTrick = [];
  g.trickCounts = { 0: 0, 1: 0 };
  g.leadSuit = null;
  g.trickNumber = 0;
  g.maxTricks = 8;
  g.lastTrickWinner = null;
  g.lastTrickCards = null;
  g.roundResult = null;
  g.consecutiveWins = { team: -1, count: 0 };
  g.kapothiDeclared = null;
  g.kapothiDecisionTeam = null;
  g.kapothiOffered = false;
  g.pendingKapothiTurn = null;
  g.halfCourtDeclarer = null;
  g.halfCourtDeclarerTeam = null;
  g.halfCourtPassed = [];
  g.phase = 'half_court_offer';

  room.state = 'half_court_offer';
  sendGameState(room);

  broadcast(room, {
    type: 'message',
    text: `New round! Dealer shuffled, ${room.players.find(p => p.seatIndex === cutterSeat)?.name || 'the left player'} cut (${cutParts} parts). ` +
      `Each player has 4 cards — anyone can declare Half Court!`
  });
}

function handleAction(ws, data) {
  const room = findRoomByWs(ws);
  if (!room) return;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;

  switch (data.action) {
    case 'choose_trump': {
      if (room.state !== 'trump_select' && room.state !== 'half_court_select') return;
      if (room.game.currentTurn !== player.seatIndex) return;
      const suit = data.suit;
      if (!['♠','♥','♦','♣'].includes(suit)) return;

      const g = room.game;
      const isHalfCourt = room.state === 'half_court_select';

      if (!isHalfCourt) {
        // Normal game: finish dealing second batch to all players.
        // (All players already have first 4 from startRound, so firstBatch checks are no-ops.)
        const trumpChooserMateSeat = (g.trumpChooserSeat + 2) % 4;
        if (!g.firstBatch[trumpChooserMateSeat]) {
          g.firstBatch[trumpChooserMateSeat] = dealToSeat(g, trumpChooserMateSeat, 4);
        }
        if (!g.firstBatch[g.dealerSeat]) {
          g.firstBatch[g.dealerSeat] = dealToSeat(g, g.dealerSeat, 4);
        }
        const order = [
          (g.dealerSeat - 1 + 4) % 4,
          (g.dealerSeat - 2 + 4) % 4,
          (g.dealerSeat - 3 + 4) % 4,
          g.dealerSeat,
        ];
        for (const seat of order) {
          dealToSeat(g, seat, 4);
        }
      }
      // Half Court: no additional dealing — everyone plays with their 4 cards only.

      g.trumpSuit = suit;
      g.trumpChooserTeam = player.seatIndex % 2 === 0 ? 0 : 1;
      g.phase = 'playing';
      g.currentTurn = isHalfCourt ? g.halfCourtDeclarer : g.trumpChooserSeat;
      room.state = 'playing';

      broadcast(room, {
        type: 'message',
        text: isHalfCourt
          ? `${player.name} chose ${SUIT_NAMES[suit]} ${suit} as trumps for Half Court! ${player.name} leads first.`
          : `${player.name} chose ${SUIT_NAMES[suit]} ${suit} as trumps! ${player.name} leads first.`
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

        // Track consecutive wins for Kapothi trigger
        if (g.consecutiveWins.team === winnerTeam) {
          g.consecutiveWins.count++;
        } else {
          g.consecutiveWins = { team: winnerTeam, count: 1 };
        }
        const triggerKapothi = g.consecutiveWins.count === 4
          && !g.kapothiOffered
          && g.kapothiDeclared === null
          && g.halfCourtDeclarerTeam === null   // no Kapothi during Half Court
          && g.trickNumber < g.maxTricks;

        // Early round end conditions:
        // - Normal play: one team secured 5 tricks (mathematically decided)
        // - Kapothi declared: opponent wins even 1 trick
        // - Half Court declared: opponent wins even 1 trick
        const earlyRoundEnd =
          (g.halfCourtDeclarerTeam === null && g.kapothiDeclared === null && (g.trickCounts[0] >= 5 || g.trickCounts[1] >= 5)) ||
          (g.kapothiDeclared !== null && g.trickCounts[1 - g.kapothiDeclared] >= 1) ||
          (g.halfCourtDeclarerTeam !== null && g.trickCounts[1 - g.halfCourtDeclarerTeam] >= 1);

        // Short pause then clear trick
        setTimeout(() => {
          g.currentTrick = [];
          g.leadSuit = null;

          if (g.trickNumber === g.maxTricks || earlyRoundEnd) {
            // Round over
            endRound(room);
          } else if (triggerKapothi && !earlyRoundEnd) {
            g.kapothiOffered = true;
            g.kapothiDecisionTeam = winnerTeam;
            g.pendingKapothiTurn = winnerSeat;
            room.state = 'kapothi_decision';
            g.phase = 'kapothi_decision';
            const teamName = winnerTeam === 0 ? 'Team A' : 'Team B';
            broadcast(room, { type: 'message', text: `${teamName} won 4 consecutive tricks! They must decide: go for Kapothi?` });
            sendGameState(room);
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

    case 'half_court_pass': {
      if (room.state !== 'half_court_offer') return;
      const g = room.game;
      if (g.halfCourtPassed.includes(player.seatIndex)) return;

      g.halfCourtPassed.push(player.seatIndex);
      broadcast(room, { type: 'message', text: `${player.name} passed on Half Court.` });

      if (g.halfCourtPassed.length === 4) {
        // All passed — continue to normal trump select
        g.phase = 'trump_select';
        room.state = 'trump_select';
        g.currentTurn = g.trumpChooserSeat;
        const chooserName = room.players.find(p => p.seatIndex === g.trumpChooserSeat)?.name || 'Trump chooser';
        broadcast(room, { type: 'message', text: `All players passed. ${chooserName} chooses the trump suit.` });
      }
      sendGameState(room);
      break;
    }

    case 'half_court_declare': {
      if (room.state !== 'half_court_offer') return;
      const g = room.game;

      g.halfCourtDeclarer = player.seatIndex;
      g.halfCourtDeclarerTeam = player.seatIndex % 2 === 0 ? 0 : 1;
      g.maxTricks = 4;
      g.currentTurn = player.seatIndex;
      room.state = 'half_court_select';
      g.phase = 'half_court_select';

      broadcast(room, {
        type: 'message',
        text: `${player.name} declared HALF COURT! They choose trumps and their team must win all 4 tricks!`
      });
      sendGameState(room);
      break;
    }

    case 'kapothi_decide': {
      if (room.state !== 'kapothi_decision') return;
      const g = room.game;
      const playerTeam = player.seatIndex % 2 === 0 ? 0 : 1;
      if (playerTeam !== g.kapothiDecisionTeam) return; // only the deciding team

      if (data.declare) {
        g.kapothiDeclared = g.kapothiDecisionTeam;
        const isChooser = g.kapothiDeclared === g.trumpChooserTeam;
        broadcast(room, {
          type: 'message',
          text: `${player.name}'s team declared KAPOTHI! They must win all 8 tricks or give 3 tokens to the opponent! Bonus: +${isChooser ? 1 : 2} extra token${isChooser ? '' : 's'} on success.`
        });
      } else {
        broadcast(room, { type: 'message', text: `${player.name}'s team declined Kapothi. Normal play continues.` });
      }

      g.kapothiDecisionTeam = null;
      g.currentTurn = g.pendingKapothiTurn;
      g.pendingKapothiTurn = null;
      room.state = 'playing';
      g.phase = 'playing';
      sendGameState(room);
      break;
    }

    case 'next_round': {
      if (room.state !== 'round_end') return;
      if (room.game.gameOver) return;
      if (room.game._startingRound) return; // prevent double-trigger
      room.game._startingRound = true;
      startRound(room);
      break;
    }
  }
}

function endRound(room) {
  const g = room.game;
  const result = scoreRound(g.trickCounts, g.trumpChooserTeam, g.kapothiDeclared, g.halfCourtDeclarerTeam);
  g.roundResult = result;
  room.state = 'round_end';
  g.phase = 'round_end';

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
    let msg;
    if (result.halfCourt && result.halfCourtFailed) {
      const failTeam = result.winner === 0 ? 'Team B' : 'Team A';
      msg = `HALF COURT FAILED! ${failTeam} couldn't win all 4 tricks — ${teamName} gets ${tokensToAward} token${tokensToAward > 1 ? 's' : ''}!`;
    } else if (result.halfCourt) {
      msg = `HALF COURT! ${teamName} won all 4 tricks! +${tokensToAward} tokens!`;
    } else if (result.kapothiDeclared && result.kapothiFailed) {
      const loserTeam = result.winner === 0 ? 'Team B' : 'Team A';
      msg = `KAPOTHI FAILED! ${loserTeam} couldn't win all 8 tricks — ${teamName} gets ${tokensToAward} token${tokensToAward > 1 ? 's' : ''}!`;
    } else if (result.kapothiDeclared) {
      msg = `DECLARED KAPOTHI! ${teamName} won all 8 tricks! +${tokensToAward} tokens!`;
    } else if (result.kapothi) {
      msg = `KAPOTHI! ${teamName} won all 8 tricks! +${tokensToAward} tokens!`;
    } else {
      msg = `${teamName} wins the round! +${tokensToAward} token${tokensToAward > 1 ? 's' : ''}.`;
    }
    broadcast(room, { type: 'message', text: msg });

    // Check game over (10+ tokens)
    if (g.teamTokens[0] >= 10 || g.teamTokens[1] >= 10) {
      g.gameOver = true;
      g.winner = g.teamTokens[0] >= 10 ? 0 : 1;
      room.state = 'game_over';
      g.phase = 'game_over';
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

  // Reconnection logic — try token first, then fall back to name match
  let existing = null;
  if (data.rejoinToken) {
    existing = room.players.find(p => p.rejoinToken === data.rejoinToken && !p.connected);
  }
  if (!existing) {
    existing = findPlayerByNameDisconnected(room, data.name);
  }
  if (existing) {
    existing.ws = ws;
    existing.connected = true;
    ws._playerId = existing.id;
    ws._roomCode = room.code;
    sendTo(existing, {
      type: 'joined',
      code: room.code,
      seat: existing.seatIndex,
      name: existing.name,
      rejoinToken: existing.rejoinToken,
    });
    broadcast(room, { type: 'message', text: `${existing.name} reconnected.` }, existing.id);
    broadcastWaitingPlayers(room);
    sendGameState(room);
    return;
  }

  // If a game is already running, only allow disconnected players to rejoin (not new seats).
  if (room.game && room.state !== 'waiting') {
    ws.send(JSON.stringify({ type: 'error', text: 'Game already in progress. Only disconnected players can rejoin.' }));
    return;
  }

  const seatIndex = findAvailableSeat(room);
  if (seatIndex === null) {
    ws.send(JSON.stringify({ type: 'error', text: 'Room is full (4 players max).' }));
    return;
  }

  // If we're reusing a disconnected seat, evict the old disconnected record so we don't duplicate seats/names.
  room.players = room.players.filter(p => !(p.seatIndex === seatIndex && !p.connected));

  const playerId = uuidv4();
  const rejoinToken = uuidv4();
  const player = {
    id: playerId,
    name: data.name || `Player ${seatIndex + 1}`,
    ws,
    seatIndex,
    connected: true,
    rejoinToken,
  };
  room.players.push(player);
  ws._playerId = playerId;
  ws._roomCode = room.code;

  sendTo(player, { type: 'joined', code: room.code, seat: seatIndex, name: player.name, rejoinToken });
  broadcastWaitingPlayers(room);
  broadcast(room, { type: 'message', text: `${player.name} joined (seat ${seatIndex + 1}/4).` });

  const connectedCount = room.players.filter(p => p.connected).length;
  if (connectedCount === 4 && !room.game) {
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
    deck: [],
    deckIndex: 0,
    hands: [[], [], [], []],
    firstBatch: [null, null, null, null],
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
    maxTricks: 8,
    consecutiveWins: { team: -1, count: 0 },
    kapothiDeclared: null,
    kapothiDecisionTeam: null,
    kapothiOffered: false,
    pendingKapothiTurn: null,
    halfCourtDeclarer: null,
    halfCourtDeclarerTeam: null,
    halfCourtPassed: [],
    phase: 'half_court_offer',
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
  broadcastWaitingPlayers(room);
  sendGameState(room);
}

function findRoomByWs(ws) {
  if (!ws._roomCode) return null;
  return rooms.get(ws._roomCode);
}

module.exports = { handleJoin, handleAction, handleDisconnect };