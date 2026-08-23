// Card evaluation functions for Pyramid Poker
// For 4K return { rank: 8, hand_rank: [8, quadRank, kicker, ...suitValues], name: 'Four of a Kind' };
// CORRECTED: Fixed naming from 'low' to 'secondHigh' for clarity

/**
 * Sort cards by standard poker order: value descending, then suit descending
 * Used for hands where structural importance follows rank order
 */
function getStandardSortedCards(cards) {
    const suitRank = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };
    return [...cards].sort((a, b) => {
        if (a.value !== b.value) return b.value - a.value;
        return suitRank[b.suit] - suitRank[a.suit];
    });
}

function evaluateHand(cards) {
    if (cards.length !== 5 && cards.length !== 6 && cards.length !== 7 && cards.length !== 8)
        return {
            rank: 1,
            hand_rank: [1, 7],
            name: 'High Card',
            handType: 1,              // ✅ ADD
            handStrength: [1, 7]      // ✅ ADD
        };

    const analysis = new Analysis(cards);
    const handEvaluation = getHandType(analysis);
    return handEvaluation; //handEvaluation is an object with multiple properties {handType, handRank, name}
}

function getHandType(analysis) {
    const cards = analysis.cards;
    const values = analysis.getSortedValues();
    const suits = analysis.getSuits();
    const valueCounts = analysis.getValueCounts();
    const numberOfCards = cards.length
    const counts = Object.keys(valueCounts).map(Number).sort((a, b) => b - a);
    const isFlush = analysis.isAllSameSuit(suits);

    // fix bug where A-6, A-7 and A-8 (extended wheels) were not found
    const isExtendedWheel = numberOfCards >= 6 && numberOfCards <= 8 &&
    values.includes(14) && values.includes(2) &&
    [...values].filter(v => v !== 14).sort((a, b) => a - b)
              .every((v, i) => v === i + 2);

    const isStraight = analysis.isSequentialValues(values) || analysis.isWheelStraight() || isExtendedWheel;

    if (isFlush && isStraight && numberOfCards === 5) {
//        console.log('🔍 Detected 5-card straight flush with cards:',
//                    analysis.cards.map(c => `${c.rank}${c.suit}`));
        return getStraightFlushHand(analysis);
    }

    if (isFlush && isStraight && numberOfCards === 6) {
        return getSixCardStraightFlushHand(analysis);
    }

    if (isFlush && isStraight && numberOfCards === 7) {
        return getSevenCardStraightFlushHand(analysis);
    }

    if (isFlush && isStraight && numberOfCards === 8) {
        return getEightCardStraightFlushHand(analysis);
    }


    if (counts[0] === 4) {
        return getFourOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 5) {
        return getFiveOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 6) {
        return getSixOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 7) {
        return getSevenOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 8) {
        return getEightOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 3 && counts[1] === 2) {
        return getFullHouseHand(analysis, valueCounts);

    }
    if (isFlush) {
        return getFlushHand(analysis);
    }

    if (counts[0] === 3) {
        return getThreeOfAKindHand(analysis, valueCounts);
    }

    if (counts[0] === 2) {
        if (valueCounts[2].length >= 2) {
            return getTwoPairHand(analysis, valueCounts);
        } else {
            return getPairHand(analysis, valueCounts);
        }
    }


    if (isStraight) {
        return getStraightHand(analysis);
    }

    return getHighCardHand(analysis);
}

// UNIVERSAL SUIT TIE-BREAKING: All hand types include suits
// 100% consistent - no exceptions, no matter how rare ties might be

// HIGH CARD
function getHighCardHand(analysis) {
    const values = analysis.getSortedValues();
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [1, ...values, ...allSuitValues];
    return {
        name: 'High Card',
        handType: 1,
        handStrength: handRankArray
    };
}

// FLUSH
function getFlushHand(analysis) {
    const values = analysis.getSortedValues();
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const flushSuit = getSuitValues([sortedCards[0]]);  // ← CHANGE
    const handRankArray = [5, ...values, ...flushSuit];
    return {
        name: 'Flush',
        handType: 5,
        handStrength: handRankArray
    };
}

