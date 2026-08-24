// js/arrange/best-arrangement-generator.js v1
// Greedy branch-and-bound algorithm to find optimal arrangement
// Starts with strongest hands and uses pruning to avoid exhaustive search

class FindBestSetupNoWildBase {
    constructor(options = {}) {
        this.bestScore = -Infinity;
        this.bestArrangement = null;
        this.exploredNodes = 0;
        this.prunedNodes = 0;

        // Default true to preserve existing "BEST" button UI behavior unchanged
        this.collectTopArrangements = options.collectTopArrangements !== false;

        this.topArrangements = [];  // Array to track top N arrangements
        this.maxTopN = 5;          // Keep top n arrangememts
        this.pruningBuffer = 2;    // Allow arrangements within n points of best — UNCHANGED, correctness-relevant

    }

    /**
     * Find the best single arrangement using greedy branch-and-bound
     * @param {Array} sortedHands - Hands sorted by strength (strongest first)
     * @param {Array} allCards - All 17 cards for kicker completion
     * @returns {Object} - Best arrangement with score and statistics
     */
    findBestSetupNoWild(allCards) {

//        console.log(`🎯 FindBestSetupNoWild: Finding optimal setup from 17 cards...`);

        // NEW: Call hand-detector first
        const handDetector = new HandDetector(allCards);
        const detectionResults = handDetector.results;
        const sortedHands = detectionResults.hands;
        const completedTopArrangements = []

        // Rest of existing logic...
        this.allCards = allCards;
        this.resetSearch();
        const startTime = performance.now();

        // Try each valid back hand (strongest first)
        for (let backIdx = 0; backIdx < sortedHands.length; backIdx++) {
            const backHand = sortedHands[backIdx];

            if (!this.canUseInPosition(backHand, 'back')) continue;

            this.searchMiddleHands(sortedHands, backHand, backIdx);

            // Early termination if we've found a very strong arrangement
            if (this.shouldTerminateEarly()) break;
        }

        const endTime = performance.now();

        // Complete the best arrangement with kickers if we have cards available
        let finalArrangement = this.bestArrangement;
        if (finalArrangement && this.allCards) {
            finalArrangement = this.addKickersToArrangement(finalArrangement);
//            // finalArrangement is set. We can calculate back, middle and front scores
//            // finalArrangement.back is the back hand in Hand model
            const backHandScore = this.getHandScore(finalArrangement.back, 'back')
            const middleHandScore = this.getHandScore(finalArrangement.middle, 'middle')
            const frontHandScore = this.getHandScore(finalArrangement.front, 'front')
            const totalHandScore = backHandScore + middleHandScore + frontHandScore
//            console.log ("findBestNoWild", backHandScore, middleHandScore, frontHandScore, totalHandScore)
        }

        // Before your return statement (it's already sorting, just add the filter):
        if (this.collectTopArrangements && this.topArrangements && this.topArrangements.length > 0) {
            this.topArrangements = this.getStrategicallyDifferentArrangements(this.topArrangements);
            this.topArrangements.sort((a, b) => b.score - a.score);
        }

        return {
            arrangement: finalArrangement,
            score: this.bestScore,
            success: finalArrangement !== null,
            topArrangements: this.topArrangements,  // Your new field
            statistics: {
                exploredNodes: this.exploredNodes,
                prunedNodes: this.prunedNodes,
                searchTime: endTime - startTime,
                efficiency: this.prunedNodes / (this.exploredNodes + this.prunedNodes)
            }
        };
    }

