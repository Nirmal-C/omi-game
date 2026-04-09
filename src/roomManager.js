// src/roomManager.js — Socket.io version
const { v4: uuidv4 } = require('uuid');
const { dealHands, trickWinner, getValidCards, scoreRound, SUIT_NAMES } = require('./gameLogic');

const rooms = new Map();

function createRoom() {
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  const room = {
    code,
    id: uuidv4(),
    players: [],
    state: 'waiting',
    game: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

function buildPlayerView(room, seatIndex) {
  const g = room.game;
  if (!g) return null;
  return {
    phase: room.state,
    seatIndex,
    players: room.players.map(p => ({ name: p.name, seat: p.seatIndex, connected: p.connected })),
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
    validCards: room.state === 'playing' && g.currentTurn === seatIndex
      ? getValidCards(g.hands[seatIndex], g.leadSuit) : [],
    needsTrumpSelect: room.state === 'trump_select' && g.currentTurn === seatIndex,
    firstBatchHand: room.state === 'trump_select' ? g.firstBatch[seatIndex] : null,
    gameOver: g.gameOver,
    winner: g.winner,
  };
}

function sendGameState(io, room) {
  for (const player of room.players) {
    if (player.socketId) {
      io.to(player.socketId).emit('game_state', buildPlayerView(room, player.seatIndex));
    }
  }
}

function broadcastChat(io, room, text) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('message', { type: 'message', text });
  }
}

function initGame(io, room) {
  const dealerSeat = Math.floor(Math.random() * 4);
  room.game = {
    dealerSeat: (dealerSeat + 1) % 4,
    trumpChooserSeat: null, trumpChooserTeam: null, trumpSuit: null,
    hands: [[], [], [], []], firstBatch: [[], [], [], []],
    currentTrick: [], leadSuit: null, currentTurn: 0,
    trickCounts: { 0: 0, 1: 0 }, teamTokens: { 0: 0, 1: 0 },
    pendingToken: false, trickNumber: 0,
    lastTrickWinner: null, lastTrickCards: null, roundResult: null,
    phase: 'trump_select', gameOver: false, winner: null,
  };
  broadcastChat(io, room, 'All 4 players joined! Game starting...');
  setTimeout(() => startRound(io, room), 1000);
}

function startRound(io, room) {
  const g = room.game;
  g.dealerSeat = (g.dealerSeat - 1 + 4) % 4;
  g.trumpChooserSeat = (g.dealerSeat - 1 + 4) % 4;
  g.currentTurn = g.trumpChooserSeat;
  const { firstBatch, fullHands } = dealHands(g.dealerSeat);
  g.firstBatch = firstBatch;
  g.hands = fullHands;
  g.trumpSuit = null; g.currentTrick = []; g.trickCounts = { 0: 0, 1: 0 };
  g.leadSuit = null; g.trickNumber = 0; g.lastTrickWinner = null;
  g.lastTrickCards = null; g.roundResult = null; g.phase = 'trump_select';
  room.state = 'trump_select';
  sendGameState(io, room);
  const chooserName = room.players.find(p => p.seatIndex === g.trumpChooserSeat)?.name || '?';
  broadcastChat(io, room, `New round! ${chooserName} chooses trumps.`);
}

function endRound(io, room) {
  const g = room.game;
  const result = scoreRound(g.trickCounts, g.trumpChooserTeam);
  g.roundResult = result;
  room.state = 'round_end';
  let tokensToAward = result.tokens;
  if (g.pendingToken) { tokensToAward += 1; g.pendingToken = false; }

  if (result.draw) {
    g.pendingToken = true;
    broadcastChat(io, room, '4-4 draw! An extra token is at stake next round.');
  } else {
    g.teamTokens[result.winner] += tokensToAward;
    const teamName = result.winner === 0 ? 'Team A (N/S)' : 'Team B (E/W)';
    const msg = result.kapothi
      ? `KAPOTHI! ${teamName} won all 8 tricks! +${tokensToAward} tokens!`
      : `${teamName} wins the round! +${tokensToAward} token${tokensToAward !== 1 ? 's' : ''}.`;
    broadcastChat(io, room, msg);
    if (g.teamTokens[0] >= 10 || g.teamTokens[1] >= 10) {
      g.gameOver = true;
      g.winner = g.teamTokens[0] >= 10 ? 0 : 1;
      room.state = 'game_over';
      const winTeam = g.winner === 0 ? 'Team A (N/S)' : 'Team B (E/W)';
      broadcastChat(io, room, `🎉 GAME OVER! ${winTeam} wins with ${g.teamTokens[g.winner]} tokens!`);
    }
  }
  sendGameState(io, room);
}