// STRAIGHT
function getStraightHand(analysis) {
    const straightInfo = analysis.getStraightInfo();
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [6, straightInfo.high, straightInfo.secondHigh, ...allSuitValues];
    return {
        name: 'Straight',
        handType: 6,
        handStrength: handRankArray
    };
}

// STRAIGHT FLUSH
function getStraightFlushHand(analysis) {
    const straightInfo = analysis.getStraightInfo();
    const name = straightInfo.high === 14 && straightInfo.secondHigh === 13 ? 'Royal Flush' : 'Straight Flush';
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const flushSuit = getSuitValues([sortedCards[0]]);  // ← CHANGE
    const handRankArray = [9, straightInfo.high, straightInfo.secondHigh, ...flushSuit];
    return {
        name: name,
        handType: 9,
        handStrength: handRankArray
    };
}

// 6-CARD STRAIGHT FLUSH
function getSixCardStraightFlushHand(analysis) {
    const straightInfo = analysis.getStraightInfo();
    const name = straightInfo.high === 14 && straightInfo.secondHigh === 13 ? 'Six-Card Royal Flush' : '6-Card Straight Flush';
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues([sortedCards[0]]);
    const handRankArray = [11, straightInfo.high, straightInfo.secondHigh, ...allSuitValues];
    return {
        name: name,
        handType: 11,
        handStrength: handRankArray
    };
}

// 7-CARD STRAIGHT FLUSH
function getSevenCardStraightFlushHand(analysis) {
    const straightInfo = analysis.getStraightInfo();
    const name = straightInfo.high === 14 && straightInfo.secondHigh === 13 ? 'Seven-Card Royal Flush' : '7-Card Straight Flush';
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues([sortedCards[0]]);
    const handRankArray = [13, straightInfo.high, straightInfo.secondHigh, ...allSuitValues];
    return {
        name: name,
        handType: 13,
        handStrength: handRankArray
    };
}

// 8-CARD STRAIGHT FLUSH
function getEightCardStraightFlushHand(analysis) {
    const straightInfo = analysis.getStraightInfo();
    const name = straightInfo.high === 14 && straightInfo.secondHigh === 13 ? 'Eight-Card Royal Flush' : '8-Card Straight Flush';
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues([sortedCards[0]]);
    const handRankArray = [15, straightInfo.high, straightInfo.secondHigh, ...allSuitValues];
    return {
        name: name,
        handType: 15,
        handStrength: handRankArray
    };
}

// FIVE OF A KIND (all same rank, sort by suit)
function getFiveOfAKindHand(analysis, valueCounts) {
    const fiveRank = valueCounts[5][0];
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [10, fiveRank, ...allSuitValues];
    return {
        name: 'Five of a Kind',
        handType: 10,
        handStrength: handRankArray
    };
}

// SIX OF A KIND
function getSixOfAKindHand(analysis, valueCounts) {
    const sixRank = valueCounts[6][0];
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [12, sixRank, ...allSuitValues];
    return {
        name: 'Six of a Kind',
        handType: 12,
        handStrength: handRankArray
    };
}

// SEVEN OF A KIND
function getSevenOfAKindHand(analysis, valueCounts) {
    const sevenRank = valueCounts[7][0];
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [14, sevenRank, ...allSuitValues];
    return {
        name: 'Seven of a Kind',
        handType: 14,
        handStrength: handRankArray
    };
}

// EIGHT OF A KIND
function getEightOfAKindHand(analysis, valueCounts) {
    const eightRank = valueCounts[8][0];
    const sortedCards = getStandardSortedCards(analysis.cards);  // ← ADD
    const allSuitValues = getSuitValues(sortedCards);  // ← CHANGE
    const handRankArray = [16, eightRank, ...allSuitValues];
    return {
        name: 'Eight of a Kind',
        handType: 16,
        handStrength: handRankArray
    };
}

// PAIR
function getPairHand(analysis, valueCounts) {
    const pairRank = valueCounts[2][0];
    const kickers = valueCounts[1];

    // Sort: pair first, then kickers descending
    const pairCards = analysis.cards.filter(c => c.value === pairRank);
    const kickerCards = analysis.cards.filter(c => c.value !== pairRank)
        .sort((a, b) => b.value - a.value);
    const sortedCards = [...pairCards, ...kickerCards];

    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [2, pairRank, ...kickers, ...allSuitValues];
    return {
        name: 'Pair',
        handType: 2,
        handStrength: handRankArray
    };
}