    /**
     * Complete arrangement by adding kickers to incomplete hands
     * @param {Object} arrangement - {back, middle, front} with hand objects
     * @returns {Object} - Completed arrangement with card arrays
     */
    addKickersToArrangement(arrangement) {
//        console.log('🔧 Completing arrangement with kickers...');

        const usedCardIds = new Set([
            ...Analysis.getCardIds(arrangement.back.cards),
            ...Analysis.getCardIds(arrangement.middle.cards),
            ...Analysis.getCardIds(arrangement.front.cards)
        ]);

        // Get unused cards sorted by strength (highest first)
        const unusedCards = Analysis.sortCards(
            this.allCards.filter(card => !usedCardIds.has(card.id))
        );

        let kickerIndex = 0;

        // Complete front hand to 3 cards if needed
        const frontCards = [...arrangement.front.cards];
        if (frontCards.length < 3) {
            const needed = 3 - frontCards.length;
            // Skip candidate if it matches any existing card rank in front

            for (let i = 0; i < needed && kickerIndex < unusedCards.length; ) {
                const candidateCard = unusedCards[kickerIndex++];

                // Check if this card would make trips
                const wouldMakeTrips = frontCards.some(card => card.value === candidateCard.value);

                if (wouldMakeTrips) {
                    continue; // Skip this card, don't increment i
                }

                // Safe to add
                else {
                    frontCards.push(candidateCard);
                    i++; // Only increment i when we actually add a card
                }
            }
        }

        // Complete back hand to 5 cards if needed
        const backCards = [...arrangement.back.cards];
        if (backCards.length < 5) {
            const needed = 5 - backCards.length;

            for (let i = 0; i < needed && kickerIndex < unusedCards.length; ) {
                // Get current counts of back hand
                const beforeCounts = this.countSameRanks(backCards);

                // Create test hand with candidate card (don't modify original yet)
                const candidateCard = unusedCards[kickerIndex++];
                const testHand = [...backCards, candidateCard];

                // Check counts of test hand
                const afterCounts = this.countSameRanks(testHand);

                // If counts would change, skip this card
                if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
                    continue; // Try next card without adding this one
                }

                // Safe to add - counts don't change
                backCards.push(candidateCard);
                i++; // Move to next needed card
            }
        }

            // Complete middle hand to 5 cards if needed
            const middleCards = [...arrangement.middle.cards];
            if (middleCards.length < 5) {
                const needed = 5 - middleCards.length;

                for (let i = 0; i < needed && kickerIndex < unusedCards.length; ) {
                    // Get current counts of middle hand
                    const beforeCounts = this.countSameRanks(middleCards);

                    // Create test hand with candidate card (don't modify original yet)
                    const candidateCard = unusedCards[kickerIndex++];
                    const testHand = [...middleCards, candidateCard];

                    // Check counts of test hand
                    const afterCounts = this.countSameRanks(testHand);

                    // If counts would change, skip this card
                    if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
                        continue; // Try next card without adding this one
                    }

                    // Safe to add - counts don't change
                    middleCards.push(candidateCard);
                    i++; // Move to next needed card
                }
            }


