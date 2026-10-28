// js/hands/hand-detector.js v14
// Added 4K expansion with kicker integration
// FIXED: 4K and 2-card position logic + Two Pair position fix
// Added validPositions field for Phase 2 combination generator
// Integrated with card-evaluation.js for proper hand rankings
// NEW: 4K hands are expanded with kickers during detection (complete hands only)
// HandDetector works on a set of card arrays of any length
// For each hand found it populates the Hand Model with addHand - now used by game.js

class HandDetector {
    constructor(cards) {
        this.cards = cards.filter(c => !c.isWild); // No wilds for now
        this.allHands = [];
        this.analysis = new Analysis(this.cards);

        // Extract counts once in constructor
        this.rankCounts = this.analysis.rankCounts;
        this.suitCounts = this.analysis.suitCounts;
//        console.log('📊 Rank counts:', this.rankCounts);
//        console.log('📊 Suit counts:', this.suitCounts);

        this.results = this.detectAllHands();
    }

    /**
     * Main entry point - detect hands and optionally auto-sort
     * @param {boolean} autoSort - Whether to automatically sort hands by strength
     * @returns {Object} Structured results with optionally sorted hands
     */
    detectAllHands(autoSort = true) {
        this.allHands = []; // Clear previous results
//        console.log(`🔍 HandDetector analyzing ${this.cards.length} cards...`);

        // Count ranks and suits
        // const { rankCounts, this.suitCounts } = this.countRanksAndSuits();

        // Detect straight flushes (5-8 cards)
        this.detectStraightFlushes(this.suitCounts);

        // Detect of-a-kind hands with drop-one-card pattern AND 4K expansion
        this.detectOfAKind(this.rankCounts);

        // Detect two pairs
        this.detectTwoPairs();

        // Detect full houses using all trips and pairs
        this.detectFullHouses();

        // Detect flushes using combinations from each suit
        this.detectFlushes(this.suitCounts);

        // Detect straights using consecutive rank counts
        this.detectStraights(this.rankCounts);

        // Detect single cards
        this.detectSingleCards();

        return this.formatResults(autoSort);
    }

    /**
     * Detect of-a-kind hands with drop-one-card pattern
     * SPECIAL: 4K hands are expanded with kickers to create complete 5-card hands
     */
    detectOfAKind(rankCounts) {
        Object.entries(rankCounts).forEach(([rank, count]) => {
            if (count >= 2) {
                const allCardsOfRank = this.cards.filter(c => c.rank === rank);

                // Handle natural pairs (exactly 2 cards)
                if (count === 2) {
                    const naturalPair = allCardsOfRank.slice(0, 2);
                    this.addHand(naturalPair, 'Pair');
                }

                // Handle 3 cards: natural trip + drop-one variants
                else if (count === 3) {
                    // 1. Create natural three-of-a-kind
                    const naturalTrip = allCardsOfRank.slice(0, 3);
                    this.addHand(naturalTrip, 'Three of a Kind');

                    // 2. Create 3 different pairs by dropping one card each
                    for (let dropIndex = 0; dropIndex < 3; dropIndex++) {
                        const pairVariant = allCardsOfRank.slice(0, 3)
                            .filter((card, index) => index !== dropIndex);
                        this.addHand(pairVariant, 'Pair');
                    }
                }

                // Handle 4K: EXPAND with kickers to create complete 5-card hands
                else if (count === 4) {
//                    console.log(`🃏 Expanding 4K of ${rank}s with kickers...`);

                    // Get the four cards of this rank
                    const fourOfAKindCards = allCardsOfRank.slice(0, 4);

                    // Find all available kickers (remaining cards not of this rank)
                    const availableKickers = this.analysis.findKickers([rank]);

                    // console.log(`🃏 Found ${availableKickers.length} kickers for 4K of ${rank}s`);

                    // Generate complete 5-card 4K hands
                    availableKickers.forEach((kicker, index) => {
                        const completeHand = [...fourOfAKindCards, ...kicker];
                        this.addHand(completeHand, 'Four of a Kind');
                        // console.log(`🃏 Created 4K + ${kicker.map(c => c.rank + c.suit).join(',')} (variant ${index + 1})`);
                    });

                    // Also create 3-of-a-kind variants by dropping one 4K card
                    for (let dropIndex = 0; dropIndex < 4; dropIndex++) {
                        const tripVariant = fourOfAKindCards.filter((card, index) => index !== dropIndex);
                        this.addHand(tripVariant, 'Three of a Kind');
                    }
                }

                // Handle 5+ cards: natural + drop-one variants (these are already complete)
                else if (count >= 5) {
                    // 1. Create natural N-of-a-kind (already complete)
                    const naturalHand = allCardsOfRank.slice(0, count);
                    const naturalHandType = `${count} of a Kind`;
                    this.addHand(naturalHand, naturalHandType);

                    // 2. Create count different (count-1)-of-a-kinds by dropping one card each
                    const targetSize = count - 1;
                    const targetHandType = targetSize >= 5 ? `${targetSize} of a Kind` :
                                         targetSize === 4 ? 'Four of a Kind' :
                                         targetSize === 3 ? 'Three of a Kind' : 'Pair';

                    for (let dropIndex = 0; dropIndex < count; dropIndex++) {
                        const variantHand = allCardsOfRank.slice(0, count)
                            .filter((card, index) => index !== dropIndex);

                        // If this creates a 4K, expand it with kickers too
                        if (targetSize === 4) {
                            // console.log(`🃏 Drop-one variant created 4K of ${rank}s - expanding with kickers...`);
                            const availableKickers = this.analysis.findKickers([rank]);

                            availableKickers.forEach(kicker => {
                                const completeHand = [...variantHand, ...kicker];
                                this.addHand(completeHand, 'Four of a Kind');
                            });
                        } else {
                            this.addHand(variantHand, targetHandType);
                        }
                    }
                }
            }
        });
    }

