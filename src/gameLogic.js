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

function cutDeck(deck, parts = 2) {
  const d = [...deck];
  if (d.length < 2) return d;

  const safeParts = parts === 3 ? 3 : 2;

  if (safeParts === 2) {
    const cutIndex = 1 + Math.floor(Math.random() * (d.length - 1));
    const top = d.slice(0, cutIndex);
    const bottom = d.slice(cutIndex);
    return bottom.concat(top);
  }

  // 3-part cut: split into 3 piles then re-stack them in a different order.
  const cut1 = 1 + Math.floor(Math.random() * (d.length - 2));
  const cut2 = cut1 + 1 + Math.floor(Math.random() * (d.length - cut1 - 1));
  const p1 = d.slice(0, cut1);
  const p2 = d.slice(cut1, cut2);
  const p3 = d.slice(cut2);
  return p2.concat(p3, p1);
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
  const deck = shuffle(buildDeck());
  // deal 4 cards first, then 4 more (counter-clockwise from dealer's right)
  // player to dealer's right = (dealerIndex - 1 + 4) % 4
  const hands = [[], [], [], []];
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push((dealerIndex - 1 - i + 8) % 4); // counter-clockwise
  }
  // First batch of 4 each
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      hands[order[j]].push(deck[i * 4 + j]);
    }
  }
  // Second batch of 4 each
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      hands[order[j]].push(deck[16 + i * 4 + j]);
    }
  }
  return { hands, firstBatch: hands.map(h => h.slice(0, 4)), fullHands: hands };
}

function getValidCards(hand, leadSuit) {
  if (!leadSuit) return hand.map(c => c.id); // first play of trick
  const sameSuit = hand.filter(c => c.suit === leadSuit);
  if (sameSuit.length > 0) return sameSuit.map(c => c.id);
  return hand.map(c => c.id); // can play anything
}

function scoreRound(trickCounts, trumpChooserTeam, kapothiDeclaredByTeam, halfCourtDeclarerTeam) {
  // trickCounts: {0: n, 1: n} for team 0 (N/S) and team 1 (E/W)

  // Half Court scoring (highest priority — only 4 tricks)
  if (halfCourtDeclarerTeam !== null && halfCourtDeclarerTeam !== undefined) {
    if (trickCounts[halfCourtDeclarerTeam] === 4) {
      return { winner: halfCourtDeclarerTeam, tokens: 3, halfCourt: true };
    } else {
      return { winner: 1 - halfCourtDeclarerTeam, tokens: 3, halfCourt: true, halfCourtFailed: true };
    }
  }

  const chooserTricks = trickCounts[trumpChooserTeam];
  const otherTricks = trickCounts[1 - trumpChooserTeam];
  const otherTeam = 1 - trumpChooserTeam;

  // Declared Kapothi scoring
  if (kapothiDeclaredByTeam !== null && kapothiDeclaredByTeam !== undefined) {
    const declaredTricks = trickCounts[kapothiDeclaredByTeam];
    if (declaredTricks === 8) {
      // Success: base 3 tokens + 1 bonus if trump chooser, +2 if not
      const isChooser = kapothiDeclaredByTeam === trumpChooserTeam;
      return { winner: kapothiDeclaredByTeam, tokens: isChooser ? 4 : 5, kapothi: true, kapothiDeclared: true };
    } else {
      // Failed: other team gets 3 tokens as penalty
      return { winner: 1 - kapothiDeclaredByTeam, tokens: 3, kapothi: false, kapothiDeclared: true, kapothiFailed: true };
    }
  }

  if (chooserTricks === 8) return { winner: trumpChooserTeam, tokens: 3, kapothi: true };
  if (otherTricks === 8) return { winner: otherTeam, tokens: 3, kapothi: true };
  if (chooserTricks >= 5) return { winner: trumpChooserTeam, tokens: 1, kapothi: false };
  if (otherTricks >= 5) return { winner: otherTeam, tokens: 2, kapothi: false };
  return { winner: null, tokens: 0, draw: true }; // 4-4
}

module.exports = {
  SUITS, SUIT_NAMES, RANKS, RANK_ORDER,
  buildDeck, shuffle, cutDeck, dealHands,
  trickWinner, getValidCards, scoreRound, cardBeats
};
