// js/arrange/find-best-setup.js
// Universal dispatcher for finding optimal 3-hand arrangements
// Handles all wild card scenarios by dispatching to specialized solvers

class FindBestSetup {
    constructor() {
//        console.log('🏗️ FindBestSetup constructor called');
//        console.log('🏗️ Current config method:', gameConfig.config.winProbabilityMethod);
        this.statistics = {
            totalCalls: 0,
            wildDistribution: {
                noWild: 0,
                oneWild: 0,
                twoWild: 0,
                threeWild: 0,
                fourWild: 0
            }
        };
    }

    /**
     * Find the best arrangement for any 17-card hand
     * Automatically handles wild card detection and dispatching
     * @param {Array} allCards - Array of 17 card objects (Card Model format)
     * @returns {Object} Best arrangement result (Arrangement Model format)
     */
    findBestSetup(allCards, options = {}) {
//        console.log(`🎯 FindBestSetup: Analyzing 17 cards for optimal arrangement...`);

        // Validate input
        if (!this.validateInput(allCards)) {
            return this.createErrorResult('Invalid input cards');
        }

        this.statistics.totalCalls++;
        const startTime = performance.now();

        try {
            // Count wild cards
            const { wildCards, nonWildCards } = CardUtilities.separateWildCards(allCards);
            const wildCount = wildCards.length;

//            console.log(`🃏 Wild card analysis: ${wildCount} wild cards, ${nonWildCards.length} non-wild cards`);
            this.updateWildStatistics(wildCount);

            // Dispatch to appropriate solver
            let result;

            if (wildCount === 0) {
//                console.log(`📊 No wild cards - using no-wild solver...`);
                result = this.noWild(allCards, options);

            } else if (wildCount === 1) {
//                console.log(`🃏 One wild card - using one-wild solver...`);
                result = this.oneWild(allCards, options);

            } else if (wildCount === 2) {
//                console.log(`🃏🃏 Two wild cards - using two-wild solver...`);
                result = this.twoWild(allCards, options);




            } else {
//                console.log(`🃏+ Multiple wild cards (${wildCount}) - using fallback...`);
                result = this.fallback(allCards, wildCount);
            }

            // Add timing information
            const endTime = performance.now();
            if (result && result.statistics) {
                result.statistics.dispatchTime = endTime - startTime;
                result.statistics.wildCount = wildCount;
            }

            this.logResult(result, wildCount);

            return result;

        } catch (error) {
            console.error(`❌ FindBestSetup error:`, error);
            return this.createErrorResult(error.message);
        }
    }

    /**
     * Handle hands with no wild cards
     * @param {Array} allCards - 17 card objects with 0 wilds
     * @returns {Object} Arrangement result
     */
    noWild(allCards, options = {}) {
        const flag = window.gameConfig?.config?.winProbabilityMethod || 'tiered';
        const finder = createFindBestSetupNoWild(flag, options);
        return finder.findBestSetupNoWild(allCards);
    }

    /**
     * Handle hands with one wild card
     * @param {Array} allCards - 17 card objects with 1 wild
     * @returns {Object} Arrangement result
     */
    oneWild(allCards, options = {}) {
        return FindBestSetupOneWild(allCards, options);
    }