// TWO PAIR
function getTwoPairHand(analysis, valueCounts) {
    const pairs = valueCounts[2];
    const kicker = valueCounts[1][0];

    // Sort: higher pair, lower pair, kicker
    const higherPair = Math.max(...pairs);
    const lowerPair = Math.min(...pairs);
    const highPairCards = analysis.cards.filter(c => c.value === higherPair);
    const lowPairCards = analysis.cards.filter(c => c.value === lowerPair);
    const kickerCards = analysis.cards.filter(c => c.value === kicker);
    const sortedCards = [...highPairCards, ...lowPairCards, ...kickerCards];

    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [3, Math.max(...pairs), Math.min(...pairs), kicker, ...allSuitValues];
    return {
        name: 'Two Pair',
        handType: 3,
        handStrength: handRankArray
    };
}

// THREE OF A KIND
function getThreeOfAKindHand(analysis, valueCounts) {
    const tripsRank = valueCounts[3][0];
    const kickers = valueCounts[1];

    // Sort: trips first, then kickers descending
    const tripsCards = analysis.cards.filter(c => c.value === tripsRank);
    const kickerCards = analysis.cards.filter(c => c.value !== tripsRank)
        .sort((a, b) => b.value - a.value);
    const sortedCards = [...tripsCards, ...kickerCards];

    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [4, tripsRank, ...kickers, ...allSuitValues];
    return {
        name: 'Three of a Kind',
        handType: 4,
        handStrength: handRankArray
    };
}

// FULL HOUSE
function getFullHouseHand(analysis, valueCounts) {
    const tripsRank = valueCounts[3][0];
    const pairRank = valueCounts[2][0];

    // Sort: trips first, then pair
    const tripsCards = analysis.cards.filter(c => c.value === tripsRank);
    const pairCards = analysis.cards.filter(c => c.value === pairRank);
    const sortedCards = [...tripsCards, ...pairCards];

    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [7, tripsRank, pairRank, ...allSuitValues];
    return {
        name: 'Full House',
        handType: 7,
        handStrength: handRankArray
    };
}

// FOUR OF A KIND
function getFourOfAKindHand(analysis, valueCounts) {
    const quadRank = valueCounts[4][0];
    const kicker = valueCounts[1][0];

    // Sort: quads first, then kicker
    const quadCards = analysis.cards.filter(c => c.value === quadRank);
    const kickerCards = analysis.cards.filter(c => c.value === kicker);
    const sortedCards = [...quadCards, ...kickerCards];

    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [8, quadRank, kicker, ...allSuitValues];
    return {
        name: 'Four of a Kind',
        handType: 8,
        handStrength: handRankArray
    };
}

