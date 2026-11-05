// js/hands/validateAutomaticArrangement.js
// Automatic hand detection for Pyramid Poker

/**
 * Automatic hand types and their precedence (higher = better)
 */
const AUTOMATIC_TYPES = {
    'three-full-houses': 4,  // Highest
    'dragon': 3,
    'three-straight': 2,
    'three-flush': 1        // Lowest
};

/**
 * Detect if an arrangement qualifies as an automatic
 * @param {Object} arrangement - {back, middle, front} with cards
 * @returns {Object|null} - {type, precedence} or null if no automatic
 */
function validateAutomaticArrangement(arrangement) {
    // Check in precedence order (highest first)
    if (hasThreeFullHouses(arrangement)) {
        return { type: 'three-full-houses', precedence: AUTOMATIC_TYPES['three-full-houses'] };
    }
    if (hasDragon(arrangement)) {
        return { type: 'dragon', precedence: AUTOMATIC_TYPES['dragon'] };
    }
    if (hasThreeStraight(arrangement)) {
        return { type: 'three-straight', precedence: AUTOMATIC_TYPES['three-straight'] };
    }
    if (hasThreeFlush(arrangement)) {
        return { type: 'three-flush', precedence: AUTOMATIC_TYPES['three-flush'] };
    }
    return null; // No automatic
}

/**
 * Check if arrangement has a dragon (one of each rank A-2)
 */
function hasDragon(arrangement) {
    const allCards = [
        ...arrangement.back,
        ...arrangement.middle,
        ...arrangement.front
    ];

    // Must have exactly 13 cards total
    if (allCards.length !== 13) return false;

    const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const foundRanks = new Set();
    let wildCount = 0;

    allCards.forEach(card => {
        if (card.isWild) {
            wildCount++;
        } else if (card.rank) {
            foundRanks.add(card.rank);
        }
    });

    // Dragon = all 13 ranks (natural + wilds filling gaps)
    const totalUniqueRanks = foundRanks.size + wildCount;
    return totalUniqueRanks === 13 && allCards.length === 13;
}

function hasThreeFullHouses(arrangement) {
    const backCards = arrangement.back.filter(c => !c.isWild);
    const middleCards = arrangement.middle.filter(c => !c.isWild);
    const frontCards = arrangement.front.filter(c => !c.isWild);

    const backWilds = arrangement.back.filter(c => c.isWild).length;
    const middleWilds = arrangement.middle.filter(c => c.isWild).length;
    const frontWilds = arrangement.front.filter(c => c.isWild).length;

    return canBeFullHouse(backCards, backWilds, 5) &&
           canBeFullHouse(middleCards, middleWilds, 5) &&
           canBeFullHouse(frontCards, frontWilds, 5);
}

function hasThreeFlush(arrangement) {
    const backCards = arrangement.back.filter(c => !c.isWild);
    const middleCards = arrangement.middle.filter(c => !c.isWild);
    const frontCards = arrangement.front.filter(c => !c.isWild);

    const backWilds = arrangement.back.filter(c => c.isWild).length;
    const middleWilds = arrangement.middle.filter(c => c.isWild).length;
    const frontWilds = arrangement.front.filter(c => c.isWild).length;

    return canBeFlush(backCards, backWilds, 5) &&
           canBeFlush(middleCards, middleWilds, 5) &&
           canBeFlush(frontCards, frontWilds, 5);
}

function hasThreeStraight(arrangement) {
    const backCards = arrangement.back.filter(c => !c.isWild);
    const middleCards = arrangement.middle.filter(c => !c.isWild);
    const frontCards = arrangement.front.filter(c => !c.isWild);

    const backWilds = arrangement.back.filter(c => c.isWild).length;
    const middleWilds = arrangement.middle.filter(c => c.isWild).length;
    const frontWilds = arrangement.front.filter(c => c.isWild).length;

    return canBeStraight(backCards, backWilds, 5) &&
           canBeStraight(middleCards, middleWilds, 5) &&
           canBeStraight(frontCards, frontWilds, 5);
}

// Helper: Can make full house (trips+pair for 5 cards)
function canBeFullHouse(cards, wildCount, handSize) {
    const rankCounts = {};
    cards.forEach(c => rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1);

    // Back/Middle - need trips + pair
    const counts = Object.values(rankCounts).sort((a, b) => b - a);

    // Try to make trips from highest count
    if (counts.length >= 2) {
        const wildsNeededForTrips = Math.max(0, 3 - counts[0]);
        const wildsNeededForPair = Math.max(0, 2 - counts[1]);
        if (wildsNeededForTrips + wildsNeededForPair <= wildCount) return true;
    }

    // All wilds
    return wildCount >= 5;
}