    /**
     * Determine which positions a hand can legally be placed in
     * @param {string} handType - Type of hand (e.g., 'Straight', 'Pair')
     * @param {number} cardCount - Number of cards in hand
     * @returns {Array} Array of valid positions ['front', 'middle', 'back']
     */
    determineValidPositions(handType, cardCount) {
        const positions = [];

        // 1-card hands - can contribute to front (3 cards) or middle (5 cards)
        if (cardCount === 1) {
            positions.push('front', 'middle'); // Essential for big hand scenarios
        }

        // 2-card hands (pairs that will get kickers)
        else if (cardCount === 2) {
            if (handType === 'Pair') {
                positions.push('front', 'middle', 'back'); // Will become 3-5 cards with kickers
            }
        }

        // 3-card hands - ONLY FRONT!
        else if (cardCount === 3) {
            if (['High Card', 'Pair', 'Three of a Kind'].includes(handType)) {
                positions.push('front');
            }
            // 3-card hands CANNOT go middle or back (need 5+ cards)
        }

        // 4-card hands (different rules for different hand types)
        else if (cardCount === 4) {
            if (handType === 'Two Pair') {
                positions.push('middle', 'back'); // Two Pair: below straight, middle/back only
            } else if (handType.includes('of a Kind')) {
                positions.push('front', 'middle', 'back'); // 4K: straight or better, all positions
            }
        }

        // 5-card hands
        else if (cardCount === 5) {
            positions.push('middle', 'back');

            // Front: only if straight or better
            if (this.isStraightOrBetter(handType)) {
                positions.push('front');
            }
        }

        // 6-7 card hands (ONLY straight flushes or of-a-kind)
        else if (cardCount >= 6 && cardCount <= 7) {
            if (this.isStraightFlushOrOfAKind(handType)) {
                positions.push('middle', 'back');
            }
            // Invalid 6-7 card hands get no valid positions
        }

        // 8 card hands (ONLY straight flushes or of-a-kind)
        else if (cardCount === 8) {
            if (this.isStraightFlushOrOfAKind(handType)) {
                positions.push('back'); // Only back for 8-card hands
            }
        }

        return positions;
    }

    /**
     * Check if hand is incomplete and needs kickers
     * @param {string} handType - Type of hand
     * @param {number} cardCount - Number of cards in hand
     * @returns {boolean} - True if hand needs kickers to be legal
     */
    isIncompleteHand(handType, cardCount) {
        return cardCount === 1 ||
               cardCount === 2 ||
               (cardCount === 4 && handType === 'Two Pair'); // 4K is now always complete due to expansion
    }