    /**
     * Handle hands with two wild cards
     * @param {Array} allCards - 17 card objects with 2 wilds
     * @returns {Object} Arrangement result
     */
    twoWild(allCards, options = {}) {
        return FindBestSetupTwoWild(allCards, options);
    }
    /**
     * Handle hands with 3+ wild cards (fallback)
     * @param {Array} allCards - 17 card objects with 3+ wilds
     * @param {number} wildCount - Number of wild cards
     * @returns {Object} Arrangement result
     */
    fallback(allCards, wildCount) {
        console.log(`⚠️ Fallback: Using two-wild base + enhancement for ${wildCount} wild cards`);

        if (wildCount > 4) {
            throw new Error(`${wildCount} wild cards not supported - maximum is 4 wilds`);
        }

        if (wildCount < 3) {
            throw new Error(`Fallback called with ${wildCount} wilds - should be 3+`);
        }

        try {
            // Step 1: Get best 2-wild arrangement as base
//            console.log(`📊 Step 1: Finding best 2-wild arrangement as base...`);

            const { wildCards, nonWildCards } = CardUtilities.separateWildCards(allCards);
            const twoWildCards = [...nonWildCards, ...wildCards.slice(0, 2)];
            const twoWildResult = this.twoWild(twoWildCards);

            if (!twoWildResult.success) {
                throw new Error('Two-wild base arrangement failed');
            }

//            console.log(`✅ Two-wild base found with score: ${twoWildResult.score}`);


            // In findBestSetup (or its component methods), calculate unused cards
            const usedCards = [
                ...result.arrangement.back.cards,
                ...result.arrangement.middle.cards,
                ...result.arrangement.front.cards
            ];

            const stagingCards = allCards.filter(card =>
                !usedCards.some(usedCard => usedCard.id === card.id)
            );

            // Add staging to the arrangement
            result.arrangement.staging = stagingCards;

            // ADD THIS RETURN:
            return {
                arrangement: twoWildResult.arrangement,
                score: twoWildResult.score,
                success: true,
                statistics: {
                    fallbackUsed: true,
                    wildCount: wildCount,
                    method: 'two-wild-base-only',
                    enhanced: false,
                    extraWildsUsed: 0
                }
            };

        } catch (error) {
            console.error(`❌ Fallback error:`, error);
            return this.createErrorResult(`Fallback failed: ${error.message}`);
        }
    }

    /**
     * Try to enhance two-wild arrangement with extra wilds
     * @param {Object} twoWildResult - Result from two-wild algorithm
     * @param {number} extraWilds - Number of extra wilds to try (1 or 2)
     * @param {Array} allCards - All 17 cards
     * @returns {Object} Enhancement result
     */
    tryWildEnhancement(twoWildResult, extraWilds, allCards) {
        console.log(`🔧 Trying to enhance arrangement with ${extraWilds} extra wild(s)...`);

        const baseArrangement = twoWildResult.arrangement;

        // Try enhancing each position in priority order (back, middle, front)
        const positions = ['back', 'middle', 'front'];

        for (const position of positions) {
            const hand = baseArrangement[position];
            const enhancement = this.tryHandEnhancement(hand, extraWilds);

            if (enhancement.possible) {
                console.log(`✅ Can enhance ${position} hand: ${enhancement.description}`);

                // Create enhanced arrangement
                const enhancedArrangement = {
                    ...baseArrangement,
                    [position]: {
                        ...hand,
                        cards: enhancement.newCards,
                        handType: enhancement.newHandType,
                        cardCount: enhancement.newCards.length
                    }
                };

                // Estimate new score (simple improvement)
                const scoreBonus = enhancement.scoreBonus * extraWilds;
                const newScore = twoWildResult.score + scoreBonus;

                return {
                    enhanced: true,
                    arrangement: enhancedArrangement,
                    score: newScore,
                    extraWildsUsed: extraWilds,
                    enhancedPosition: position,
                    description: enhancement.description
                };
            }
        }

        console.log(`⚠️ No valid enhancements found`);
        return {
            enhanced: false,
            arrangement: baseArrangement,
            score: twoWildResult.score,
            extraWildsUsed: 0
        };
    }