// Helper: Can make flush (all same suit)
function canBeFlush(cards, wildCount, handSize) {
    const suitCounts = {};
    cards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);

    const maxSuitCount = Math.max(...Object.values(suitCounts), 0);
    return maxSuitCount + wildCount >= handSize;
}

// Helper: Can make straight (consecutive ranks)
function canBeStraight(cards, wildCount, handSize) {
    if (cards.length + wildCount < handSize) return false;

    const ranks = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);

    // Try each possible straight starting point
    const straightStarts = handSize === 5 ? [14, 13, 12, 11, 10, 9, 8, 7, 6, 5] : [14, 13, 12];

    for (const high of straightStarts) {
        const neededRanks = [];
        for (let i = 0; i < handSize; i++) {
            let rank = high - i;
            if (rank === 1 && high === 14) rank = 14; // Ace in wheel
            neededRanks.push(rank);
        }

        const missingRanks = neededRanks.filter(r => !ranks.includes(r));
        if (missingRanks.length <= wildCount) return true;
    }

    // Check wheel (A-2-3-4-5 or A-2-3 for front)
    if (handSize === 5) {
        const wheelRanks = [14, 2, 3, 4, 5];
        const missingWheel = wheelRanks.filter(r => !ranks.includes(r));
        if (missingWheel.length <= wildCount) return true;
    }

    return false;
}

/**
 * Detect if 17 cards can form ANY automatic pattern
 * @param {Array} allCards - All 17 cards dealt to player
 * @returns {Array} - List of possible automatics: ['dragon', 'three-full-houses', etc.]
 */
function detectPossibleAutomatics(allCards) {
    const possibleAutomatics = [];

    // Separate wilds from natural cards
    const naturalCards = allCards.filter(c => !c.isWild);
    const wildCount = allCards.filter(c => c.isWild).length;

    // Check Dragon (easiest - just need all 13 ranks)
    if (canFormDragon(naturalCards, wildCount)) {
        possibleAutomatics.push('dragon');
    }

    // Check Three Full Houses
    if (canFormThreeFullHouses(naturalCards, wildCount)) {
        possibleAutomatics.push('three-full-houses');
    }

    // Check Three Flush
    if (canFormThreeFlush(naturalCards, wildCount)) {
        possibleAutomatics.push('three-flush');
    }

    // Check Three Straight
    if (canFormThreeStraight(naturalCards, wildCount)) {
        possibleAutomatics.push('three-straight');
    }

    return possibleAutomatics;
}

/**
 * Can the cards form a dragon (all 13 ranks)?
 */
function canFormDragon(naturalCards, wildCount) {
    const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const foundRanks = new Set();

    naturalCards.forEach(card => {
        if (card.rank) foundRanks.add(card.rank);
    });

    const missingRanks = ranks.filter(r => !foundRanks.has(r)).length;
    return missingRanks <= wildCount && (foundRanks.size + wildCount) >= 13;
}

/**
 * Can the cards form three full houses?
 * Need: Back 3+2, Middle 3+2, Front 3+2 = 15 cards with FH pattern
 */