    /**
     * Calculate how many kickers needed for each position
     * @param {string} handType - Type of hand
     * @param {number} cardCount - Number of cards in hand
     * @param {Array} validPositions - Where hand can be placed
     * @returns {Object|null} - Kickers needed for each valid position
     */
    calculateKickersNeeded(handType, cardCount, validPositions) {
        if (!this.isIncompleteHand(handType, cardCount)) {
            return null; // Complete hands don't need kickers
        }

        const kickersNeeded = {};

        validPositions.forEach(position => {
            if (position === 'front') {
                kickersNeeded.front = 3 - cardCount; // Front needs 3 total cards
            } else if (position === 'middle' || position === 'back') {
                kickersNeeded[position] = 5 - cardCount; // Middle/back need 5 total cards
            }
        });

        return kickersNeeded;
    }

    // Check if hand type is straight or better (for front 5-card requirement)
    isStraightOrBetter(handType) {
        return ['Straight', 'Flush', 'Full House', 'Four of a Kind',
                'Straight Flush', 'Five of a Kind',
                '6 of a Kind', '7 of a Kind', '8 of a Kind',
                '6-card Straight Flush', '7-card Straight Flush', '8-card Straight Flush'].includes(handType);
    }

    // Check if hand type is valid for 6-8 card hands
    isStraightFlushOrOfAKind(handType) {
        return handType.includes('Straight Flush') ||
               handType.includes('of a Kind');
    }


    // Detect straight flushes (5-8 cards) using consecutive rank counts within each suit
    detectStraightFlushes(suitCounts) {
        // console.log(`🌈 Straight flush detection starting...`);

        Object.entries(this.suitCounts).forEach(([suit, count]) => {
            if (count >= 5) {
                // console.log(`🌈 Checking suit ${suit} with ${count} cards...`);

                // Get only cards of this suit
                const suitCards = this.cards.filter(c => c.suit === suit);

                // Create rank counts for this suit only
                const suitRankCounts = {};
                suitCards.forEach(card => {
                    suitRankCounts[card.rank] = (suitRankCounts[card.rank] || 0) + 1;
                });

                // console.log(`🌈 Suit ${suit} rank counts:`, suitRankCounts);

                // Detect straights within this suit (5-8 cards)
                this.detectStraightsInSuit(suitRankCounts, suitCards, suit);
            }
        });
    }


    // Detect straights within a specific suit (for straight flushes)
    detectStraightsInSuit(suitRankCounts, suitCards, suit) {
        // Convert ranks to values for easier consecutive checking
        const rankValues = Analysis.RANK_VALUES;

        // Create value-to-count mapping for this suit
        const valueCounts = {};
        Object.entries(suitRankCounts).forEach(([rank, count]) => {
            const value = rankValues[rank];
            valueCounts[value] = count;
        });

        // Check for 5-8 card straight flushes
        for (let straightLength = 5; straightLength <= 8; straightLength++) {
            // Check regular straights (5-6-7-8-9 through sequences ending at Ace)
            for (let startValue = 2; startValue <= (15 - straightLength); startValue++) {
                const consecutive = Analysis.generateConsecutiveValues(startValue, straightLength);

                // Check if all consecutive values exist in this suit
                if (consecutive.every(val => valueCounts[val] > 0)) {
                    // console.log(`🌈 Found ${straightLength}-card straight flush in ${suit}: ${consecutive.join('-')}`);

                    // Generate all combinations for this straight flush
                    this.generateStraightFlushCombinations(consecutive, valueCounts, rankValues, suitCards, suit, straightLength);
                }
            }

            // Check wheel straight flush (A-2-3-4-5, A-2-3-4-5-6, etc.)
            if (straightLength <= 8) { // Wheel can only go up to A-2-3-4-5-6-7-8
                const wheelValues = Analysis.generateWheelValues(straightLength);

                if (wheelValues.every(val => valueCounts[val] > 0)) {
                    // console.log(`🌈 Found ${straightLength}-card wheel straight flush in ${suit}: A-${wheelValues.slice(1).join('-')}`);

                    // Generate wheel straight flush combinations
                    this.generateStraightFlushCombinations(wheelValues, valueCounts, rankValues, suitCards, suit, straightLength);
                }
            }
        }
    }