// Evaluate 3-card or 5-card front hands
//function evaluateThreeCardHand(cards) {
//    // Handle 5-card front hands
//    if (cards.length === 5) {
//        // Use the regular 5-card evaluation for 5-card front hands
//        return evaluateHand(cards);
//    }
//
//    // Handle wild cards in 3-card hands
//    const wildCards = cards.filter(c => c.isWild);
//    const normalCards = cards.filter(c => !c.isWild);
//
//    if (wildCards.length > 0) {
//        return evaluateThreeCardHandWithWilds(normalCards, wildCards.length);
//    }
//
//    const sortedCards = [...cards].sort((a, b) => b.value - a.value);
//    const values = sortedCards.map(c => c.value);
//
//    const valueCounts = {};
//    values.forEach(val => valueCounts[val] = (valueCounts[val] || 0) + 1);
//
//    const valuesByCount = {};
//    for (const [value, count] of Object.entries(valueCounts)) {
//        if (!valuesByCount[count]) valuesByCount[count] = [];
//        valuesByCount[count].push(parseInt(value));
//    }
//
//    for (const count in valuesByCount) {
//        valuesByCount[count].sort((a, b) => b - a);
//    }
//
//    // Handle edge cases first
//    if (cards.length === 1) {
//        const handRankArray = [1, 7];
//        return {
////            rank: 1,
////            hand_rank: handRankArray,
//            name: 'High Card',
//            handType: 1,                    // NEW - same as rank
//            handStrength: handRankArray     // NEW - same as hand_rank
//        };
//    }
//
//    if (cards.length === 2) {
//        const handRankArray = [1, 8, 7];
//        return {
////            rank: 1,
////            hand_rank: handRankArray,
//            name: 'High Card',
//            handType: 1,                    // NEW - same as rank
//            handStrength: handRankArray     // NEW - same as hand_rank
//        };
//    }
//
//    if (cards.length !== 3) {
//        const handRankArray = [1, 7];
//        return {
////            rank: 1,
////            hand_rank: handRankArray,
//            name: 'Invalid',
//            handType: 1,                    // NEW - same as rank
//            handStrength: handRankArray     // NEW - same as hand_rank
//        };
//    }
//
//    const counts = Object.keys(valuesByCount).map(Number).sort((a, b) => b - a);
//
//    // Found trip
//    if (counts[0] === 3) {
//        const tripsRank = valuesByCount[3][0];
//        const handRankArray = [4, tripsRank];
//        return {
////            rank: 4,
////            hand_rank: handRankArray,
//            name: 'Three of a Kind',
//            handType: 4,                    // NEW - same as rank
//            handStrength: handRankArray     // NEW - same as hand_rank
//        };
//    }
//
//    // found pair
//    if (counts[0] === 2) {
//        const pairRank = valuesByCount[2][0];
//        const kicker = valuesByCount[1][0];
//        const handRankArray = [2, pairRank, kicker];
//        return {
////            rank: 2,
////            hand_rank: handRankArray,
//            name: 'Pair',
//            handType: 2,                    // NEW - same as rank
//            handStrength: handRankArray     // NEW - same as hand_rank
//        };
//    }
//
//    // else it's a high card
//    const handRankArray = [1, ...values, ...allSuitValues];  // ✅ With suits
//    return {
////        rank: 1,
////        hand_rank: handRankArray,
//        name: 'High Card',
//        handType: 1,                    // NEW - same as rank
//        handStrength: handRankArray     // NEW - same as hand_rank
//    };
//}

// Evaluate 3-card hand with wild cards
function evaluateThreeCardHandWithWilds(normalCards, wildCount) {
    const values = normalCards.map(c => c.value).sort((a, b) => b - a);
    const highCard = values[0] || 14;

    // Get suit values from the normal cards for tie-breaking
    const allSuitValues = getSuitValues(normalCards);

    if (wildCount >= 2) {
        const handRankArray = [4, highCard, ...allSuitValues];
        return {
//            rank: 4,
//            hand_rank: handRankArray,
            name: 'Three of a Kind (Wild)',
            handType: 4,
            handStrength: handRankArray
        };
    }

    if (wildCount === 1) {
        const pairRank = highCard;
        const kicker = values.find(v => v !== pairRank) || 13;
        const handRankArray = [2, pairRank, kicker, ...allSuitValues];
        return {
//            rank: 2,
//            hand_rank: handRankArray,
            name: 'Pair (Wild)',
            handType: 2,
            handStrength: handRankArray
        };
    }

    const allValues = [...values];
    while (allValues.length < 3) allValues.push(13 - allValues.length);
    const handRankArray = [1, ...allValues.slice(0, 3), ...allSuitValues];
    return {
//        rank: 1,
//        hand_rank: handRankArray,
        name: 'High Card',
        handType: 1,
        handStrength: handRankArray
    };
}