function canFormThreeFullHouses(naturalCards, wildCount) {

    // Count inventory of each rank
    const rankCounts = {};
    naturalCards.forEach(c => {
        if (c.rank) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }
    });

    let availableWilds = wildCount;
    let fullHousesBuilt = 0;

    // Try to build a single full house (trips + pair from different ranks)
    function tryBuildFullHouse() {

        // Find best trips candidate (rank with most cards)
        let tripsRank = null;
        let tripsCount = 0;

        for (const [rank, count] of Object.entries(rankCounts)) {
            if (count > tripsCount) {
                tripsRank = rank;
                tripsCount = count;
            }
        }

        if (!tripsRank) {
            return false;
        }

        // Calculate wilds needed for trips
        const wildsForTrips = Math.max(0, 3 - tripsCount);

        if (wildsForTrips > availableWilds) {
            return false;
        }

        // Find best pair candidate (different rank)
        // PREFER ranks with exactly 2 cards (pure pairs, not wasted trips)
        let pairRank = null;
        let pairCount = 0;
        let preferPurePair = true;

        // First pass: look for pure pairs (count === 2)
        for (const [rank, count] of Object.entries(rankCounts)) {
            if (rank !== tripsRank && count === 2) {
                if (count > pairCount) {
                    pairRank = rank;
                    pairCount = count;
                }
            }
        }

        // Second pass: if no pure pairs, use any rank with ≥2 cards
        if (!pairRank) {
            for (const [rank, count] of Object.entries(rankCounts)) {
                if (rank !== tripsRank && count >= 2) {
                    if (count > pairCount) {
                        pairRank = rank;
                        pairCount = count;
                        preferPurePair = false;
                    }
                }
            }
        }

        if (!pairRank) {
            return false;
        }

        // Calculate wilds needed for pair
        const wildsForPair = Math.max(0, 2 - pairCount);
        const totalWildsNeeded = wildsForTrips + wildsForPair;

        if (totalWildsNeeded > availableWilds) {
            return false;
        }

        // Consume cards
        rankCounts[tripsRank] -= Math.min(3, tripsCount);
        if (rankCounts[tripsRank] === 0) delete rankCounts[tripsRank];

        rankCounts[pairRank] -= Math.min(2, pairCount);
        if (rankCounts[pairRank] === 0) delete rankCounts[pairRank];

        availableWilds -= totalWildsNeeded;
        return true;
    }

    // Try to build 3 full houses
    const fh1 = tryBuildFullHouse();
    if (fh1) fullHousesBuilt++;

    const fh2 = fh1 && tryBuildFullHouse();
    if (fh2) fullHousesBuilt++;

    const fh3 = fh2 && tryBuildFullHouse();
    if (fh3) fullHousesBuilt++;

    return fullHousesBuilt === 3;
}

/**
 * Can the cards form three flushes?
 * Need: 5 cards same suit, 5 cards same suit, 5 cards same suit
 */
function canFormThreeFlush(naturalCards, wildCount) {
    // Count natural cards by suit
    const suitCounts = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    naturalCards.forEach(c => {
        if (c.suit) suitCounts[c.suit]++;
    });

    // Get counts in descending order
    const counts = Object.values(suitCounts).sort((a, b) => b - a);

    // Need at least 15 cards total for three 5-card flushes
    if (naturalCards.length + wildCount < 15) return false;

    // Calculate wilds needed to bring top 3 suits to 5 cards each
    const wildsForSuit1 = Math.max(0, 5 - counts[0]);
    const wildsForSuit2 = Math.max(0, 5 - counts[1]);
    const wildsForSuit3 = Math.max(0, 5 - counts[2]);

    const totalWildsNeeded = wildsForSuit1 + wildsForSuit2 + wildsForSuit3;

    return totalWildsNeeded <= wildCount;
}

/**
 * Can the cards form three straights?
 * Need: 5-card straight, 5-card straight, 5-card straight
 */
function canFormThreeStraight(naturalCards, wildCount) {

    // Count inventory of each rank
    const rankCounts = {};
    for (let i = 2; i <= 14; i++) {
        rankCounts[i] = 0;
    }

    naturalCards.forEach(c => {
        rankCounts[c.value]++;
    });

    let availableWilds = wildCount;
    let straightsBuilt = 0;

    // Try to build 3 straights greedily (highest first)
    function tryBuildStraight() {
        // Try each possible 5-card straight
        for (let high = 14; high >= 5; high--) {
            const needed = [];
            for (let i = 0; i < 5; i++) {
                needed.push(high - i);
            }

            // Check if we have enough cards for this straight
            let wildsNeeded = 0;
            let canBuild = true;

            for (const rank of needed) {
                if (rankCounts[rank] > 0) {
                    // Have natural card
                } else if (wildsNeeded < availableWilds) {
                    wildsNeeded++;
                } else {
                    canBuild = false;
                    break;
                }
            }

            if (canBuild) {
                // Consume cards for this straight
                for (const rank of needed) {
                    if (rankCounts[rank] > 0) {
                        rankCounts[rank]--;
                    } else {
                        availableWilds--;
                    }
                }
                return true;
            }
        }

        // Try wheel (A-2-3-4-5)
        const wheelRanks = [14, 5, 4, 3, 2];  // ✅ Correct - builds A-5-4-3-2 rank order
        let wildsNeeded = 0;
        let canBuild = true;

        for (const rank of wheelRanks) {
            if (rankCounts[rank] > 0) {
                // Have natural card
            } else if (wildsNeeded < availableWilds) {
                wildsNeeded++;
            } else {
                canBuild = false;
                break;
            }
        }

        if (canBuild) {
            for (const rank of wheelRanks) {
                if (rankCounts[rank] > 0) {
                    rankCounts[rank]--;
                } else {
                    availableWilds--;
                }
            }
            return true;
        }

        return false;
    }

    // Try to build 3 straights
    const straight1 = tryBuildStraight();
    if (straight1) straightsBuilt++;

    const straight2 = straight1 && tryBuildStraight();
    if (straight2) straightsBuilt++;

    const straight3 = straight2 && tryBuildStraight();
    if (straight3) straightsBuilt++;

    return straightsBuilt === 3;
}