    // Generate all combinations for a specific straight flush
    generateStraightFlushCombinations(values, valueCounts, rankValues, suitCards, suit, straightLength) {
        // Get all cards for each value in the straight flush (from this suit only)
        const cardsByValue = {};
        values.forEach(value => {
            cardsByValue[value] = suitCards.filter(card => {
                const cardValue = rankValues[card.rank];
                return cardValue === value;
            });
        });

        // Generate all combinations (one card from each value)
        const generateCombos = (valueIndex, currentCombo) => {
            if (valueIndex >= values.length) {
                // Complete combination - add as straight flush with appropriate name
                const handTypeName = straightLength === 5 ? 'Straight Flush' : `${straightLength}-card Straight Flush`;
                this.addHand([...currentCombo], handTypeName);
                return;
            }

            const value = values[valueIndex];
            const availableCards = cardsByValue[value];

            availableCards.forEach(card => {
                currentCombo.push(card);
                generateCombos(valueIndex + 1, currentCombo);
                currentCombo.pop();
            });
        };

        generateCombos(0, []);
    }

        // Detect two pairs using existing pair hands
        detectTwoPairs() {
            const pairs = this.allHands.filter(h => h.handType === 'Pair');
//            console.log(`👥 Two pair detection: ${pairs.length} pairs available`);

            let twoPairCount = 0;
            if (pairs.length >= 2) {
                for (let i = 0; i < pairs.length; i++) {
                    for (let j = i + 1; j < pairs.length; j++) {
                        // ADD THIS CHECK BEFORE COMBINING:
                        const hasSharedCards = pairs[i].cards.some(card1 =>
                            pairs[j].cards.some(card2 => card1.id === card2.id)
                        );

                        if (!hasSharedCards) {  // Only combine if no shared cards
                            const twoPair = [...pairs[i].cards, ...pairs[j].cards];
                            this.addHand(twoPair, 'Two Pair');
                            twoPairCount++;
                        }
                    }
                }
            }
//            console.log(`👥 Created ${twoPairCount} two pair hands`);
        }


    // Detect straights using consecutive rank counts
    detectStraights(rankCounts) {
        // Convert ranks to values for easier consecutive checking
        const rankValues = Analysis.RANK_VALUES;

        // Create value-to-count mapping
        const valueCounts = {};
        Object.entries(this.rankCounts).forEach(([rank, count]) => {
            const value = rankValues[rank];
            valueCounts[value] = count;
        });

        // console.log(`🔢 Straight detection - value counts:`, valueCounts);

        // Check regular straights (5-6-7-8-9 through 10-J-Q-K-A)
        for (let startValue = 2; startValue <= 10; startValue++) {
            const consecutive = [startValue, startValue+1, startValue+2, startValue+3, startValue+4];

            // Check if all 5 consecutive values exist
            if (consecutive.every(val => valueCounts[val] > 0)) {
                const straightCount = consecutive.reduce((product, val) => product * valueCounts[val], 1);
                // console.log(`🔢 Found straight ${startValue}-${startValue+4}: ${straightCount} combinations`);

                // Generate all combinations for this straight
                this.generateStraightCombinations(consecutive, valueCounts, rankValues);
            }
        }

        // Check wheel straight (A-2-3-4-5)
        const wheelValues = Analysis.WHEEL_STRAIGHT; // A=14, but acts as 1 in wheel
        if (wheelValues.every(val => valueCounts[val] > 0)) {
            const wheelCount = wheelValues.reduce((product, val) => product * valueCounts[val], 1);
            // console.log(`🔢 Found wheel straight A-2-3-4-5: ${wheelCount} combinations`);

            // Generate wheel straight combinations
            this.generateStraightCombinations(wheelValues, valueCounts, rankValues);
        }
    }


    // Generate all combinations for a specific straight

    generateStraightCombinations(values, valueCounts, rankValues) {
        // Get all cards for each value in the straight
        const cardsByValue = {};
        values.forEach(value => {
            cardsByValue[value] = this.cards.filter(card => {
                const cardValue = rankValues[card.rank];
                return cardValue === value;
            });
        });

        // Generate all combinations (one card from each value)
        const generateCombos = (valueIndex, currentCombo) => {
            if (valueIndex >= values.length) {
                // Check if this is actually a straight flush (straight + same suit)
                const suits = currentCombo.map(card => card.suit);
                const isActualStraightFlush = suits.every(suit => suit === suits[0]);

                // Only add as straight if it's NOT a straight flush
                if (!isActualStraightFlush) {
                    this.addHand([...currentCombo], 'Straight');
                }
                return;
            }


            const value = values[valueIndex];
            const availableCards = cardsByValue[value];

            availableCards.forEach(card => {
                currentCombo.push(card);
                generateCombos(valueIndex + 1, currentCombo);
                currentCombo.pop();
            });
        };

        generateCombos(0, []);
    }


