// js/hands/scoring-utilities.js
// SINGLE SOURCE OF TRUTH for all Pyramid Poker scoring

class ScoringUtilities {

    // =============================================================================
    // CORE SCORING: Official Pyramid Poker point values
    // =============================================================================

static getPointsForHand(hand, position, cardCount = null) {
    const utilities = handUtilities();
    const handTypeCode = hand.handType;  // Get the numeric code (1-16)
    return utilities.getPointValue(handTypeCode, position.toLowerCase());
}

// =============================================================================
    // PROBABILITY ESTIMATION
    // =============================================================================

    static estimateWinProbability(handStrength, position, playerCount = 4) {
        // Estimate based on hand rank (0-10 scale) and position
        const rank = handStrength.handType;

        // Base probabilities for 4-player game (adjustable for different player counts)
        const baseProbabilities = {
            16: 1.00, // Very strong large hands
            15: 0.99,
            14: 0.98,
            13: 0.97,
            12: 0.96,
            11: 0.95, // Strong large hands
            10: 0.94, // Five of a kind - very likely to win
            9: 0.93,  // Straight flush - strong
            8: 0.65,  // Four of a kind - good
            7: 0.55,  // Full house - decent
            6: 0.45,  // Flush - okay
            5: 0.40,  // Straight - okay
            4: 0.35,  // Three of a kind - weak
            3: 0.25,  // Two pair - weak
            2: 0.20,  // One pair - very weak
            1: 0.15,  // High card - very weak
            0: 0.10   // Fallback
        };

        let probability = baseProbabilities[rank] || 0.10;

        // Adjust for player count
        if (playerCount !== 4) {
            const adjustment = Math.pow(probability, (playerCount - 1) / 3);
            probability = adjustment;
        }

        // Position adjustments
        const pos = position.toLowerCase();
        if (pos === 'front') {
            // Front hands are harder to win with weaker hands
            if (rank < 4) probability *= 0.8;
        } else if (pos === 'back') {
            // Back hands with strong cards more likely to win
            if (rank >= 7) probability *= 1.1;
        }

        return Math.min(probability, 0.95); // Cap at 95%
    }

    // =============================================================================
    // EXPECTED VALUE CALCULATION
    // =============================================================================

    // Updated ScoringUtilities.getExpectedPoints method

    static getExpectedPoints(hand, cards, position, playerCount = 4, method = null) {
        const actualMethod = method ||
                            window.WIN_PROB_OVERRIDE ||
                            window.gameConfig?.config?.winProbabilityMethod ||
                            'tiered2';

        if (actualMethod === 'points') {
            const pointsIfWin = hand.positionScores[position];
            const strengthBonus = this.calculateTiebreaker(hand.handStrength);
            return pointsIfWin + strengthBonus;
        } else if (actualMethod === 'netEV') {
            // Batch rebuild scores from the tiered2 win rate. The interpolated table is not used.
            if (window.NETEV_USE_TIERED2_FORMULA) {
                return this.netEVFromTiered2Rate(hand, position);
            }
//            console.log(`scoringUtilities lookup: ${position}  ${hand.hand_rank}`)
            const netEV = lookupNetEV(position, hand);

            if (netEV !== null) {
                return netEV;
            } else {
                // ✅ FIXED: Proper NetEV fallback calculation
                const winProb = this.getWinProbabilityForMethod('tiered2', position, hand);
                const lossProb = 1 - winProb;
                const pointsIfWin = hand.positionScores[position];

                // Estimate loss penalty based on position and hand strength
                let lossPenalty;
                const handType = hand.handType;

                if (position.toLowerCase() === 'front') {
                    // Front position loss penalties
                    lossPenalty = handType >= 3 ? 1 : 2;  // Trips lose 1, pairs/high card lose 2
                } else if (position.toLowerCase() === 'middle') {
                    // Middle position loss penalties
                    lossPenalty = handType >= 5 ? 2 : 4;  // Straights+ lose 2, others lose 4
                } else {
                    // Back position loss penalties
                    lossPenalty = handType >= 7 ? 4 : 6;  // Full house+ lose 4, others lose 6
                }

                // Proper NetEV calculation
                const netEV = (winProb * pointsIfWin) - (lossProb * lossPenalty);

                console.log(`🎯 NetEV fallback: ${position} winProb=${winProb.toFixed(3)} pointsIfWin=${pointsIfWin} lossPenalty=${lossPenalty} → netEV=${netEV.toFixed(3)}`);

                return netEV;
            }

        } else {
            // All existing probability-based methods (empirical, tiered, tiered2)
            const winProb = this.getWinProbabilityForMethod(actualMethod, position, hand);
            const pointsIfWin = hand.positionScores[position];
            return winProb * pointsIfWin;
        }
    }

// Also add the import at the top of your file:
// import { lookupNetEV, initializeNetEVLookup } from './net-ev-lookup.js';

// And initialize in your startup code:
// await initializeNetEVLookup();

    static numericHandType(hand) {
        if (typeof hand.strength === 'number') return hand.strength;
        if (typeof hand.handType === 'number') return hand.handType;
        const rank = hand.hand_rank || hand.handStrength?.handStrength;
        if (Array.isArray(rank) && typeof rank[0] === 'number') return rank[0];
        if (hand.handStrength && typeof hand.handStrength.handType === 'number') return hand.handStrength.handType;
        return 0;
    }

    static seatPoints(hand, position) {
        const pos = String(position).toLowerCase();
        const scored = hand.positionScores && hand.positionScores[pos];
        if (typeof scored === 'number' && !Number.isNaN(scored)) return scored;
        return handUtilities().getPointValue(this.numericHandType(hand), pos);
    }

