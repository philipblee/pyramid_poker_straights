// js/stats/play-hand-stats.js
// Statistics generator for Pyramid Poker Online
// Generates detailed statistics for hand analysis and game balance research

class PlayHandStats {
    constructor() {
        this.deckManager = new DeckManager();
        this.statistics = {
            totalHands: 0,
            totalPlayers: 0,
            executionTimes: [],
            errors: 0
        };
    }

    /**
     * Play a single hand and generate complete statistics
     * @param {number} playerCount - Number of players (1-6)
     * @param {number} wildCount - Number of wild cards (0-2)
     * @returns {Object} Complete hand statistics
     */
    playHandStats(playerCount = 6, wildCount = 2) {
//        console.log(`🎯 Playing one hand: ${playerCount} players, ${wildCount} wilds`);

        const startTime = performance.now();

        try {
            // Step 1: Create deck and deal cards
            this.deckManager.createNewDeck();
            const playerCards = [];
            for (let i = 0; i < playerCount; i++) {
                playerCards.push(this.deckManager.dealCards(17));
            }

            // Step 2: Analyze each player's hand
            const playerData = [];

            for (let i = 0; i < playerCount; i++) {
                const playerName = `Player${i + 1}`;
                const cards = playerCards[i];

                // Pre-arrangement analysis
                const preAnalysis = countValidHandsFromCards(cards);

                // Find best arrangement
                const arrangement = findBestSetup(cards, { collectTopArrangements: false });
                const { wildCards } = CardUtilities.separateWildCards(cards);

                // Store player data
                playerData.push({
                    name: playerName,
                    cards: cards,
                    wildCount: wildCards.length,
                    preAnalysis: preAnalysis,
                    arrangement: arrangement,
                    roundScore: 0  // Will be calculated in scoring phase
                });
            }

            // Step 3: Calculate head-to-head scoring
            const scoringResults = this.calculateHeadToHeadScoring(playerData);

            // Step 4: Update player scores
            scoringResults.forEach(result => {
                const player1 = playerData.find(p => p.name === result.player1);
                const player2 = playerData.find(p => p.name === result.player2);

                if (player1) player1.roundScore += result.player1Score;
                if (player2) player2.roundScore += result.player2Score;
            });

            const endTime = performance.now();

            // Update class statistics
            this.statistics.totalHands++;
            this.statistics.totalPlayers += playerCount;
            this.statistics.executionTimes.push(endTime - startTime);

            // Step 5: Compile final results
            const handStats = {
                metadata: {
                    playerCount: playerCount,
                    wildCount: wildCount,
                    timestamp: new Date().toISOString(),
                    executionTime: endTime - startTime
                },
                players: playerData,
                scoringMatrix: scoringResults,
                summary: this.generateHandSummary(playerData, scoringResults)
            };

            // console.log(`✅ Hand complete in ${(endTime - startTime).toFixed(1)}ms`);

            // Find the winning player (highest roundScore)
            const winningPlayer = playerData.reduce((winner, player) =>
                player.roundScore > winner.roundScore ? player : winner
            );

            const arrangement = winningPlayer?.arrangement?.arrangement;
            const handTypes = arrangement
                ? `${arrangement.back.handType}, ${arrangement.middle.handType}, ${arrangement.front.handType}`
                : 'no arrangement';

            console.log(`✅ Done ${(endTime - startTime).toFixed(1)}ms - Win: ${winningPlayer.name} (${handTypes})`);

            return handStats;

        } catch (error) {
            console.error(`❌ Error in playHandStats:`, error);
            this.statistics.errors++;
            return {
                error: error.message,
                metadata: {
                    playerCount: playerCount,
                    wildCount: wildCount,
                    timestamp: new Date().toISOString(),
                    executionTime: 0
                }
            };
        }
    }

    /**
     * Calculate head-to-head scoring using clean extraction from game.js
     * @param {Array} playerData - Array of player objects with arrangements
     * @returns {Array} Array of head-to-head matchup results
     */
    calculateHeadToHeadScoring(playerData) {
        return this.calculateCleanHeadToHeadScoring(playerData);
    }