    // Detect flushes using combinations from each suit
    detectFlushes(suitCounts) {
        Object.entries(this.suitCounts).forEach(([suit, count]) => {
            if (count >= 5) {
                // Get all cards of this suit
                const suitCards = this.cards.filter(c => c.suit === suit);

                // Generate all 5-card combinations from this suit
                const flushCombinations = Analysis.generateCombinations(suitCards, 5);

                // console.log(`♠️ Suit ${suit}: ${count} cards → ${flushCombinations.length} flushes`);

                flushCombinations.forEach(combo => {
                    // Check if this combination is actually a straight flush
                    if (!this.isStraightFlush(combo)) {
                        this.addHand(combo, 'Flush');
                    }
                });
            }
        });
    }


    // Detect single card hands (high cards)
    detectSingleCards() {
        // console.log(`🃏 Single card detection starting...`);

        let singleCardCount = 0;

        this.cards.forEach(card => {
            // Create a 1-card hand for each card
            this.addSingleCardHand([card], 'High Card');
            singleCardCount++;
        });

        // console.log(`🃏 Created ${singleCardCount} single card hands`);
    }

    // Detect full houses using all available trips and pairs
    detectFullHouses() {
        // Get all trips and pairs from our existing hands
        const trips = this.allHands.filter(h => h.handType === 'Three of a Kind');
        const pairs = this.allHands.filter(h => h.handType === 'Pair');

        // console.log(`🏠 Full house detection: ${trips.length} trips, ${pairs.length} pairs`);

        // Create full house from each trip + each pair (different ranks only)
        let fullHouseCount = 0;
        trips.forEach(trip => {
            pairs.forEach(pair => {
                if (trip.rank !== pair.rank) {
                    const fullHouse = [...trip.cards, ...pair.cards];
                    this.addHand(fullHouse, 'Full House');
                    fullHouseCount++;
                }
            });
        });
        // console.log(`🏠 Created ${fullHouseCount} full houses`);
    }

    // Add a single card hand to our results (modified version of addHand)
    addSingleCardHand(cards, handType) {
        // Get proper hand ranking from card-evaluation.js
        const handStrength = evaluateHand(cards);
        // single card hand
        const card_value0 = cards[0].value
        handStrength.hand_rank = [1,card_value0];
        handStrength.handStrength = [1, card_value0];    // NEW name - ADD THIS LINE

        // Determine valid positions for this hand
        const validPositions = this.determineValidPositions(handType, cards.length);

        // Check if hand is incomplete and calculate kickers needed
        const isIncomplete = this.isIncompleteHand(handType, cards.length);
        const kickersNeeded = this.calculateKickersNeeded(handType, cards.length, validPositions);
        const positionScores = this.calculatePositionScores(handStrength, validPositions, cards.length);

        // In addHand:
        // In hand-detector.js addHand() method, right after:
        const preCalculatedScore = {
            front: -1.85246,
            middle: -4,
            back: -6
        };
        // ADD THIS LOG:
//        console.log(`✅ Created preCalculatedScore for addSingleCardHand: ${handType}:`, preCalculatedScore);

        this.allHands.push({
            cards: [...cards],
            handType,
            cardCount: cards.length,
            rank: cards[0].rank,                    // Keep for backward compatibility
            handStrength: handStrength,             // Full evaluation result
            hand_rank: handStrength.handStrength,      // Proper ranking tuple
            strength: handStrength.handType,            // Numeric strength
            validPositions: validPositions,         // Where this hand can be placed
            isIncomplete: isIncomplete,             // NEW: Flag for incomplete hands
            kickersNeeded: kickersNeeded,           // NEW: Kickers needed for each position
            positionScores: positionScores,
            preCalculatedScore: preCalculatedScore   // NEW: for netEV
        });

        const incompleteStatus = isIncomplete ? `INCOMPLETE - needs ${JSON.stringify(kickersNeeded)}` : 'COMPLETE';
        // console.log(`🃏 Found: ${handType} ${cards[0].rank} of ${cards[0].suit} (${cards.length} card) - Valid: ${validPositions.join(', ')} - ${incompleteStatus}`);
    }