    static lossPenalty(handType, position) {
        const pos = String(position).toLowerCase();
        if (pos === 'front') return handType >= 3 ? 1 : 2;
        if (pos === 'middle') return handType >= 5 ? 2 : 4;
        return handType >= 7 ? 4 : 6;
    }

    static netEVFromWinRate(position, handType, winRate, points = null) {
        const p = (winRate == null || Number.isNaN(Number(winRate))) ? 0 : Number(winRate);
        const seatPoints = points == null
            ? handUtilities().getPointValue(handType, String(position).toLowerCase())
            : points;
        const penalty = this.lossPenalty(handType, position);
        return (p * seatPoints) - ((1 - p) * penalty);
    }

    static netEVFromTiered2Rate(hand, position) {
        const winProb = this.getWinProbabilityForMethod('tiered2', position, hand);
        return this.netEVFromWinRate(position, this.numericHandType(hand), winProb, this.seatPoints(hand, position));
    }

    static getWinProbabilityForMethod(method, position, hand) {
        switch(method) {
            case 'empirical':
                return lookupEmpiricalWinProbability(position, hand);
            case 'tiered':
                return lookupTieredWinProbability(position, hand);
            case 'tiered2':
                return lookupTiered2WinProbability(position, hand);
            case 'netEV':
                return lookupNetEVLookup(position, hand);
            default:
                return 0.5; // fallback
        }
    }


    // =============================================================================
    // FORMATTING AND DISPLAY HELPERS
    // =============================================================================

    static formatPointDisplay(hand, position, cardCount) {
        const points = this.getPointsForHand(hand, position, cardCount);

        // Show card count for large hands
        if (cardCount > 5) {
            return `${points} pts (${cardCount}-card)`;
        }

        return `${points} pts`;
    }

    static formatWinProbability(probability) {
        return `${(probability * 100).toFixed(1)}%`;
    }

    static formatExpectedPoints(expectedPoints) {
        return expectedPoints.toFixed(2);
    }


    // ========================================================================git =====
    // VALIDATION HELPERS
    // =============================================================================

    static isValidArrangement(backStrength, middleStrength, frontStrength) {
        // Check if arrangement meets game rules: Back >= Middle >= Front
        const backRank = backStrength.handType;
        const middleRank = middleStrength.handType;
        const frontRank = frontStrength.handType;

        // Allow some flexibility for same rank (e.g., back flush vs middle flush)
        return backRank >= middleRank && middleRank >= frontRank - 1;
    }

    static getArrangementValidationMessage(backStrength, middleStrength, frontStrength) {
        if (this.isValidArrangement(backStrength, middleStrength, frontStrength)) {
            return "✅ Valid arrangement";
        }

        const backRank = backStrength.handType;
        const middleRank = middleStrength.handType;
        const frontRank = frontStrength.handType;

        if (backRank < middleRank) {
            return "❌ Back hand must be >= Middle hand";
        }
        if (middleRank < frontRank - 1) {
            return "❌ Middle hand must be >= Front hand";
        }

        return "❌ Invalid arrangement";
    }

    // =============================================================================
    // DEBUGGING AND ANALYSIS
    // =============================================================================

    static debugHandScoring(hand, position, cardCount, label = "") {
//        console.log(`\n🎯 ${label} Hand Scoring Debug:`);
//        console.log(`Position: ${position}`);
//        console.log(`Hand: ${hand.name}`);
//        console.log(`Cards: ${cardCount}`);
//        console.log(`Points if Win: ${this.getPointsForHand(hand, position, cardCount)}`);
//        console.log(`Win Probability: ${this.formatWinProbability(this.estimateWinProbability(hand, position))}`);
//        console.log(`Expected Points: ${this.formatExpectedPoints(this.getExpectedPoints(hand, {length: cardCount}, position))}`);
    }

    // =============================================================================
    // QUICK REFERENCE TABLES (for debugging/verification)
    // =============================================================================

    static getPointsReferenceTable() {
        return {
            front: {
                "Three of a Kind": 3,
                "Flush": 4,
                "Straight": 4,
                "Full House": 5,
                "Four of a Kind": 12,
                "Straight Flush": 15,
                "Five of a Kind": 18
            },
            middle: {
                "Full House": 2,
                "Four of a Kind": 8,
                "Straight Flush": 10,
                "Five of a Kind": 12,
                "6-card Straight Flush": 16,
                "7-card Straight Flush": 22,
                "6 of a Kind": 20,
                "7 of a Kind": 28
            },
            back: {
                "Four of a Kind": 4,
                "Straight Flush": 5,
                "Five of a Kind": 6,
                "6-card Straight Flush": 8,
                "7-card Straight Flush": 11,
                "8-card Straight Flush": 14,
                "6 of a Kind": 10,
                "7 of a Kind": 14,
                "8 of a Kind": 18
            }
        };
    }

    static printPointsReference() {
        const table = this.getPointsReferenceTable();
//        console.log("\n📊 Pyramid Poker Points Reference:");

        Object.keys(table).forEach(position => {
//            console.log(`\n${position.toUpperCase()} HAND:`);
            Object.entries(table[position]).forEach(([hand, points]) => {
//                console.log(`  ${hand}: ${points} points`);
            });
        });
    }

    // Add this helper method inside the ScoringUtilities class
    static calculateTiebreaker(hand_rank) {
        if (!hand_rank || hand_rank.length < 2) return 0;

        // Combine all ranking elements with decreasing weights
        let tiebreaker = 0;
        for (let i = 1; i < hand_rank.length; i++) {
            tiebreaker += hand_rank[i] * Math.pow(0.01, i);
        }
        return tiebreaker;
    }

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScoringUtilities;
}