    /**
     * Clean head-to-head scoring extracted from game.js
     * @param {Array} playerData - Array of player objects with arrangement data
     * @returns {Array} Array of head-to-head results
     */
    calculateCleanHeadToHeadScoring(playerData) {
//        console.log(`⚔️ Clean head-to-head scoring for ${playerData.length} players...`);

        const results = [];

        // Compare every player against every other player
        for (let i = 0; i < playerData.length; i++) {
            for (let j = i + 1; j < playerData.length; j++) {
                const player1 = playerData[i];
                const player2 = playerData[j];

                // Extract arrangements
                const arrangement1 = player1.arrangement.arrangement;
                const arrangement2 = player2.arrangement.arrangement;

                // Compare the two arrangements
                const matchupResult = this.compareArrangements(arrangement1, arrangement2);

                // Add to results in the format Step 4 expects
                results.push({
                    player1: player1.name,
                    player2: player2.name,
                    player1Score: matchupResult.player1Score,
                    player2Score: matchupResult.player2Score,
                    details: matchupResult.details
                });
            }
        }

//        console.log(`✅ Generated ${results.length} head-to-head matchups`);
        return results;
    }

    /**
     * Compare two arrangements and return scoring results
     * Extracted from game.js compareHands method
     */
    compareArrangements(arrangement1, arrangement2) {
        let player1Score = 0;
        let player2Score = 0;
        const details = [];

        // Back hand comparison
        const back1 = evaluateHand(arrangement1.back.cards);
        const back2 = evaluateHand(arrangement2.back.cards);
        const backComparison = compareTuples(back1.handStrength, back2.handStrength);
        let backResult = 'tie';

        if (backComparison > 0) {
            const points = this.getHandPoints(back1, arrangement1.back.cards.length, 'back');
            player1Score += points;
            player2Score -= points;
            backResult = 'player1';
        } else if (backComparison < 0) {
            const points = this.getHandPoints(back2, arrangement2.back.cards.length, 'back');
            player2Score += points;
            player1Score -= points;
            backResult = 'player2';
        }

        details.push({
            hand: 'Back',
            player1Hand: back1,
            player2Hand: back2,
            winner: backResult
        });

        // Middle hand comparison
        const middle1 = evaluateHand(arrangement1.middle.cards);
        const middle2 = evaluateHand(arrangement2.middle.cards);
        const middleComparison = compareTuples(middle1.handStrength, middle2.handStrength);
        let middleResult = 'tie';

        if (middleComparison > 0) {
            const points = this.getHandPoints(middle1, arrangement1.middle.cards.length, 'middle');
            player1Score += points;
            player2Score -= points;
            middleResult = 'player1';
        } else if (middleComparison < 0) {
            const points = this.getHandPoints(middle2, arrangement2.middle.cards.length, 'middle');
            player2Score += points;
            player1Score -= points;
            middleResult = 'player2';
        }

        details.push({
            hand: 'Middle',
            player1Hand: middle1,
            player2Hand: middle2,
            winner: middleResult
        });

        // Front hand comparison
        const front1 = evaluateThreeCardHand(arrangement1.front.cards);
        const front2 = evaluateThreeCardHand(arrangement2.front.cards);
        const frontComparison = compareTuples(front1.handStrength, front2.handStrength);
        let frontResult = 'tie';

        if (frontComparison > 0) {
            const points = this.getHandPoints(front1, arrangement1.front.cards.length, 'front');
            player1Score += points;
            player2Score -= points;
            frontResult = 'player1';
        } else if (frontComparison < 0) {
            const points = this.getHandPoints(front2, arrangement2.front.cards.length, 'front');
            player2Score += points;
            player1Score -= points;
            frontResult = 'player2';
        }

        details.push({
            hand: 'Front',
            player1Hand: front1,
            player2Hand: front2,
            winner: frontResult
        });

        return { player1Score, player2Score, details };
    }

    /**
     * Get points for a hand based on position and card count
     * Extracted from game.js getHandPoints method
     */
    getHandPoints(handEval, cardCount, position) {
        const handRank = handEval.handType;

        if (position === 'back') {
            if (cardCount === 5) {
                if (handRank === 8) return 4;  // Four of a Kind
                if (handRank === 9) return 5;  // Straight Flush
                if (handRank === 10) return 6; // Five of a Kind
                return 1;
            } else if (cardCount === 6) {
                if (handRank === 11) return 8;  // 6-card Straight Flush
                if (handRank === 12) return 10; // 6 of a Kind
                return 1;
            } else if (cardCount === 7) {
                if (handRank === 13) return 11; // 7-card Straight Flush
                if (handRank === 14) return 14; // 7 of a Kind
                return 1;
            } else if (cardCount === 8) {
                if (handRank === 15) return 14; // 8-card Straight Flush
                if (handRank === 16) return 18; // 8 of a Kind
                return 1;
            }
        } else if (position === 'middle') {
            if (cardCount === 5) {
                if (handRank === 7) return 2;  // Full House
                if (handRank === 8) return 8;  // Four of a Kind
                if (handRank === 9) return 10; // Straight Flush
                if (handRank === 10) return 12; // Five of a Kind
                return 1;
            } else if (cardCount === 6) {
                if (handRank === 11) return 16; // 6-card Straight Flush
                if (handRank === 12) return 20; // 6 of a Kind
                return 1;
            } else if (cardCount === 7) {
                if (handRank === 13) return 22; // 7-card Straight Flush
                if (handRank === 14) return 28; // 7 of a Kind
                return 1;
            }
        } else if (position === 'front') {
            if (cardCount === 3) {
                if (handRank === 4) return 3; // Three of a kind
                return 1;
            } else if (cardCount === 5) {
                if (handRank === 5) return 4;  // Straight
                if (handRank === 6) return 4;  // Flush
                if (handRank === 7) return 5;  // Full House
                if (handRank === 8) return 12; // Four of a Kind
                if (handRank === 9) return 15; // Straight Flush
                if (handRank === 10) return 18; // Five of a Kind
                return 1;
            }
        }

        return 1;
    }