    addHand(cards, handType) {
        // Get proper hand ranking - TODO: Move to separate incomplete-hand-evaluator.js later
        let handStrength;
        if (cards.length === 3) {
            handStrength = evaluateThreeCardHand(cards);
        } else if (cards.length === 1) {
            // Fix 1-card High Card hands
            const highCard = cards[0].value;
             // 1-card High Card
            handStrength = {
                rank: 1,                        // High Card = 1
                hand_rank: [1, highCard],
                name: 'High Card',
                handType: 1,                    // ✅ ADD
                handStrength: [1, highCard]     // ✅ ADD
            };

        } else if (cards.length === 2 && handType === 'Pair') {
            // Fix 2-card Pair hands
            const pairRank = cards[0].value;
            // 2-card Pair
            handStrength = {
                rank: 2,                        // ✅ FIX: Pair = 2, not 1
                hand_rank: [2, pairRank],
                name: 'Pair',
                handType: 2,                    // ✅ ADD
                handStrength: [2, pairRank]     // ✅ ADD
            };

        } else if (cards.length === 4 && handType === 'Four of a Kind') {
            // Handle 4-card Four of a Kind - let evaluateHand handle it properly
            handStrength = evaluateHand(cards);

        } else if (cards.length === 4 && handType === 'Two Pair') {
            // Fix 4-card Two Pair hands
            const values = cards.map(c => c.value).sort((a, b) => b - a);
            const valueCounts = {};
            values.forEach(val => valueCounts[val] = (valueCounts[val] || 0) + 1);
            const pairs = Object.entries(valueCounts)
                .filter(([rank, count]) => count === 2)
                .map(([rank, count]) => parseInt(rank))
                .sort((a, b) => b - a);

            // 4-card Two Pair
            handStrength = {
                rank: 3,                        // ✅ FIX: Two Pair = 3, not 2
                hand_rank: [3, pairs[0], pairs[1]],
                name: 'Two Pair',
                handType: 3,                    // ✅ ADD
                handStrength: [3, pairs[0], pairs[1]]  // ✅ ADD
            };
        } else {
            // Use standard evaluation for complete hands (5+ cards)
            handStrength = evaluateHand(cards);
        }

        // Rest of method stays the same...

        // Determine valid positions for this hand
        const validPositions = this.determineValidPositions(handType, cards.length);

        // Check if hand is incomplete and calculate kickers needed
        const isIncomplete = this.isIncompleteHand(handType, cards.length);
        const kickersNeeded = this.calculateKickersNeeded(handType, cards.length, validPositions);

        // Calculate position-specific scores
        const positionScores = this.calculatePositionScores(handStrength, validPositions, cards.length);

        // In addHand:
        // In hand-detector.js addHand() method, right after:
        const preCalculatedScore = JSON.parse(JSON.stringify(calculateMethodScore(handStrength)));

//        console.log('🔍 Before push - handStrength:', handStrength);
//        console.log('🔍 handStrength.handStrength:', handStrength.handStrength);
//        console.log('🔍 handStrength.hand_rank:', handStrength.hand_rank);


        this.allHands.push({
            cards: [...cards],
            handType,
            cardCount: cards.length,
            rank: handStrength.handStrength[1] || cards[0].rank,
            handStrength: { ...handStrength },           // ✅ CREATE NEW OBJECT
            hand_rank: [...handStrength.handStrength],      // ✅ CREATE NEW ARRAY
            strength: handStrength.handType,
            validPositions: validPositions,
            isIncomplete: isIncomplete,
            kickersNeeded: kickersNeeded,
            positionScores: positionScores,
            preCalculatedScore: preCalculatedScore
        });

        const incompleteStatus = isIncomplete ? `INCOMPLETE - needs ${JSON.stringify(kickersNeeded)}` : 'COMPLETE';
        // console.log(`🎯 Found: ${handType} of ${cards[0].rank}s (${cards.length} cards) - Strength: ${handStrength.rank} - Valid: ${validPositions.join(', ')} - ${incompleteStatus}`);
    }

