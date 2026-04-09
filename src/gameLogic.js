// omi-game/src/gameLogic.js
// Complete Omi card game rules engine

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 'Spades', '♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs' };
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_ORDER = { '7': 0, '8': 1, '9': 2, '10': 3, 'J': 4, 'Q': 5, 'K': 6, 'A': 7 };

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}${suit}` });
    }
  }
  return deck;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cutDeck(deck, partsCount) {
  const n = deck.length;
  const parts = Math.max(2, Math.min(3, partsCount || 2));
  if (n < 3) return { deck: [...deck], partsCount: 1, cutPoints: [] };

  if (parts === 2) {
    const cut1 = 1 + Math.floor(Math.random() * (n - 1));
    const p0 = deck.slice(0, cut1);
    const p1 = deck.slice(cut1);
    return { deck: [...p1, ...p0], partsCount: 2, cutPoints: [cut1] };
  }

  const cut1 = 1 + Math.floor(Math.random() * (n - 2));
  const cut2 = cut1 + 1 + Math.floor(Math.random() * (n - cut1 - 1));
  const p0 = deck.slice(0, cut1);
  const p1 = deck.slice(cut1, cut2);
  const p2 = deck.slice(cut2);
  return { deck: [...p1, ...p2, ...p0], partsCount: 3, cutPoints: [cut1, cut2] };
}

function getDealOrder(dealerSeat) {
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push((dealerSeat - 1 - i + 8) % 4); // counter-clockwise from dealer's right
  }
  return order; // [right, opposite, left, dealer]
}

function drawCards(deal, seat, count, alsoFirstBatch) {
  for (let i = 0; i < count; i++) {
    const card = deal.deck[deal.pointer++];
    deal.hands[seat].push(card);
    if (alsoFirstBatch) deal.firstBatch[seat].push(card);
  }
}

function prepareRoundDeal(dealerSeat) {
  // dealer shuffles, then player on dealer's left cuts into 2 or 3 parts, dealer reassembles
  const shuffled = shuffle(buildDeck());
  const cutParts = Math.random() < 0.5 ? 2 : 3;
  const cut = cutDeck(shuffled, cutParts);

  const order = getDealOrder(dealerSeat);
  const right = order[0];
  const opposite = order[1];
  const left = order[2];

  const deal = {
    dealerSeat,
    deck: cut.deck,
    pointer: 0,
    order,
    hands: [[], [], [], []],
    firstBatch: [[], [], [], []],
    cutInfo: { partsCount: cut.partsCount, cutPoints: cut.cutPoints },
    pendingFirstBatchSeats: [left, dealerSeat],
  };

  // First batch, but pause before giving cards to trump chooser's teammate (left) and dealer.
  drawCards(deal, right, 4, true);
  drawCards(deal, opposite, 4, true);

  return deal;
}

function completeRoundDealAfterTrump(deal) {
  if (!deal || !Array.isArray(deal.pendingFirstBatchSeats)) return deal;

  // Finish the first batch: trump chooser's teammate (left), then dealer.
  for (const seat of deal.pendingFirstBatchSeats) {
    if (deal.firstBatch[seat].length === 0) drawCards(deal, seat, 4, true);
  }

  // Second batch of 4 each, in the same order.
  for (const seat of deal.order) drawCards(deal, seat, 4, false);

  deal.pendingFirstBatchSeats = [];
  return deal;
}

function cardBeats(challenger, incumbent, leadSuit, trumpSuit) {
  // challenger tries to beat incumbent
  if (challenger.suit === trumpSuit && incumbent.suit !== trumpSuit) return true;
  if (incumbent.suit === trumpSuit && challenger.suit !== trumpSuit) return false;
  if (challenger.suit === incumbent.suit) return RANK_ORDER[challenger.rank] > RANK_ORDER[incumbent.rank];
  // different suits, neither trump — challenger can't beat
  return false;
}

function trickWinner(trick, leadSuit, trumpSuit) {
  // trick: [{playerIndex, card}, ...]
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (cardBeats(trick[i].card, best.card, leadSuit, trumpSuit)) {
      best = trick[i];
    }
  }
  return best.playerIndex;
}

function dealHands(dealerIndex) {
  const deal = prepareRoundDeal(dealerIndex);
  completeRoundDealAfterTrump(deal);
  return { hands: deal.hands, firstBatch: deal.firstBatch, fullHands: deal.hands };
}

function getValidCards(hand, leadSuit) {
  if (!leadSuit) return hand.map(c => c.id); // first play of trick
  const sameSuit = hand.filter(c => c.suit === leadSuit);
  if (sameSuit.length > 0) return sameSuit.map(c => c.id);
  return hand.map(c => c.id); // can play anything
}

function scoreRound(trickCounts, trumpChooserTeam) {
  // trickCounts: {0: n, 1: n} for team 0 (N/S) and team 1 (E/W)
  const chooserTricks = trickCounts[trumpChooserTeam];
  const otherTricks = trickCounts[1 - trumpChooserTeam];
  const otherTeam = 1 - trumpChooserTeam;

  if (chooserTricks === 8) return { winner: trumpChooserTeam, tokens: 3, kapothi: true };
  if (otherTricks === 8) return { winner: otherTeam, tokens: 3, kapothi: true };
  if (chooserTricks >= 5) return { winner: trumpChooserTeam, tokens: 1, kapothi: false };
  if (otherTricks >= 5) return { winner: otherTeam, tokens: 2, kapothi: false };
  return { winner: null, tokens: 0, draw: true }; // 4-4
}

module.exports = {
  SUITS, SUIT_NAMES, RANKS, RANK_ORDER,
  buildDeck, shuffle, cutDeck, dealHands,
  prepareRoundDeal, completeRoundDealAfterTrump,
  trickWinner, getValidCards, scoreRound, cardBeats
};
