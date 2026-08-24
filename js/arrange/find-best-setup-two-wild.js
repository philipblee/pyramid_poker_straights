// js/arrange/two-wild-best-from-cards.js
// Find best arrangement for hands with exactly two wild cards using smart strategies
// Works directly with card objects from the game

/**
 * Find best arrangement for a hand with two wild cards using smart strategy approach
 * @param {Array} cardObjects - Array of 17 card objects (including 2 wilds)
 * @returns {Object} Best arrangement result (same format as one-wild version)
 */
function FindBestSetupTwoWild(cardObjects, options = {}) {
//    console.log(`\n🧠 ======== TWO WILD SMART ARRANGEMENT - FROM CARDS ========`);

    // STEP 1: Convert to Card Model format FIRST
    const properCardObjects = convertToCardModel(cardObjects);

    // STEP 2: Extract wild and non-wild cards from converted objects
    const wildCards = properCardObjects.filter(card => card.isWild);
    const nonWildCards = properCardObjects.filter(card => !card.isWild);

    // STEP 3: Get smart 2-wild combinations using both strategies
    // console.log(`\n📋 Step 3: Getting smart 2-wild combinations...`);

    // Strategy 1: Same-suit combinations for straight flushes
    // console.log(`   Running Strategy 1...`);

    const result = twoWildStrategyOne(nonWildCards);        // NEW: object
    const strategy1Results = result.wildCandidates;           // Extract array

    // Strategy 2: Nested wild candidates for comprehensive coverage
    // console.log(`   Running Strategy 2...`);
    const strategy2Result = twoWildStrategyTwo(nonWildCards);
    const strategy2Results = strategy2Result.combinations;

    // Combine and deduplicate
//    console.log(`   Combining strategies...`);
    const allCombinations = combineAndDeduplicate(strategy1Results, strategy2Results);

//    console.log(`✅ Generated ${allCombinations.length} smart 2-wild combinations`);
//    console.log(`   Strategy 1: ${strategy1Results.length} combinations`);
//    console.log(`   Strategy 2: ${strategy2Results.length} combinations (${strategy2Result.firstLayerCount}/52 first-layer)`);

    if (allCombinations.length === 0) {
        console.log(`❌ No smart combinations found`);
        return {
            arrangement: null,
            score: -Infinity,
            wildCards: null,
            success: false,
            statistics: null
        };
    }

    // STEP 4: Process each smart 2-wild combination (same proven logic as one-wild)
    // console.log(`\n🔄 Step 4: Processing ${allCombinations.length} combinations (smart subset)...`);
    const results = [];

    let globalBestScore = -Infinity;

//    console.log(`🔄 Starting to process ${allCombinations.length} combinations...`);

    allCombinations.forEach((combination, index) => {
//        console.log(`Processing combination ${index}...`); // Add this first
        // Progress indicator every 10 combinations
        //if ((index + 1) % 10 === 0) {
            // console.log(`   Progress: ${index + 1}/${allCombinations.length} combinations processed...`);
        //}

        try {
            // Create two substituted cards
            const substitutedCard1 = createCardFromObject(combination[0], wildCards[0].id);
            const substitutedCard2 = createCardFromObject(combination[1], wildCards[1].id);
            const cards = [...nonWildCards, substitutedCard1, substitutedCard2];

            // ADD THIS LOGGING (just for first few combinations):
            if (index < 3) {
//                console.log(`🔍 Combo ${index} ID Analysis:`);
//                console.log('  Original wild card IDs:', wildCards.map(w => w.id));
//                console.log('  Substituted card 1 ID:', substitutedCard1.id);
//                console.log('  Substituted card 2 ID:', substitutedCard2.id);
//                console.log('  Card 1 full:', substitutedCard1);
//                console.log('  Card 2 full:', substitutedCard2);
            }

            // Run HandDetector (auto-sorted)
            const detector = new HandDetector(cards);
            const handResults = detector.results

//            console.log(`  Cards created for combo ${index}`); // ADD THIS

            // ✅ Should read from game-config:
            const flag = window.gameConfig?.config?.winProbabilityMethod || 'tiered';

            const finder = createFindBestSetupNoWild(flag, options);
            finder.bestScore = globalBestScore;  // ← MOVE THIS UP
            const result = finder.findBestSetupNoWild(cards);  // ← runs seeded

//            const finder = createFindBestSetupNoWild(flag);
//            const result = finder.findBestSetupNoWild(cards);
//
//            finder.bestScore = globalBestScore; // 🔥 SEED with global best
//            const result = finder.findBestSetupNoWild(cards);

            if (result.success && result.score > globalBestScore) {
                globalBestScore = result.score; // 🔥 UPDATE global best
            }

            if (result.success) {
                results.push({
                    wildCards: [combination[0].rank + combination[0].suit, combination[1].rank + combination[1].suit],
                    arrangement: result.arrangement,
                    score: result.score,
                    success: true,
                    statistics: result.statistics,
                    handCount: handResults.total
                });

            } else if (result.arrangement === null && globalBestScore > -Infinity) {
                // Correctly pruned - skip silently

            } else {
                console.log(`  Failed: ${result.error || 'Unknown error'}`);
                results.push({
                    wildCards: [combination[0].rank + combination[0].suit, combination[1].rank + combination[1].suit],
                    arrangement: null,
                    score: -Infinity,
                    success: false,
                    statistics: result.statistics,
                    handCount: handResults.total,
                    error: 'No valid arrangement found'
                });
            }


        } catch (error) {
            results.push({
                wildCards: ['ERROR', 'ERROR'],
                arrangement: null,
                score: -Infinity,
                success: false,
                statistics: null,
                handCount: 0,
                error: error.message
            });
        }
    });

    // STEP 5: Sort results by score and summarize (same as one-wild)
    // console.log(`\n📊 Step 5: Analyzing smart results...`);
    results.sort((a, b) => b.score - a.score);

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

//     console.log(`\n✅ ======== WILD Combinations ========`);
//     console.log(`Total combinations processed: ${results.length}`);
//     console.log(`Successful arrangements: ${successful.length}`);
//     console.log(`Failed attempts: ${failed.length}`);

    if (successful.length > 0) {
        const best = successful[0];
//        console.log(`\n🏆 Best Result (Smart Two-Wild):`);
//        console.log(`   Wild cards: ${best.wildCards.join(', ')}`);
//        console.log(`   Score: ${best.score}`);
//        console.log(`   Back: ${best.arrangement.back.handType} (${best.arrangement.back.cardCount} cards)`);
//        console.log(`   Middle: ${best.arrangement.middle.handType} (${best.arrangement.middle.cardCount} cards)`);
//        console.log(`   Front: ${best.arrangement.front.handType} (${best.arrangement.front.cardCount} cards)`);

        // Show top 5 results for smart approach
        // console.log(`\n🥇 Top 5 Results (Smart Two-Wild):`);
        successful.slice(0, 5).forEach((result, index) => {
            // console.log(`   ${index + 1}. ${result.wildCards.join(', ')}: ${result.score} points`);
        });

        // Show optimal score distribution
        const optimalScore = best.score;
        const optimalResults = successful.filter(r => r.score === optimalScore);
        // console.log(`\n🎯 Optimal Score Analysis:`);
        // console.log(`   Optimal score: ${optimalScore} points`);
        // console.log(`   Combinations achieving optimal: ${optimalResults.length}/${successful.length}`);
        // console.log(`   Optimal wild combinations: ${optimalResults.map(r => r.wildCards.join(', ')).slice(0, 3).join(' | ')}`);

        // Return same format as one-wild version
        // console.log(`🔍 DEBUG: Returning best result from smart success block`);

        return {
            arrangement: best.arrangement,
            score: best.score,
            wildCards: best.wildCards,
            success: true,
            statistics: best.statistics,
            topArrangements: successful.slice(0, 5).map(r => ({
                arrangement: r.arrangement,
                score: r.score
            }))
        };

    } else {
        console.log(`❌ No successful arrangements found!`);
        console.log(`🔍 DEBUG: Returning null from smart failure block`);
        return {
            arrangement: null,
            score: -Infinity,
            wildCards: null,
            success: false,
            statistics: null
        };
    }
}