    /**
     * Format results with optional auto-sorting
     * @param {boolean} autoSort - Whether to sort hands by strength
     * @returns {Object} Results object with optionally sorted hands
     */
    formatResults(autoSort = true) {
        let handsToReturn = this.allHands;

        if (autoSort) {
//            console.log('🔄 Before sorting - checking preCalculatedScore:');
            this.allHands.slice(0, 2).forEach((hand, i) => {
//                console.log(`   ${i+1}. Has preCalculatedScore: ${hand.preCalculatedScore ? 'YES' : 'NO'}`);
            });

            const sorter = new HandSorter();
            const sortResult = sorter.sortHandsByStrength(this.allHands);
            handsToReturn = sortResult.sortedHands;

//            console.log('🔄 After sorting - checking preCalculatedScore:');
            handsToReturn.slice(0, 2).forEach((hand, i) => {
//                console.log(`   ${i+1}. Has preCalculatedScore: ${hand.preCalculatedScore ? 'YES' : 'NO'}`);
            });
        }

        const results = {
            total: handsToReturn.length,
            hands: handsToReturn,
            completeHands: handsToReturn.filter(h => !h.isIncomplete).length,
            incompleteHands: handsToReturn.filter(h => h.isIncomplete).length
        };

        // 🔍 ADD THIS LOG HERE - right before return:
//        console.log(`🔍 formatResults - checking first 3 hands for preCalculatedScore:`);
        handsToReturn.slice(0, 3).forEach((hand, i) => {
            const hasScore = hand.preCalculatedScore ? 'YES' : 'NO';
            const scoreValues = hand.preCalculatedScore ?
                `F:${hand.preCalculatedScore.front?.toFixed(2)} M:${hand.preCalculatedScore.middle?.toFixed(2)} B:${hand.preCalculatedScore.back?.toFixed(2)}` :
                'MISSING';
//            console.log(`   ${i+1}. ${hand.handType}: preCalculatedScore = ${hasScore} ${scoreValues}`);
        });

        return results;
    }

    // Check if a 5-card combination is a straight flush
    isStraightFlush(cards) {
        // Get the values and sort them
        const values = cards.map(card => Analysis.RANK_VALUES[card.rank]).sort((a, b) => a - b);

        // Check for regular straight (consecutive values)
        const isRegularStraight = values.every((val, i) => i === 0 || val === values[i-1] + 1);

        // Check for wheel straight (A-2-3-4-5)
        const isWheelStraight = values.length === 5 &&
                               values[0] === 2 && values[1] === 3 && values[2] === 4 &&
                               values[3] === 5 && values[4] === 14;

        return isRegularStraight || isWheelStraight;
    }


    // Calculate position-specific scores for a hand
    calculatePositionScores(handStrength, validPositions, cardCount) {
        const scores = {};

        validPositions.forEach(position => {
            scores[position] = ScoringUtilities.getPointsForHand(handStrength, position, cardCount);
        });

        return scores;
    }

}

function getValidPositionsForHandType(handType) {
    switch(handType) {
        case 16: return ['back'];
        case 15: return ['back'];
        case 14: return ['middle', 'back'];
        case 13: return ['middle', 'back'];
        case 12: return ['middle', 'back'];
        case 11: return ['middle', 'back'];
        case 10: return ['middle', 'back'];
        case 9: return ['front', 'middle', 'back'];
        case 8: return ['front', 'middle', 'back'];
        case 7: return ['front', 'middle', 'back'];
        case 6: return ['front', 'middle', 'back'];
        case 5: return ['front', 'middle', 'back'];
        case 4: return ['front', 'middle', 'back'];
        case 3: return ['middle', 'back'];
        case 2: return ['front', 'middle', 'back'];
        case 1: return ['front', 'middle', 'back'];
        default: return [];
    }
}

function calculateMethodScore(handStrength) {
    const methodScore = {};
    const method = gameConfig.config.winProbabilityMethod;
    const validPositions = getValidPositionsForHandType(handStrength.handType);

    validPositions.forEach(position => {
        if (method === 'netEV') {
            if (window.NETEV_USE_TIERED2_FORMULA) {
                methodScore[position] = ScoringUtilities.netEVFromTiered2Rate({
                    hand_rank: handStrength.handStrength,
                    handType: handStrength.handType,
                    strength: handStrength.handType
                }, position);
            } else {
                methodScore[position] = lookupNetEV(position, { hand_rank: handStrength.handStrength });
            }
        }
    });

    ['front', 'middle', 'back'].forEach(position => {
        if (!validPositions.includes(position)) {
            methodScore[position] = null;
        }
    });

    return methodScore;
}