    /**
     * Check if a hand can be enhanced with extra wilds
     * @param {Object} hand - Hand object from arrangement
     * @param {number} extraWilds - Number of extra wilds available
     * @returns {Object} Enhancement possibility
     */
    tryHandEnhancement(hand, extraWilds) {
        const handType = hand.handType;
        const currentCards = hand.cards.length;
        let enhancedCards = hand.cards
        let wildsToAdd = extraWilds

        if (handType.includes('of a Kind')) {
            // Step 1: Strip kicker if it's a 4K in 5-card format
            let cleanCards = hand.cards;

            if (hand.handType === 'Four of a Kind' && hand.cards.length === 5) {
                // Find which rank appears 4 times
                const rankCounts = {};
                hand.cards.forEach(card => {
                    rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
                });

                const ofAKindRank = Object.keys(rankCounts).find(rank => rankCounts[rank] === 4);
                cleanCards = hand.cards.filter(card => card.rank === ofAKindRank);
                let enhancedCards = cleanCards
            }

            // Step 2: Simple length-based wild addition
            const currentLength = cleanCards.length;
            wildsToAdd = this.calculateWildsToAdd(cleanCards.length, extraWilds);

            if (wildsToAdd > 0) {
                const newCardCount = currentLength + wildsToAdd;
                const enhancedCards = [...cleanCards];

                // Create actual cards of that rank using Analysis
                const suits = ['♠', '♥', '♦', '♣'];
                for (let i = 0; i < wildsToAdd; i++) {
                    const suit = suits[i % 4]; // Cycle through suits
                    const substituteCard = Analysis.createCardFromString(`${ofAKindRank}${suit}`);
                    enhancedCards.push(substituteCard);
                }
            }

            const ofAKindRank = enhancedCards[0].rank;
            const enhancedHandStrength = evaluateHand(enhancedCards);

            const newCardCount = currentCards + extraWilds;
            if (newCardCount <= 8) {
                return {
                    cards: enhancedCards,
                    handType: `${newCardCount} of a Kind`,
                    cardCount: newCardCount,
                    handStrength: enhancedHandStrength,
                    hand_rank: enhancedHandStrength.handStrength, // updated for new fields
                    strength: enhancedHandStrength.handType,      // updated for new fields
                    validPositions: hand.validPositions,   // Keep original valid positions
                    isIncomplete: false                    // Enhanced hands are always complete
                };
            }
        }

        wildsToAdd = this.calculateWildsToAdd(currentLength, extraWilds);
        if (handType.includes('Straight Flush')) {
            // 5-card SF→6-card SF, 6-card SF→7-card SF, 7-card SF→8-card SF

            // For wheel: add 6 and/or 7 in same suit
            if (this.isWheelStraightFlush(hand.cards)) {
                const suit = hand.cards[0].suit; // Get the suit from existing cards
                const ranksToAdd = ['6', '7'].slice(0, wildsToAdd);
                const substituteCards = ranksToAdd.map(rank =>
                    Analysis.createCardFromString(`${rank}${suit}`)
                );
            }

            // For regular SF: add cards below lowest
            else {
                const lowestCard = this.findLowestCard(hand.cards);
                const suit = lowestCard.suit;
                const ranksToAdd = this.getRanksBelow(lowestCard.rank, wildsToAdd);
                const substituteCards = ranksToAdd.map(rank =>
                    Analysis.createCardFromString(`${rank}${suit}`)
                );
            }

            const newCardCount = currentCards + extraWilds;
            const wildsToAdd = this.calculateWildsToAdd(currentLength, extraWilds);
            if (wildsToAdd > 0) {
                // Do the specific enhancement for that hand type
                if (newCardCount <= 8) {
                    return {
                        cards: enhancedCards,
                        handType: `${newCardCount} of a Kind`,
                        cardCount: newCardCount,
                        handStrength: enhancedHandStrength,
                        hand_rank: enhancedHandStrength.handStrength,  // ✅ Changed
                        strength: enhancedHandStrength.handType,       // ✅ Changed
                        validPositions: hand.validPositions,   // Keep original valid positions
                        isIncomplete: false                    // Enhanced hands are always complete
                        };
                }
            }
        }

        return {
            possible: false,
            description: `Cannot enhance ${handType} with ${extraWilds} wilds`
        };
    }

    /**
     * Create dummy wild cards for enhancement
     * @param {number} count - Number of dummy wilds needed
     * @returns {Array} Array of dummy wild card objects
     */
    createDummyWilds(count) {
        const dummies = [];
        for (let i = 0; i < count; i++) {
            dummies.push({
                id: `enhancement_wild_${i + 1}`,
                rank: '',
                suit: '',
                value: 0,
                isWild: true
            });
        }
        return dummies;
    }