/**
 * Compare two automatics by precedence
 * @param {Object} auto1 - {type, precedence}
 * @param {Object} auto2 - {type, precedence}
 * @returns {number} - Positive if auto1 > auto2, negative if auto1 < auto2, 0 if equal
 */
function compareAutomatics(auto1, auto2) {
    return auto2.precedence - auto1.precedence; // Higher precedence wins
}

/**
 * Find and arrange the best automatic from 17 cards
 * @param {Array} allCards - All 17 cards
 * @returns {Object} - {type, arrangement} or null
 */

function findAndArrangeBestAutomatic(allCards) {
    console.log('🔥🔥🔥 USING: validate-automatic-arrangement.js 🔥🔥🔥');  // ADD THIS LINE
    const possibleAutomatics = detectPossibleAutomatics(allCards);

    if (possibleAutomatics.length === 0) {
        return null;
    }

    // Pick highest precedence
    const precedenceOrder = ['three-full-houses', 'dragon', 'three-straight', 'three-flush'];
    const bestAutomatic = precedenceOrder.find(type => possibleAutomatics.includes(type));

    // Arrange cards for that automatic
    let arrangement;
    switch(bestAutomatic) {
        case 'dragon':
            arrangement = arrangeDragon(allCards);
            break;
        case 'three-full-houses':
            arrangement = arrangeThreeFullHouses(allCards);
            break;
        case 'three-flush':
            arrangement = arrangeThreeFlush(allCards);
            break;
        case 'three-straight':
            arrangement = arrangeThreeStraight(allCards);
            break;
    }

    // Three-flush may return an array of variants for the scroller
    if (bestAutomatic === 'three-flush' && Array.isArray(arrangement)) {
        return { type: bestAutomatic, variants: arrangement };
    }

    return { type: bestAutomatic, arrangement };

}