// Evaluate hand with wild cards
function evaluateHandWithWilds(normalCards, wildCount) {
    const values = normalCards.map(c => c.value).sort((a, b) => b - a);
    const suits = normalCards.map(c => c.suit);

    // Count existing values and suits
    const valueCounts = {};
    values.forEach(val => valueCounts[val] = (valueCounts[val] || 0) + 1);

    const suitCounts = {};
    suits.forEach(suit => suitCounts[suit] = (suitCounts[suit] || 0) + 1);

    // Try for BEST possible hand (highest ranking first)

    // 1. Try for Five of a Kind
    for (const [value, count] of Object.entries(valueCounts)) {
        if (count + wildCount >= 5) {
            const fiveRank = parseInt(value);
            const handRankArray = [10, fiveRank];
            return {
//                rank: 10,
//                hand_rank: handRankArray,
                name: 'Five of a Kind (Wild)',
                handType: 10,
                handStrength: handRankArray
            };
        }
    }
    if (wildCount >= 4) {
        const highCard = values[0] || 14;
        const handRankArray = [10, highCard];
        return {
//            rank: 10,
//            hand_rank: handRankArray,
            name: 'Five of a Kind (Wild)',
            handType: 10,
            handStrength: handRankArray
        };
    }

    // 2. Try for Straight Flush
    const straightFlush = tryForStraightFlushWithWilds(normalCards, wildCount);
    if (straightFlush) return straightFlush;

    // 3. Try for Four of a Kind
    for (const [value, count] of Object.entries(valueCounts)) {
        if (count + wildCount >= 4) {
            const quadRank = parseInt(value);
            const remainingCards = normalCards.filter(c => c.value !== quadRank);
            const kicker = remainingCards.length > 0 ? Math.max(...remainingCards.map(c => c.value)) : 13;
            const handRankArray = [8, quadRank, kicker];
            return {
//                rank: 8,
//                hand_rank: handRankArray,
                name: 'Four of a Kind (Wild)',
                handType: 8,
                handStrength: handRankArray
            };
        }
    }
    if (wildCount >= 3) {
        const quadRank = values[0] || 14;
        const kicker = values[1] || 13;
        const handRankArray = [8, quadRank, kicker];
        return {
//            rank: 8,
//            hand_rank: handRankArray,
            name: 'Four of a Kind (Wild)',
            handType: 8,
            handStrength: handRankArray
        };
    }

    // 4. Try for Full House
    const pairs = Object.entries(valueCounts).filter(([v, c]) => c >= 2);
    const singles = Object.entries(valueCounts).filter(([v, c]) => c === 1);

    if (pairs.length >= 2 && wildCount >= 1) {
        const sortedPairs = pairs.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
        const tripsRank = parseInt(sortedPairs[0][0]);
        const pairRank = parseInt(sortedPairs[1][0]);
        const handRankArray = [7, tripsRank, pairRank];
        return {
//            rank: 7,
//            hand_rank: handRankArray,
            name: 'Full House (Wild)',
            handType: 7,
            handStrength: handRankArray
        };
    }
    if (pairs.length >= 1 && singles.length >= 1 && wildCount >= 2) {
        const pairRank = parseInt(pairs[0][0]);
        const singleRank = parseInt(singles[0][0]);
        const tripsRank = Math.max(pairRank, singleRank);
        const finalPairRank = Math.min(pairRank, singleRank);
        const handRankArray = [7, tripsRank, finalPairRank];
        return {
//            rank: 7,
//            hand_rank: handRankArray,
            name: 'Full House (Wild)',
            handType: 7,
            handStrength: handRankArray
        };
    }
    if (singles.length >= 2 && wildCount >= 3) {
        const sortedSingles = singles.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
        const tripsRank = parseInt(sortedSingles[0][0]);
        const pairRank = parseInt(sortedSingles[1][0]);
        const handRankArray = [7, tripsRank, pairRank];
        return {
//            rank: 7,
//            hand_rank: handRankArray,
            name: 'Full House (Wild)',
            handType: 7,
            handStrength: handRankArray
        };
    }

    // 5. Try for Flush
    const flush = tryForFlushWithWilds(normalCards, wildCount);
    if (flush) return flush;

    // 6. Try for Straight
    const straight = tryForStraightWithWilds(normalCards, wildCount);
    if (straight) return straight;

    // 7. Try for Three of a Kind
    for (const [value, count] of Object.entries(valueCounts)) {
        if (count + wildCount >= 3) {
            const tripsRank = parseInt(value);
            const remainingCards = normalCards.filter(c => c.value !== tripsRank);
            const kickers = remainingCards.map(c => c.value).sort((a, b) => b - a).slice(0, 2);
            while (kickers.length < 2) kickers.push(13 - kickers.length);
            const handRankArray = [4, tripsRank, ...kickers];
            return {
//                rank: 4,
//                hand_rank: handRankArray,
                name: 'Three of a Kind (Wild)',
                handType: 4,
                handStrength: handRankArray
            };
        }
    }
    if (wildCount >= 2) {
        const tripsRank = values[0] || 14;
        const remainingValues = values.filter(v => v !== tripsRank);
        const kickers = remainingValues.slice(0, 2);
        while (kickers.length < 2) kickers.push(13 - kickers.length);
        const handRankArray = [4, tripsRank, ...kickers];
        return {
//            rank: 4,
//            hand_rank: handRankArray,
            name: 'Three of a Kind (Wild)',
            handType: 4,
            handStrength: handRankArray
        };
    }

    // 8. Try for Two Pair
    if (pairs.length >= 1 && singles.length >= 1 && wildCount >= 1) {
        const pairRank = parseInt(pairs[0][0]);
        const secondPairRank = parseInt(singles[0][0]);
        const higherPair = Math.max(pairRank, secondPairRank);
        const lowerPair = Math.min(pairRank, secondPairRank);
        const kicker = singles.length > 1 ? parseInt(singles[1][0]) : 13;
        const handRankArray = [3, higherPair, lowerPair, kicker];
        return {
//            rank: 3,
//            hand_rank: handRankArray,
            name: 'Two Pair (Wild)',
            handType: 3,
            handStrength: handRankArray
        };
    }

    // 9. Try for Pair
    if (wildCount >= 1) {
        const pairRank = values[0] || 14;
        const remainingValues = values.filter(v => v !== pairRank);
        const kickers = remainingValues.slice(0, 3);
        while (kickers.length < 3) kickers.push(13 - kickers.length);
        const handRankArray = [2, pairRank, ...kickers];
        return {
//            rank: 2,
//            hand_rank: handRankArray,
            name: 'Pair (Wild)',
            handType: 2,
            handStrength: handRankArray
        };
    }

    // 10. High Card (fallback)
    const allValues = [...values];
    while (allValues.length < 5) allValues.push(14 - allValues.length);
    const handRankArray = [1, ...allValues.slice(0, 5)];
    return {
//        rank: 1,
//        hand_rank: handRankArray,
        name: 'High Card (Wild)',
        handType: 1,
        handStrength: handRankArray
    };
}