function handleJoin(socket, data, io) {
  let room;
  if (data.create) {
    room = createRoom();
  } else {
    room = getRoom(data.code);
    if (!room) { socket.emit('error', { text: 'Room not found. Check the code.' }); return; }
  }

  // Reconnect same name
  const existing = room.players.find(p => p.name === data.name && !p.connected);
  if (existing) {
    existing.socketId = socket.id;
    existing.connected = true;
    socket._roomCode = room.code;
    socket.emit('joined', { code: room.code, seat: existing.seatIndex, name: existing.name });
    broadcastChat(io, room, `${existing.name} reconnected.`);
    sendGameState(io, room);
    return;
  }

  if (room.players.length >= 4) { socket.emit('error', { text: 'Room is full.' }); return; }

  const seatIndex = room.players.length;
  const player = { id: uuidv4(), name: data.name || `Player ${seatIndex + 1}`, socketId: socket.id, seatIndex, connected: true };
  room.players.push(player);
  socket._roomCode = room.code;

  socket.emit('joined', { code: room.code, seat: seatIndex, name: player.name });
  const playerList = room.players.map(p => ({ name: p.name, seat: p.seatIndex, connected: p.connected }));
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('player_joined', { players: playerList });
  }
  broadcastChat(io, room, `${player.name} joined (seat ${seatIndex + 1}/4).`);
  if (room.players.length === 4 && !room.game) initGame(io, room);
}

function handleAction(socket, data, io) {
  const room = getRoom(socket._roomCode);
  if (!room) return;
  const player = room.players.find(p => p.socketId === socket.id);
  if (!player) return;
  const g = room.game;
  if (!g) return;

  switch (data.action) {
    case 'choose_trump': {
      if (room.state !== 'trump_select' || g.currentTurn !== player.seatIndex) return;
      const suit = data.suit;
      if (!['♠', '♥', '♦', '♣'].includes(suit)) return;
      g.trumpSuit = suit;
      g.trumpChooserTeam = player.seatIndex % 2 === 0 ? 0 : 1;
      g.phase = 'playing'; g.currentTurn = g.trumpChooserSeat; room.state = 'playing';
      broadcastChat(io, room, `${player.name} chose ${SUIT_NAMES[suit]} ${suit} as trumps! ${player.name} leads.`);
      sendGameState(io, room);
      break;
    }
    case 'play_card': {
      if (room.state !== 'playing' || g.currentTurn !== player.seatIndex) return;
      const handIdx = g.hands[player.seatIndex].findIndex(c => c.id === data.cardId);
      if (handIdx === -1) return;
      const validIds = getValidCards(g.hands[player.seatIndex], g.leadSuit);
      if (!validIds.includes(data.cardId)) return;
      const card = g.hands[player.seatIndex].splice(handIdx, 1)[0];
      if (g.currentTrick.length === 0) g.leadSuit = card.suit;
      g.currentTrick.push({ playerIndex: player.seatIndex, card });
      broadcastChat(io, room, `${player.name} played ${card.rank}${card.suit}`);
      if (g.currentTrick.length === 4) {
        const winnerSeat = trickWinner(g.currentTrick, g.leadSuit, g.trumpSuit);
        const winnerTeam = winnerSeat % 2 === 0 ? 0 : 1;
        g.trickCounts[winnerTeam]++; g.lastTrickWinner = winnerSeat;
        g.lastTrickCards = [...g.currentTrick]; g.trickNumber++;
        const winnerName = room.players.find(p => p.seatIndex === winnerSeat)?.name || '?';
        broadcastChat(io, room, `${winnerName} wins the trick! (Team ${winnerTeam === 0 ? 'A' : 'B'}: ${g.trickCounts[winnerTeam]} tricks)`);
        sendGameState(io, room);
        setTimeout(() => {
          g.currentTrick = []; g.leadSuit = null;
          if (g.trickNumber === 8) endRound(io, room);
          else { g.currentTurn = winnerSeat; sendGameState(io, room); }
        }, 1800);
      } else {
        g.currentTurn = (player.seatIndex - 1 + 4) % 4;
        sendGameState(io, room);
      }
      break;
    }
    case 'next_round': {
      if (room.state !== 'round_end' || g.gameOver) return;
      startRound(io, room);
      break;
    }
  }
}

function handleDisconnect(socket, io) {
  const room = getRoom(socket._roomCode);
  if (!room) return;
  const player = room.players.find(p => p.socketId === socket.id);
  if (!player) return;
  player.connected = false; player.socketId = null;
  broadcastChat(io, room, `${player.name} disconnected. Rejoin with code ${room.code}.`);
  sendGameState(io, room);
}

module.exports = { handleJoin, handleAction, handleDisconnect };