// Three-full-houses - build trips+pairs
function arrangeThreeFullHouses(allCards) {
    console.log('🎨 arrangeThreeFullHouses - arranging 17 cards');

    const wilds = allCards.filter(c => c.isWild);
    const naturals = allCards.filter(c => !c.isWild);

    // Build rank inventory (rank → array of cards)
    const rankInventory = {};
    naturals.forEach(c => {
        if (!rankInventory[c.rank]) rankInventory[c.rank] = [];
        rankInventory[c.rank].push(c);
    });

    console.log('📊 Initial inventory:',
        Object.fromEntries(Object.entries(rankInventory).map(([k,v]) => [k, v.length])));

    let availableWilds = [...wilds];

    // Build a single full house
    function buildFullHouse(targetHand) {

        const fhNumber = hands.length + 1;
        console.log(`\n🎯 Building full house #${fhNumber}`);
        console.log(`   Wilds available: ${availableWilds.length}`);

        // Find best trips candidate (rank with most cards)
        let tripsRank = null;
        let tripsCount = 0;

        for (const [rank, cards] of Object.entries(rankInventory)) {
            if (cards.length > tripsCount) {
                tripsRank = rank;
                tripsCount = cards.length;
            }
        }

        if (!tripsRank) {
            console.log('❌ No ranks available for trips');
            return false;
        }

        const wildsForTrips = Math.max(0, 3 - tripsCount);

        if (wildsForTrips > availableWilds.length) {
            console.log(`❌ Need ${wildsForTrips} wilds for trips, only have ${availableWilds.length}`);
            return false;
        }

        console.log(`✓ Using trips: ${tripsRank} (${tripsCount} cards, need ${wildsForTrips} wilds)`);

        // Find best pair candidate (different rank)
        // PREFER ranks with exactly 2 cards (pure pairs, not wasted trips)
        let pairRank = null;
        let pairCount = 0;
        let isPurePair = false;

        // First pass: look for pure pairs (count === 2)
        for (const [rank, cards] of Object.entries(rankInventory)) {
            if (rank !== tripsRank && cards.length === 2) {
                pairRank = rank;
                pairCount = 2;
                isPurePair = true;
                break; // Found pure pair, use it
            }
        }

        // Second pass: if no pure pairs, use any rank with most cards
        if (!pairRank) {
            for (const [rank, cards] of Object.entries(rankInventory)) {
                if (rank !== tripsRank && cards.length > pairCount) {
                    pairRank = rank;
                    pairCount = cards.length;
                }
            }
        }

        if (!pairRank) {
            console.log('❌ No second rank available for pair');
            return false;
        }

        const wildsForPair = Math.max(0, 2 - pairCount);
        const totalWildsNeeded = wildsForTrips + wildsForPair;

        if (totalWildsNeeded > availableWilds.length) {
            console.log(`❌ Need ${totalWildsNeeded} total wilds, only have ${availableWilds.length}`);
            return false;
        }

        console.log(`✓ Using pair: ${pairRank} (${pairCount} cards, ${isPurePair ? 'pure pair' : 'from trips'}, need ${wildsForPair} wilds)`);

        console.log(`✅ Built full house: ${tripsRank}-${tripsRank}-${tripsRank}-${pairRank}-${pairRank}`);

        // Add trips to hand
        const tripsToUse = Math.min(3, tripsCount);
        for (let i = 0; i < tripsToUse; i++) {
            targetHand.push(rankInventory[tripsRank].shift());
        }
        for (let i = 0; i < wildsForTrips; i++) {
            const wildCard = availableWilds.shift();
            assignWildCard(wildCard, tripsRank, '♠');
            targetHand.push(wildCard);
        }

        // Add pair to hand
        const pairToUse = Math.min(2, pairCount);
        for (let i = 0; i < pairToUse; i++) {
            targetHand.push(rankInventory[pairRank].shift());
        }
        for (let i = 0; i < wildsForPair; i++) {
            const wildCard = availableWilds.shift();
            assignWildCard(wildCard, pairRank, '♠');
            targetHand.push(wildCard);
        }

        // Clean up empty rank
        if (rankInventory[tripsRank].length === 0) {
            delete rankInventory[tripsRank];
        }

        // Clean up empty rank
        if (rankInventory[pairRank].length === 0) {
            delete rankInventory[pairRank];
        }

        console.log('📊 Remaining inventory:',
            Object.fromEntries(Object.entries(rankInventory).map(([k,v]) => [k, v.length])));

        return true;
    }

    // Build 3 full houses
    const hands = [];

    const hand1 = [];
    if (buildFullHouse(hand1)) hands.push(hand1);

    const hand2 = [];
    if (buildFullHouse(hand2)) hands.push(hand2);

    const hand3 = [];
    if (buildFullHouse(hand3)) hands.push(hand3);

    // Sort by hand strength (strongest first)
    hands.sort((a, b) => {
        const strengthA = evaluateHand(a);
        const strengthB = evaluateHand(b);
        return compareTuples(strengthB.handStrength, strengthA.handStrength);
    });

    // Assign to back/middle/front (strongest to weakest)
    const back = hands[0] || [];
    const middle = hands[1] || [];
    const front = hands[2] || [];

    console.log('🏁 Arrangement complete (sorted by strength)');
    console.log(`   Back: ${back.length} cards`);
    console.log(`   Middle: ${middle.length} cards`);
    console.log(`   Front: ${front.length} cards`);

    return { back, middle, front };

}

// Dragon - should already work, but here's a cleaner version
function arrangeDragon(allCards) {
    console.log('🎨 arrangeDragon - arranging cards');

    const wilds = allCards.filter(c => c.isWild);
    const naturals = allCards.filter(c => !c.isWild);

    const allRanks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

    // Build rank inventory - one card per rank (best available)
    const rankInventory = {};
    naturals.forEach(c => {
        if (!rankInventory[c.rank]) {
            rankInventory[c.rank] = c;
        }
    });

    // Assign wild to missing rank
    if (wilds.length > 0) {
        const missingRank = allRanks.find(r => !rankInventory[r]);
        if (missingRank) {
            const wildCard = wilds[0];
            assignWildCard(wildCard, missingRank, '♠');
            rankInventory[missingRank] = wildCard;
            console.log(`🃏 Wild assigned to missing rank: ${missingRank}♠`);
        }
    }

    // Build ordered 13-card dragon (A down to 2)
    const dragonCards = allRanks.map(r => rankInventory[r]).filter(Boolean);

    console.log(`🐉 Dragon cards (${dragonCards.length}):`, dragonCards.map(c => `${c.rank}${c.suit}`).join(' '));

    // Distribute into 5-5-3 and evaluate
    const hands = [
        { cards: dragonCards.slice(0, 5) },
        { cards: dragonCards.slice(5, 10) },
        { cards: dragonCards.slice(10, 13) }
    ];

    const evaluatedHands = hands.map(hand => ({
        cards: hand.cards,
        strength: hand.cards.length === 3
            ? evaluateThreeCardHand(hand.cards)
            : evaluateHand(hand.cards)
    }));

    // Sort strongest to weakest
    evaluatedHands.sort((a, b) => compareTuples(b.strength.handStrength, a.strength.handStrength));

    console.log('🏁 Dragon arrangement complete');
    console.log(`   Back: ${evaluatedHands[0].cards.map(c => `${c.rank}${c.suit}`).join(' ')}`);
    console.log(`   Middle: ${evaluatedHands[1].cards.map(c => `${c.rank}${c.suit}`).join(' ')}`);
    console.log(`   Front: ${evaluatedHands[2].cards.map(c => `${c.rank}${c.suit}`).join(' ')}`);

    return {
        back: evaluatedHands[0].cards,
        middle: evaluatedHands[1].cards,
        front: evaluatedHands[2].cards
    };
}