    // Calculate number of wilds to add
    calculateWildsToAdd(currentLength, extraWilds) {
        if (currentLength <= 6) return extraWilds;
        if (currentLength === 7) return 1;
        if (currentLength === 8) return 0;
        return 0; // fallback
    }

    isWheelStraightFlush(cards) {
        // Check if contains A, 2, 3, 4, 5 of same suit
        const ranks = cards.map(c => c.rank).sort();
        return ranks.includes('A') && ranks.includes('2') &&
               ranks.includes('3') && ranks.includes('4') && ranks.includes('5');
    }

    /**
     * Validate input cards
     * @param {Array} allCards - Cards to validate
     * @returns {boolean} True if valid
     */
    validateInput(allCards) {
        if (!Array.isArray(allCards)) {
            console.error(`❌ Input must be an array, got ${typeof allCards}`);
            return false;
        }

        if (allCards.length !== 17) {
            console.error(`❌ Expected 17 cards, got ${allCards.length}`);
            return false;
        }

        // Basic card validation
        for (let i = 0; i < allCards.length; i++) {
            const card = allCards[i];
            if (!card || typeof card !== 'object') {
                console.error(`❌ Invalid card at index ${i}:`, card);
                return false;
            }

            if (!card.hasOwnProperty('id') || !card.hasOwnProperty('rank') || !card.hasOwnProperty('suit')) {
                console.error(`❌ Card missing required properties at index ${i}:`, card);
                return false;
            }
        }

        return true;
    }

    /**
     * Update wild card statistics
     * @param {number} wildCount - Number of wild cards
     */
    updateWildStatistics(wildCount) {
        switch (wildCount) {
            case 0: this.statistics.wildDistribution.noWild++; break;
            case 1: this.statistics.wildDistribution.oneWild++; break;
            case 2: this.statistics.wildDistribution.twoWild++; break;
            case 3: this.statistics.wildDistribution.threeWild++; break;
            case 4: this.statistics.wildDistribution.fourWild++; break;
            default:
                // Handle 5+ wilds if that ever happens
                console.warn(`⚠️ Unusual wild count: ${wildCount}`);
        }
    }

    /**
     * Create error result in standard format
     * @param {string} errorMessage - Error description
     * @returns {Object} Error result
     */
    createErrorResult(errorMessage) {
        return {
            arrangement: null,
            score: -Infinity,
            success: false,
            error: errorMessage,
            statistics: {
                dispatchTime: 0,
                wildCount: -1
            }
        };
    }

    /**
     * Log the final result
     * @param {Object} result - Result to log
     * @param {number} wildCount - Number of wild cards
     */
    logResult(result, wildCount) {
//        if (result && result.success) {
//            console.log(`✅ FindBestSetup SUCCESS (${wildCount} wilds): Score ${result.score}`);
//            if (result.statistics) {
//                console.log(`   Dispatch time: ${result.statistics.dispatchTime?.toFixed(2)}ms`);
//            }
//        } else {
//            console.log(`❌ FindBestSetup FAILED (${wildCount} wilds):`, result?.error || 'Unknown error');
//        }
    }

    /**
     * Get usage statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        return {
            ...this.statistics,
            totalWildCards: Object.values(this.statistics.wildDistribution).reduce((a, b) => a + b, 0)
        };
    }

    /**
     * Reset statistics
     */
    resetStatistics() {
        this.statistics = {
            totalCalls: 0,
            wildDistribution: {
                noWild: 0,
                oneWild: 0,
                twoWild: 0,
                threeWild: 0,
                fourWild: 0
            }
        };
        console.log(`📊 FindBestSetup statistics reset`);
    }
}

/**
 * Convenience function for direct usage
 * @param {Array} allCards - 17 card objects
 * @returns {Object} Best arrangement result
 */
function findBestSetup(allCards, options = {}) {
    const finder = new FindBestSetup();
    return finder.findBestSetup(allCards, options);
}