    /**
     * Generate summary statistics for a completed hand
     * @param {Array} playerData - Array of player data with scores
     * @param {Array} scoringResults - Head-to-head scoring results
     * @returns {Object} Summary statistics
     */
    generateHandSummary(playerData, scoringResults) {
        const scores = playerData.map(p => p.roundScore);
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        const winner = playerData.find(p => p.roundScore === maxScore);

        // Count wild card usage
        const wildCardDistribution = {};
        playerData.forEach(player => {
            const wildCount = player.wildCount;
            wildCardDistribution[wildCount] = (wildCardDistribution[wildCount] || 0) + 1;
        });

        // Arrangement types distribution
        const arrangementTypes = {
            back: {},
            middle: {},
            front: {}
        };

        playerData.forEach(player => {
            const arr = player.arrangement.arrangement;
            ['back', 'middle', 'front'].forEach(position => {
                const handType = arr[position].handType;
                arrangementTypes[position][handType] = (arrangementTypes[position][handType] || 0) + 1;
            });
        });

        return {
            winner: {
                name: winner.name,
                score: winner.roundScore
            },
            scoreRange: {
                min: minScore,
                max: maxScore,
                spread: maxScore - minScore
            },
            wildCardDistribution,
            arrangementTypes,
            totalMatchups: scoringResults.length
        };
    }

    /**
     * Get current class statistics
     * @returns {Object} Statistics summary
     */
    getStatistics() {
        const avgTime = this.statistics.executionTimes.length > 0
            ? this.statistics.executionTimes.reduce((a, b) => a + b) / this.statistics.executionTimes.length
            : 0;

        return {
            ...this.statistics,
            averageExecutionTime: avgTime,
            avgPlayersPerHand: this.statistics.totalHands > 0
                ? this.statistics.totalPlayers / this.statistics.totalHands
                : 0
        };
    }

    /**
     * Reset statistics counters
     */
    resetStatistics() {
        this.statistics = {
            totalHands: 0,
            totalPlayers: 0,
            executionTimes: [],
            errors: 0
        };
    }
}

/**
 * Test function for development and debugging
 * @param {number} playerCount - Number of players to test with
 * @param {number} wildCount - Number of wild cards to test with
 * @returns {Object} Test results
 */
function testPlayHandStats(playerCount = 6, wildCount = 2) {
//    console.log('🧪 Testing PlayHandStats...');

    const stats = new PlayHandStats();
    const result = stats.playHandStats(playerCount, wildCount);

    if (result.error) {
        console.log('❌ Test failed:', result.error);
        return result;
    }

    // Display results
//    console.log('\n📊 HAND RESULTS:');
//    console.log(`Winner: ${result.summary.winner.name} (${result.summary.winner.score} points)`);
//    console.log(`Score range: ${result.summary.scoreRange.min} to ${result.summary.scoreRange.max}`);

//    console.log('\n👥 PLAYER SCORES:');
    result.players.forEach(player => {
        const wildInfo = player.wildCount > 0 ? ` (${player.wildCount} wilds)` : '';
//        console.log(`  ${player.name}: ${player.roundScore} points${wildInfo}`);
    });

    console.log('\n📈 PERFORMANCE:');
    console.log(`  Execution time: ${result.metadata.executionTime.toFixed(1)}ms`);
    console.log(`  Total hands played: ${stats.statistics.totalHands}`);
    console.log(`  Total players: ${stats.statistics.totalPlayers}`);

    return result;
}