// Try for straight flush with wild cards
function tryForStraightFlushWithWilds(normalCards, wildCount) {
    // Group cards by suit
    const suitGroups = {};
    normalCards.forEach(card => {
        suitGroups[card.suit] = (suitGroups[card.suit] || []).concat(card);
    });

    // Check each suit to see if we can make a straight flush
    for (const [suit, cards] of Object.entries(suitGroups)) {
        if (cards.length + wildCount >= 5) {
            const values = cards.map(c => c.value).sort((a, b) => b - a);
            const uniqueValues = [...new Set(values)];

            // Try all possible straight flushes from HIGHEST to LOWEST
            const possibleStraights = [
                [14, 13, 12, 11, 10], // Royal Flush (A-K-Q-J-10)
                [13, 12, 11, 10, 9],  // K-Q-J-10-9
                [12, 11, 10, 9, 8],   // Q-J-10-9-8
                [11, 10, 9, 8, 7],    // J-10-9-8-7
                [10, 9, 8, 7, 6],     // 10-9-8-7-6
                [9, 8, 7, 6, 5],      // 9-8-7-6-5
                [8, 7, 6, 5, 4],      // 8-7-6-5-4
                [7, 6, 5, 4, 3],      // 7-6-5-4-3
                [6, 5, 4, 3, 2],      // 6-5-4-3-2
                [14, 5, 4, 3, 2]      // Steel Wheel (A-5-4-3-2)
            ];

            // Check each straight from highest to lowest
            for (const straight of possibleStraights) {
                const needed = straight.filter(v => !uniqueValues.includes(v)).length;
                if (needed <= wildCount) {
                    const straightInfo = getStraightInfo(straight);
                    const name = straight[0] === 14 && straight[1] === 13 ? 'Royal Flush (Wild)' : 'Straight Flush (Wild)';
                    const handRankArray = [9, straightInfo.high, straightInfo.secondHigh];
                    return {
//                        rank: 9,
//                        hand_rank: handRankArray,
                        name: name,
                        handType: 9,
                        handStrength: handRankArray
                    };
                }
            }
        }
    }
    return null;
}