// Arrange for three flush
function arrangeThreeFlush(allCards) {
    const wilds = allCards.filter(c => c.isWild);
    const naturals = allCards.filter(c => !c.isWild);

    // Group naturals by suit and sort by rank
    const suitGroups = { '♠': [], '♥': [], '♦': [], '♣': [] };
    naturals.forEach(c => suitGroups[c.suit].push(c));

    // Get top 5 from each suit, sorted by rank
    const flushHands = Object.entries(suitGroups)
        .map(([suit, cards]) => {
            return {
                suit: suit,
                cards: cards.sort((a, b) => b.value - a.value).slice(0, 5)
            };
        })
        .filter(hand => hand.cards.length > 0);

    // Sort hands by card count (descending) - prioritize nearly-complete flushes
    flushHands.sort((a, b) => b.cards.length - a.cards.length);

    // Fill each hand to 5 cards with wilds
    let wildIndex = 0;
    flushHands.slice(0, 3).forEach(hand => {
        while (hand.cards.length < 5 && wildIndex < wilds.length) {
            hand.cards.push(wilds[wildIndex++]);
        }
    });

    // Evaluate and sort by handRank (descending)
    const evaluatedHands = flushHands
        .map(hand => {
            console.log(`  📋 Hand suit ${hand.suit}, cards:`, hand.cards.map(c => `${c.rank||'WILD'}${c.suit} (isWild:${c.isWild})`).join(', '));

            // Assign any wilds to the flush suit
            hand.cards.forEach(card => {
                if (card.isWild) {
                    hand.cards.forEach(card => {
                        if (card.isWild) {
                            resolveWildInHand(card, hand.cards);
                        }
                    });
                }
            });

            return {
                cards: hand.cards,
                handRank: evaluateHand(hand.cards)
            };
        })
        .filter(hand => hand.cards.length === 5)
        .sort((a, b) => {
            if (b.handRank.handType !== a.handRank.handType) {
                return b.handRank.handType - a.handRank.handType;
            }
            for (let i = 0; i < a.handRank.handStrength.length; i++) {
                if (b.handRank.handStrength[i] !== a.handRank.handStrength[i]) {
                    return b.handRank.handStrength[i] - a.handRank.handStrength[i];
                }
            }
            return 0;
        });

    console.log('🃏 Three-Flush Evaluation:');
    evaluatedHands.forEach((hand, index) => {
        const handType = index === 0 ? 'BACK' : index === 1 ? 'MIDDLE' : 'FRONT';
        const cardList = hand.cards.map(c => `${c.rank}${c.suit}`).join(' ');
        console.log(`  ${handType}: ${cardList}`);
        console.log(`    Type: ${hand.handRank.handType}, Strength: [${hand.handRank.handStrength.join(', ')}]`);
    });

    // If a wild went unused, generate 3 scroller variants (wild upgrades each position)
    if (wildIndex < wilds.length) {
        const unusedWild = wilds[wildIndex];
        const usedIds = new Set([
            ...evaluatedHands[0].cards.map(c => c.id),
            ...evaluatedHands[1].cards.map(c => c.id),
            ...evaluatedHands[2].cards.map(c => c.id)
        ]);
        const stagingCards = allCards.filter(c => !usedIds.has(c.id) && c.id !== unusedWild.id);

        const improvableTargets = [0, 1, 2].filter(idx =>
            evaluatedHands[idx].handRank.handType < 9  // skip hands already SF or better
        );

        if (improvableTargets.length === 0) {
            // all three hands already SF — no wild improvement possible, return base
            const back = evaluatedHands[0].cards;
            const middle = evaluatedHands[1].cards;
            const front = evaluatedHands[2].cards;
            return { back, middle, front };
        }

        return improvableTargets.map(targetIdx =>
            buildThreeFlushVariant(evaluatedHands, targetIdx, unusedWild, stagingCards)
        );
    }

    const back = evaluatedHands[0]?.cards || [];
    const middle = evaluatedHands[1]?.cards || [];
    const front = evaluatedHands[2]?.cards || [];

    return { back, middle, front };
}