//        console.log(`✅ Completed arrangement: Back(${backCards.length}), Middle(${middleCards.length}), Front(${frontCards.length})`);

        // Re-evaluate hands with complete cards using card-evaluation.js functions
        const reEvaluatedBack = evaluateHand(backCards);  // Always returns rank (handType, and hand_rank (called handStrength or hand_tuple sometimes)
        const reEvaluatedMiddle = evaluateHand(middleCards);
        const reEvaluatedFront = evaluateThreeCardHand(frontCards);  // Evaluate front cards

        arrangement.back.handStrength = reEvaluatedBack; // object returned from evaluateHand
        arrangement.back.hand_rank = reEvaluatedBack.handStrength; // hand_tuple
        arrangement.back.strength = reEvaluatedBack.handType; // handType 1-16

        arrangement.middle.handStrength = reEvaluatedMiddle;
        arrangement.middle.hand_rank = reEvaluatedMiddle.handStrength;
        arrangement.middle.strength = reEvaluatedMiddle.handType;

        arrangement.front.handStrength = reEvaluatedFront;
        arrangement.front.hand_rank = reEvaluatedFront.handStrength;
        arrangement.front.strength = reEvaluatedFront.handType;

        // calculate score for each hand?
        const scoreBack = this.getHandScore(arrangement.back, 'back')
        const scoreMiddle = this.getHandScore(arrangement.middle, 'middle')
        const scoreFront = this.getHandScore(arrangement.front, 'front')
        const totalScore = scoreBack + scoreMiddle + scoreFront

        // After adding all kickers, calculate remaining staging cards
        const remainingCards = unusedCards.slice(kickerIndex);

        // In addKickersToArrangement() - use factory
        return createArrangement(
            { ...arrangement.back, cards: backCards, cardCount: backCards.length, isIncomplete: false },
            { ...arrangement.middle, cards: middleCards, cardCount: middleCards.length, isIncomplete: false },
            { ...arrangement.front, cards: frontCards, cardCount: frontCards.length, isIncomplete: false },
            totalScore, // score calculated elsewhere
            remainingCards,  // stagingCards
            true,
            scoreFront,
            scoreMiddle,
            scoreBack
        );
    }

    countSameRanks(cards) {
        const ranks = {};
        cards.forEach(card => {
            ranks[card.value] = (ranks[card.value] || 0) + 1;
        });

        let pairs = 0;
        let trips = 0;
        let quads = 0;
        let fives = 0;

        Object.values(ranks).forEach(count => {
            if (count === 2) pairs++;
            else if (count === 3) trips++;
            else if (count === 4) quads++;
            else if (count === 5) fives++;
        });

        return { pairs, trips, quads, fives };
    }


    searchMiddleHands(sortedHands, backHand, backIdx) {
        const backUsedCards = new Set(Analysis.getCardIds(backHand.cards));

        for (let middleIdx = backIdx; middleIdx < sortedHands.length; middleIdx++) {
            const middleHand = sortedHands[middleIdx];

            if (!this.canUseInPosition(middleHand, 'middle')) continue;
            if (this.hasCardOverlap(backUsedCards, middleHand.cards)) continue;

            // DEBUG: Check pruning logic
            const partialScore = this.calculatePartialScore(backHand, middleHand);
            const maxFrontScore = this.estimateMaxFrontScore(sortedHands, middleIdx);
            const estimatedTotal = partialScore + maxFrontScore;

//            console.log(`🔍 PRUNING CHECK: Partial=${partialScore.toFixed(2)}, MaxFront=${maxFrontScore.toFixed(2)}, Total=${estimatedTotal.toFixed(2)}, Best=${this.bestScore.toFixed(2)}`);

            if (partialScore + maxFrontScore <= this.bestScore - this.pruningBuffer) {
                this.prunedNodes++;
//                console.log(`✂️ PRUNED: ${estimatedTotal.toFixed(2)} <= ${this.bestScore.toFixed(2)}`);
                continue;
            }

            this.searchFrontHands(sortedHands, backHand, middleHand, backUsedCards, middleIdx);
        }
    }

    /**
     * Search for compatible front hands
     * @param {Array} sortedHands - All hands
     * @param {Object} backHand - Selected back hand
     * @param {Object} middleHand - Selected middle hand
     * @param {Set} backUsedCards - Cards used by back hand
     * @param {number} middleIdx - Index of middle hand
     */
    searchFrontHands(sortedHands, backHand, middleHand, backUsedCards, middleIdx) {
        const allUsedCards = new Set([
            ...backUsedCards,
            ...Analysis.getCardIds(middleHand.cards)
        ]);


        // Try front hands (same strength or weaker than middle)
        for (let frontIdx = middleIdx; frontIdx < sortedHands.length; frontIdx++) {
            const frontHand = sortedHands[frontIdx];

            if (!this.canUseInPosition(frontHand, 'front')) continue;
            if (this.hasCardOverlap(allUsedCards, frontHand.cards)) continue;

            this.exploredNodes++;
            
            // Calculate full arrangement score
            const arrangement = { back: backHand, middle: middleHand, front: frontHand };
            const backScore = this.getHandScore(arrangement.back, 'back');
            const middleScore = this.getHandScore(arrangement.middle, 'middle');
            const frontScore = this.getHandScore(arrangement.front, 'front');

            const score = backScore + middleScore + frontScore;

            // DEBUG: Log the detailed scoring breakdown
//            console.log(`🔍 SCORING DEBUG: Total=${score} (Back=${backScore} + Middle=${middleScore} + Front=${frontScore})`);
//            console.log(`   Back: ${arrangement.back.handType}(${arrangement.back.rank}) - ${arrangement.back.cards?.length || 0} cards`);
//            console.log(`   Middle: ${arrangement.middle.handType}(${arrangement.middle.rank}) - ${arrangement.middle.cards?.length || 0} cards`);
//            console.log(`   Front: ${arrangement.front.handType}(${arrangement.front.rank}) - ${arrangement.front.cards?.length || 0} cards`);
//

            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestArrangement = arrangement;  // Keep as reference for now
                this.logArrangement(arrangement);
            }

//            // ADD THIS LINE AFTER THE ABOVE BLOCK:
//            this.updateTopArrangements(arrangement, score);
            // In searchFrontHands (or wherever you call updateTopArrangements):
            if (this.collectTopArrangements) {
                const clonedArrangement = JSON.parse(JSON.stringify(arrangement));
                const completedArrangement = this.addKickersToArrangement(clonedArrangement);
                this.updateTopArrangements(completedArrangement, completedArrangement.score);
            }

        }
    }

    /**
     * Check if hand can be used in specified position
     * @param {Object} hand - Hand object
     * @param {string} position - 'back', 'middle', or 'front'
     * @returns {boolean} - True if hand can be used in position
     */
    canUseInPosition(hand, position) {
        return hand.validPositions && hand.validPositions.includes(position);
    }

    /**
     * Check if new cards overlap with used cards
     * @param {Set} usedCards - Set of card IDs already used
     * @param {Array} newCards - Array of card objects to check
     * @returns {boolean} - True if there's overlap
     */
    hasCardOverlap(usedCards, newCards) {
        return newCards.some(card => usedCards.has(card.id));
    }

    /**
     * Calculate partial score for back + middle (for pruning)
     * @param {Object} backHand - Back hand
     * @param {Object} middleHand - Middle hand
     * @returns {number} - Partial score using actual Pyramid Poker points
     */
    calculatePartialScore(backHand, middleHand) {
        const backScore = ScoringUtilities.getExpectedPoints(backHand, backHand.cards, 'back');
        const middleScore = ScoringUtilities.getExpectedPoints(middleHand, middleHand.cards, 'middle');
        return backScore + middleScore;
    }

    /**
     * Estimate maximum possible front score for pruning
     * @param {Array} sortedHands - All hands
     * @param {number} startIdx - Index to start searching from
     * @returns {number} - Estimated maximum front score using actual Pyramid Poker points
     */
    estimateMaxFrontScore(sortedHands, startIdx) {
        // Find strongest hand that could be front and calculate its actual points
        for (let i = startIdx; i < Math.min(startIdx + 50, sortedHands.length); i++) {
            const hand = sortedHands[i];
            if (this.canUseInPosition(hand, 'front')) {
                return ScoringUtilities.getExpectedPoints(hand, hand.cards, 'front');
            }
        }
        return 0;
    }

    /**
     * Get score for a hand in a specific position
     * @param {Object} hand - Hand object
     * @param {string} position - Position ('back', 'middle', 'front')
     * @returns {number} - Hand score for that position
     */

    getHandScore(hand, position) {
       // Use expected value (probability × points) for better optimization
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position);
    }

    /**
     * Check if search should terminate early
     * @returns {boolean} - True if should terminate
     */
    shouldTerminateEarly() {
        // Terminate if we've found a very high-scoring arrangement
        // or explored enough nodes
        return this.bestScore > 1000 || this.exploredNodes > 100000;
    }

    /**
     * Reset search state
     */
    resetSearch() {
        // this.bestScore = -Infinity;
        this.bestArrangement = null;
        this.exploredNodes = 0;
        this.prunedNodes = 0;
    }

    /**
     * Log arrangement details for debugging
     * @param {Object} arrangement - Arrangement to log
     */
    logArrangement(arrangement) {

        // Show cards used
        const totalCards = arrangement.back.cards.length +
                          arrangement.middle.cards.length +
                          arrangement.front.cards.length;
//        console.log(`   Total cards used: ${totalCards}/17`);
    }

    /**
     * Validate arrangement follows game rules
     * @param {Object} arrangement - Arrangement to validate
     * @returns {Object} - Validation result
     */
    validateArrangement(arrangement) {
        const issues = [];

        // Check card count
        const totalCards = arrangement.back.cards.length +
                          arrangement.middle.cards.length +
                          arrangement.front.cards.length;

        if (totalCards > 17) {
            issues.push(`Too many cards used: ${totalCards}/17`);
        }

        // Check no card overlap
        const allCards = [
            ...arrangement.back.cards,
            ...arrangement.middle.cards,
            ...arrangement.front.cards
        ];

        const cardIds = Analysis.getCardIds(allCards);
        const uniqueCardIds = new Set(cardIds);

        if (cardIds.length !== uniqueCardIds.size) {
            issues.push('Card overlap detected');
        }

        // Check strength order (using hand_rank comparison)
        // TODO: Implement proper hand strength comparison

        return {
            isValid: issues.length === 0,
            issues: issues,
            totalCards: totalCards,
            cardOverlap: cardIds.length !== uniqueCardIds.size
        };

    }

    getStrategicallyDifferentArrangements(allArrangements) {
        const uniqueArrangements = [];

        for (const item of allArrangements) {
            const arrangement = item.arrangement;

            // Check if this arrangement strategy is already represented
            const isDuplicate = uniqueArrangements.some(existing =>
                this.areStrategicallySimilar(arrangement, existing.arrangement)
            );

            if (!isDuplicate) {
                uniqueArrangements.push(item);
            }
        }

        console.log(`🎯 Filtered ${allArrangements.length} arrangements down to ${uniqueArrangements.length} strategically unique ones`);
        return uniqueArrangements;
    }

    areStrategicallySimilar(arr1, arr2) {
        // Same hand types in same positions = strategically similar
        return arr1.back.handType === arr2.back.handType &&
               arr1.middle.handType === arr2.middle.handType &&
               arr1.front.handType === arr2.front.handType &&
               arr1.back.rank === arr2.back.rank &&  // Same primary rank (e.g., both K-high straights)
               arr1.middle.rank === arr2.middle.rank &&
               arr1.front.rank === arr2.front.rank;
    }

    updateTopArrangements(arrangement, score) {
        const completedArrangement = this.addKickersToArrangement(arrangement);

        this.topArrangements.push({
            arrangement: completedArrangement,
            score: completedArrangement.score
        });

        this.topArrangements.sort((a, b) => b.score - a.score);
        if (this.topArrangements.length > this.maxTopN) {
            this.topArrangements = this.topArrangements.slice(0, this.maxTopN);
        }
    }
}