// Try for flush with wild cards
function tryForFlushWithWilds(normalCards, wildCount) {
    const suitCounts = {};
    normalCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);

    for (const [suit, count] of Object.entries(suitCounts)) {
        if (count + wildCount >= 5) {
            const flushCards = normalCards.filter(c => c.suit === suit);
            const values = flushCards.map(c => c.value).sort((a, b) => b - a);

            // Add optimal high cards for the wild cards to make the best flush
            while (values.length < 5) {
                // Add the highest possible card that doesn't duplicate existing values
                let nextHighCard = 14; // Start with Ace
                while (values.includes(nextHighCard) && nextHighCard > 2) {
                    nextHighCard--;
                }
                values.push(nextHighCard);
                values.sort((a, b) => b - a); // Keep sorted
            }

            const handRankArray = [5, ...values.slice(0, 5)];
            return {
//                rank: 6,
//                hand_rank: handRankArray,
                name: 'Flush (Wild)',
                handType: 5,
                handStrength: handRankArray
            };
        }
    }
    return null;
}

// Try for straight with wild cards
function tryForStraightWithWilds(normalCards, wildCount) {
    const values = [...new Set(normalCards.map(c => c.value))].sort((a, b) => b - a);

    // Try all possible straights from HIGHEST to LOWEST to find the best one
    const possibleStraights = [
        [14, 13, 12, 11, 10], // A-K-Q-J-10 (Broadway - highest)
        [13, 12, 11, 10, 9],  // K-Q-J-10-9
        [12, 11, 10, 9, 8],   // Q-J-10-9-8
        [11, 10, 9, 8, 7],    // J-10-9-8-7
        [10, 9, 8, 7, 6],     // 10-9-8-7-6
        [9, 8, 7, 6, 5],      // 9-8-7-6-5
        [8, 7, 6, 5, 4],      // 8-7-6-5-4
        [7, 6, 5, 4, 3],      // 7-6-5-4-3
        [6, 5, 4, 3, 2],      // 6-5-4-3-2
        [14, 5, 4, 3, 2]      // A-5-4-3-2 (wheel - lowest)
    ];

    // Check each straight from highest to lowest - return the FIRST (highest) one that works
    for (const straight of possibleStraights) {
        const needed = straight.filter(v => !values.includes(v)).length;
        if (needed <= wildCount) {
            const straightInfo = getStraightInfo(straight);
            const handRankArray = [6, straightInfo.high, straightInfo.secondHigh];
            return {
//                rank: 5,
//                hand_rank: handRankArray,
                name: 'Straight (Wild)',
                handType: 6,
                handStrength: handRankArray
            };
        }
    }
    return null;
}

