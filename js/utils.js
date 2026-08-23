// Utility functions for Pyramid Poker

// Create animated background particles
function createParticles() {
    const container = document.getElementById('bgParticles');
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 6 + 's';
        particle.style.animationDuration = (4 + Math.random() * 4) + 's';
        container.appendChild(particle);
    }
}

// Helper function to get card value for sorting/comparison
function getCardValue(rank) {
    if (rank === 'A') return 14;
    if (rank === 'K') return 13;
    if (rank === 'Q') return 12;
    if (rank === 'J') return 11;
    return parseInt(rank);
}

// Shuffle deck using Fisher-Yates algorithm
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Create a complete deck with two standard decks plus configurable wild cards
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];

    // Create two complete decks
    for (let deckNum = 1; deckNum <= 2; deckNum++) {
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({
                    suit,
                    rank,
                    value: getCardValue(rank),
                    id: `${rank}${suit}_${deckNum}`,
                    isWild: false
                });
            }
        }
    }

    // Add configurable number of wild cards
    const wildCardCount = window.gameConfig ? window.gameConfig.getWildCardCount() : 2; // Default to 2 if config not loaded

    for (let i = 1; i <= wildCardCount; i++) {
        deck.push({
            suit: '🃏',
            rank: '🃏',        // Changed from 'WILD' to '🃏'
            value: 15,
            id: `WILD_JOKER_${i}`,
            isWild: true
        });
    }

    return shuffleDeck(deck);
}

// Convert element ID to hand key for game logic
function getHandKey(elementId) {
    switch (elementId) {
        case 'playerHand': return 'cards';
        case 'backHand': case 'back': return 'back';
        case 'middleHand': case 'middle': return 'middle';
        case 'frontHand': case 'front': return 'front';
        default: return 'cards';
    }
}

// Compare two tuples (arrays) for hand ranking
function compareTuples(tuple1, tuple2) {
    const minLength = Math.min(tuple1.length, tuple2.length);

    for (let i = 0; i < minLength; i++) {
        if (tuple1[i] > tuple2[i]) return 1;
        if (tuple1[i] < tuple2[i]) return -1;
    }

    if (tuple1.length > tuple2.length) return 1;
    if (tuple1.length < tuple2.length) return -1;
    return 0;
}

// Check if array of values forms a straight
function isStraight(values) {
    for (let i = 0; i < values.length - 1; i++) {
        if (values[i] - values[i + 1] !== 1) {
            // Check for A-2-3-4-5 wheel straight
            if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
                return true;
            }
            return false;
        }
    }
    return true;
}

// Get bonus points for different hands in different positions
function getBackBonus(evaluation) {
    if (evaluation.handType === 10) return ' (+5 bonus)'; // Five of a Kind
    if (evaluation.handType === 8) return ' (+3 bonus)';  // Four of a Kind
    if (evaluation.handType === 9) return ' (+4 bonus)';  // Straight Flush
    return '';
}

function getMiddleBonus(evaluation) {
    if (evaluation.handType === 10) return ' (+5 bonus)'; // Five of a Kind
    if (evaluation.handType === 7) return ' (+1 bonus)';  // Full House
    if (evaluation.handType === 8) return ' (+7 bonus)';  // Four of a Kind
    if (evaluation.handType === 9) return ' (+9 bonus)';  // Straight Flush
    return '';
}

function getFrontBonus(evaluation) {
    // Check if this is a 3-card hand evaluation
    if (evaluation.handStrength.length <= 3) {
        if (evaluation.handType === 4) return ' (+2 bonus)'; // Three of a kind in 3-card front
        return '';
    }

    // 5-card front hand bonuses
    if (evaluation.handType === 10) return ' (+17 bonus)'; // Five of a Kind
    if (evaluation.handType === 9) return ' (+14 bonus)';  // Straight Flush
    if (evaluation.handType === 8) return ' (+11 bonus)';  // Four of a Kind
    if (evaluation.handType === 7) return ' (+4 bonus)';   // Full House
    if (evaluation.handType === 6) return ' (+3 bonus)';   // Straight
    if (evaluation.handType === 5) return ' (+3 bonus)';   // Flush
    return '';
}

// Get human-readable hand name
function getHandName(evaluation) {
    return evaluation.name;
}

function getThreeCardHandName(evaluation) {
    return evaluation.name;
}