// Helper: Find SF gap in a 5-card same-suit hand (4 naturals fit a SF window)
// Returns {gapValue, deprecatedCard, sfValues} or null
function findSFGap(naturalCards) {
    const values = naturalCards.map(c => c.value);

    const windows = [];
    for (let high = 14; high >= 5; high--) {
        windows.push([high, high-1, high-2, high-3, high-4]);
    }
    windows.push([14, 5, 4, 3, 2]); // wheel

    for (const window of windows) {
        const matching = values.filter(v => window.includes(v));
        if (matching.length === 4) {
            const gapValue = window.find(v => !values.includes(v));
            const deprecatedCard = naturalCards.find(c => !window.includes(c.value));
            return { gapValue, deprecatedCard, sfValues: window };
        }
    }
    return null;
}

// Helper: Determine best wild placement in a flush hand
// Returns {upgradedCards, deprecatedCard}
function bestWildUpgradeForFlush(handCards, wildCard, suit) {
    const naturalCards = handCards.filter(c => !c.isWild).sort((a, b) => b.value - a.value);
    const values = naturalCards.map(c => c.value);

    const sfGap = findSFGap(naturalCards);

    const wildClone = Object.assign({}, wildCard);

    if (sfGap) {
        assignWildCard(wildClone, numericRankToString(sfGap.gapValue), suit);
        const upgradedCards = [...naturalCards.filter(c => c !== sfGap.deprecatedCard), wildClone];
        return { upgradedCards, deprecatedCard: sfGap.deprecatedCard };
    } else {
        let targetValue = 14;
        while (values.includes(targetValue) && targetValue >= 2) targetValue--;
        assignWildCard(wildClone, numericRankToString(targetValue), suit);
        const deprecatedCard = naturalCards[naturalCards.length - 1]; // lowest
        const upgradedCards = [...naturalCards.filter(c => c !== deprecatedCard), wildClone];
        return { upgradedCards, deprecatedCard };
    }
}

// Helper: Build one scroller variant with wild upgrading targetIdx hand
// Returns {arrangement: {back:{cards}, middle:{cards}, front:{cards}, stagingCards}, score}
function buildThreeFlushVariant(evaluatedHands, targetIdx, unusedWild, stagingCards) {
    const targetHand = evaluatedHands[targetIdx];
    const suit = targetHand.cards.find(c => !c.isWild)?.suit || targetHand.cards[0].suit;

    const { upgradedCards, deprecatedCard } = bestWildUpgradeForFlush(
        targetHand.cards, unusedWild, suit
    );

    const variantHands = evaluatedHands.map((hand, idx) => {
        if (idx === targetIdx) {
            return { cards: upgradedCards, handRank: evaluateHand(upgradedCards) };
        }
        return { cards: [...hand.cards], handRank: hand.handRank };
    });

    variantHands.sort((a, b) => {
        if (b.handRank.handType !== a.handRank.handType)
            return b.handRank.handType - a.handRank.handType;
        for (let i = 0; i < a.handRank.handStrength.length; i++) {
            if (b.handRank.handStrength[i] !== a.handRank.handStrength[i])
                return b.handRank.handStrength[i] - a.handRank.handStrength[i];
        }
        return 0;
    });

    return {
        arrangement: {
            back:   { cards: variantHands[0].cards },
            middle: { cards: variantHands[1].cards },
            front:  { cards: variantHands[2].cards },
            stagingCards: [...stagingCards, deprecatedCard]
        },
        score: variantHands[0].handRank.handType +
               variantHands[1].handRank.handType +
               variantHands[2].handRank.handType
    };
}