class FindBestSetupNoWildEmpirical extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const method = gameConfig.config.winProbabilityMethod;
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position, method);
    }
}


class FindBestSetupNoWild extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const method = gameConfig.config.winProbabilityMethod;
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position, method);
    }
}


class FindBestSetupNoWildTiered extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const method = gameConfig.config.winProbabilityMethod;
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position, method);
    }
}


class FindBestSetupNoWildTiered2 extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const method = gameConfig.config.winProbabilityMethod;
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position, method);
    }
}


class FindBestSetupNoWildPoints extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const method = gameConfig.config.winProbabilityMethod;
        return ScoringUtilities.getExpectedPoints(hand, hand.cards, position, method);
    }
}


class FindBestSetupNoWildBestBack extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const score = ScoringUtilities.getExpectedPoints(hand, hand.cards, position, 'points');
        if (position === 'back') {
            const handTypeBonus = (hand.hand_rank[0] || 0) * 0.1;
            return score * 2 + handTypeBonus;
        }
        return score;
    }
}


class FindBestSetupNoWildBestMiddle extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const score = ScoringUtilities.getExpectedPoints(hand, hand.cards, position, 'points');
        if (position === 'middle') {
            const handTypeBonus = (hand.hand_rank[0] || 0) * 0.1;
            return score * 2 + handTypeBonus;
        }
        return score;
    }
}


class FindBestSetupNoWildBestFront extends FindBestSetupNoWildBase {
    getHandScore(hand, position) {
        const score = ScoringUtilities.getExpectedPoints(hand, hand.cards, position, 'points');
        if (position === 'front') {
            const handTypeBonus = (hand.hand_rank[0] || 0) * 0.1;
            return score * 2 + handTypeBonus;
        }
        return score;
    }
}