/**
 * Create a card object from card object representation (adapted from one-wild)
 * @param {Object} cardObject - Card object from strategy
 * @param {string} originalId - ID from the original wild card
 * @returns {Object} Card object with wasWild flag
 */
function createCardFromObject(cardObject, originalId) {
    const substitutedCard = {
        id: originalId,
        rank: cardObject.rank,
        suit: cardObject.suit,
        isWild: false,
        wasWild: true,  // Visual indication flag
        value: cardObject.value
    };

    return substitutedCard;
}

/**
 * Combine results from both strategies and remove duplicates (same as main orchestrator)
 * @param {Array} strategy1Results - Results from Strategy 1
 * @param {Array} strategy2Results - Results from Strategy 2
 * @returns {Array} Combined and deduplicated results
 */
function combineAndDeduplicate(strategy1Results, strategy2Results) {
    const combinedResults = [...strategy1Results, ...strategy2Results];
    const uniqueResults = [];
    const seenCombinations = new Set();

    combinedResults.forEach(combo => {
       if (!Array.isArray(combo)) {
            console.log('❌ Non-array combo:', combo);
            return;
        }

       // Create a normalized key for this combination (sorted by card ID)
        const sortedCombo = [...combo].sort((a, b) => a.id.localeCompare(b.id));
        const comboKey = sortedCombo.map(c => `${c.rank}${c.suit}`).join(',');

        if (!seenCombinations.has(comboKey)) {
            seenCombinations.add(comboKey);
            uniqueResults.push(combo);
        }
    });

    return uniqueResults;
}