function arrangeThreeStraight(allCards) {
    console.log('🎨 arrangeThreeStraight - arranging 17 cards');

    const wilds = allCards.filter(c => c.isWild);
    const naturals = allCards.filter(c => !c.isWild);

    // Build rank inventory (rank → array of cards)
    const rankInventory = {};
    for (let i = 2; i <= 14; i++) {
        rankInventory[i] = [];
    }

    naturals.forEach(c => {
        rankInventory[c.value].push(c);
    });

    console.log('📊 Initial inventory counts:',
        Object.fromEntries(Object.entries(rankInventory).map(([k,v]) => [k, v.length])));

    let availableWilds = [...wilds];

    // NESTED FUNCTION - can access parent variables
    function buildStraight(targetHand) {

        // Try each possible 5-card straight (high to low)
        for (let high = 14; high >= 5; high--) {
            const needed = [];
            for (let i = 0; i < 5; i++) {
                needed.push(high - i);
            }

            // Check if we can build this straight
            let wildsNeeded = 0;
            const cardsForStraight = [];
            let canBuild = true;

            for (const rank of needed) {
                if (rankInventory[rank] && rankInventory[rank].length > 0) {
                    cardsForStraight.push(rankInventory[rank][0]);
                } else if (wildsNeeded < availableWilds.length) {
                    cardsForStraight.push(null);
                    wildsNeeded++;
                } else {
                    canBuild = false;
                    break;
                }
            }

            if (canBuild) {
                console.log(`✅ Building straight: ${needed.join('-')} (using ${wildsNeeded} wilds)`);

                // Consume cards from inventory
                for (let i = 0; i < cardsForStraight.length; i++) {
                    if (cardsForStraight[i]) {
                        const rank = needed[i];
                        const card = rankInventory[rank].shift();
                        targetHand.push(card);
                        if (rankInventory[rank].length === 0) {
                            delete rankInventory[rank];
                        }
                    } else {
                        const wildCard = availableWilds.shift();
                        assignWildCard(wildCard, numericRankToString(needed[i]), '♠');
                        targetHand.push(wildCard);
                    }
                }

                console.log('📊 Remaining inventory:',
                    Object.fromEntries(Object.entries(rankInventory).map(([k,v]) => [k, v.length])));
                return true;
            }
        }

        // Try wheel (A-2-3-4-5)
        const wheelRanks = [14, 5, 4, 3, 2];  // ✅ Correct - builds A-5-4-3-2 rank order
        let wildsNeeded = 0;
        const cardsForStraight = [];
        let canBuild = true;

        for (const rank of wheelRanks) {
            if (rankInventory[rank] && rankInventory[rank].length > 0) {
                cardsForStraight.push(rankInventory[rank][0]);
            } else if (wildsNeeded < availableWilds.length) {
                cardsForStraight.push(null);
                wildsNeeded++;
            } else {
                canBuild = false;
                break;
            }
        }

        if (canBuild) {
            console.log(`✅ Building wheel straight: A-2-3-4-5 (using ${wildsNeeded} wilds)`);

            for (let i = 0; i < cardsForStraight.length; i++) {
                if (cardsForStraight[i]) {
                    const rank = wheelRanks[i];
                    const card = rankInventory[rank].shift();
                    targetHand.push(card);
                    if (rankInventory[rank].length === 0) {
                        delete rankInventory[rank];
                    }
                } else {
                    const wildCard = availableWilds.shift();
                    assignWildCard(wildCard, numericRankToString(wheelRanks[i]), '♠');
                    targetHand.push(wildCard);
                }
            }

            console.log('📊 Remaining inventory:',
                Object.fromEntries(Object.entries(rankInventory).map(([k,v]) => [k, v.length])));
            return true;
        }

        console.log('❌ Could not build straight');
        return false;
    }

    // Build 3 straights (at the end of arrangeThreeStraight, replace the build calls)
    const hands = [];

    // Build first straight
    const hand1 = [];
    if (buildStraight(hand1)) hands.push(hand1);

    // Build second straight
    const hand2 = [];
    if (buildStraight(hand2)) hands.push(hand2);

    // Build third straight
    const hand3 = [];
    if (buildStraight(hand3)) hands.push(hand3);

    // Sort by hand strength (strongest first)
    hands.sort((a, b) => {
        const strengthA = evaluateHand(a);
        const strengthB = evaluateHand(b);
        return compareTuples(strengthB.handStrength, strengthA.handStrength);
    });

    // Assign to back/middle/front (strongest to weakest)
    let back = hands[0] || [];
    let middle = hands[1] || [];
    let front = hands[2] || [];

    console.log('🏁 Arrangement complete (sorted by strength)');
    console.log(`   Back: ${back.length} cards`);
    console.log(`   Middle: ${middle.length} cards`);
    console.log(`   Front: ${front.length} cards`);

    return { back, middle, front };
}

// Export or add to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { detectPossibleAutomatics };
} else {
    window.detectPossibleAutomatics = detectPossibleAutomatics;
}