// * Evaluate a 3-card hand (for front position)
// * Returns same structure as evaluateHand for consistency
function evaluateThreeCardHand(cards) {
    // Handle 5-card front hands
    if (cards.length === 5) {
        // Use the regular 5-card evaluation for 5-card front hands
        return evaluateHand(cards);
    }

    // Handle wild cards in 3-card hands
    const wildCards = cards.filter(c => c.isWild);
    const normalCards = cards.filter(c => !c.isWild);
    const wildCount = cards.length - normalCards.length;

    // Handle wild cards if present
    if (wildCount > 0) {
        return evaluateThreeCardHandWithWilds(normalCards, wildCount);
    }

    const values = normalCards.map(c => c.value).sort((a, b) => b - a);

    // Count value occurrences
    const valueCounts = {};
    values.forEach(val => valueCounts[val] = (valueCounts[val] || 0) + 1);

    const valuesByCount = {};
    for (const [value, count] of Object.entries(valueCounts)) {
        if (!valuesByCount[count]) valuesByCount[count] = [];
        valuesByCount[count].push(parseInt(value));
    }

    for (const count in valuesByCount) {
        valuesByCount[count].sort((a, b) => b - a);
    }

    // Handle edge cases first
    if (cards.length === 1) {
        const handRankArray = [1, 7];
        return {
            name: 'High Card',
            handType: 1,
            handStrength: handRankArray
        };
    }

    if (cards.length === 2) {
        const handRankArray = [1, 8, 7];
        return {
            name: 'High Card',
            handType: 1,
            handStrength: handRankArray
        };
    }

    if (cards.length !== 3) {
        const handRankArray = [1, 7];
        return {
            name: 'Invalid',
            handType: 1,
            handStrength: handRankArray
        };
    }

    const counts = Object.keys(valuesByCount).map(Number).sort((a, b) => b - a);

    // Found trips
    if (counts[0] === 3) {
        const tripsRank = valuesByCount[3][0];

        // All same rank - use standard sort
        const sortedCards = getStandardSortedCards(normalCards);
        const allSuitValues = getSuitValues(sortedCards);

        const handRankArray = [4, tripsRank, ...allSuitValues];
        return {
            name: 'Three of a Kind',
            handType: 4,
            handStrength: handRankArray
        };
    }

    // Found pair
    if (counts[0] === 2) {
        const pairRank = valuesByCount[2][0];
        const kicker = valuesByCount[1][0];

        // Sort: pair first, then kicker
        const pairCards = normalCards.filter(c => c.value === pairRank);
        const kickerCards = normalCards.filter(c => c.value === kicker);
        const sortedCards = [...pairCards, ...kickerCards];
        const allSuitValues = getSuitValues(sortedCards);

        const handRankArray = [2, pairRank, kicker, ...allSuitValues];
        return {
            name: 'Pair',
            handType: 2,
            handStrength: handRankArray
        };
    }

    // High card (all different ranks)
    const sortedCards = getStandardSortedCards(normalCards);
    const allSuitValues = getSuitValues(sortedCards);
    const handRankArray = [1, ...values, ...allSuitValues];
    return {
        name: 'High Card',
        handType: 1,
        handStrength: handRankArray
    };
}

// Evaluate 3-card hand with wild cards
function evaluateThreeCardHandWithWilds(normalCards, wildCount) {
    const values = normalCards.map(c => c.value).sort((a, b) => b - a);
    const highCard = values[0] || 14;

    const allSuitValues = getSuitValues(normalCards);

    if (wildCount >= 2) {
        const handRankArray = [4, highCard, ...allSuitValues];
        return {
//            rank: 4,
//            hand_rank: handRankArray,
            name: 'Three of a Kind (Wild)',
            handType: 4,
            handStrength: handRankArray
        };
    }

    if (wildCount === 1) {
        const pairRank = highCard;
        const kicker = values.find(v => v !== pairRank) || 13;
        const handRankArray = [2, pairRank, kicker, ...allSuitValues];
        return {
//            rank: 2,
//            hand_rank: handRankArray,
            name: 'Pair (Wild)',
            handType: 2,
            handStrength: handRankArray
        };
    }

    const allValues = [...values];
    while (allValues.length < 3) allValues.push(13 - allValues.length);
    const handRankArray = [1, ...allValues.slice(0, 3), ...allSuitValues];
    return {
//        rank: 1,
//        hand_rank: handRankArray,
        name: 'High Card',
        handType: 1,
        handStrength: handRankArray
    };
}

// Universal straight info - handles both value arrays and pre-sorted straight arrays
// CORRECTED: Changed 'low' to 'secondHigh' for clarity
function getStraightInfo(input) {
    let values;

    // Handle different input formats
    if (Array.isArray(input) && input.length === 5) {
        // If it's already a 5-element array, assume it's pre-sorted high-to-low
        if (input[0] >= input[1] && input[1] >= input[2]) {
            values = input; // Already sorted
        } else {
            values = [...input].sort((a, b) => b - a); // Sort if needed
        }
    } else {
        // Handle Set, unsorted array, or other iterable
        values = [...input].sort((a, b) => b - a);
    }

    // Check for wheel straight (A-5-4-3-2)
    if (values.includes(14) && values.includes(5) && values.includes(4) && values.includes(3) && values.includes(2)) {
        return { high: 14, secondHigh: 5 }; // Wheel: ace=14, five is second-highest in wheel
    }

    // Regular straight - return highest and second-highest
    return { high: values[0], secondHigh: values[1] };
}

// Convert card suits to numeric values for tiebreaking
// Spades=4, Hearts=3, Diamonds=2, Clubs=1
function getSuitValues(cards) {
    const suitRanks = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };
    return cards.map(card => suitRanks[card.suit] || 0);
}
