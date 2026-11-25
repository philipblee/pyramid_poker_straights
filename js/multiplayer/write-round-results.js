// js/multiplayer/write-round-results.js
// Owner only: last step of scoring, after distributeChips. Writes one results record per round
// to tables/{tableId}/roundResults so every device can show the owner's results.

/**
 * Write this round's results record to RTDB. Never throws: chips are already paid,
 * so only the write is retried (up to 3 times) and any failure is logged.
 * @param {Object} game - PyramidPoker instance
 * @param {Array} detailedResults - Head-to-head results from calculateScores
 * @param {Map} roundScores - playerName -> net points this round
 * @param {Map} chipChanges - playerName -> chip change this round (from distributeChips)
 */
async function writeRoundResults(game, detailedResults, roundScores, chipChanges) {
    const scoringRound = game?.currentRound;

    try {
        const roundFinancial = window.lastRoundFinancial || {};

        const playerResults = game.playerManager.getPlayerNames().map(playerName => ({
            name: playerName,
            surrendered: game.surrenderDecisions?.get(playerName) === 'surrender',
            score: roundScores?.get(playerName) ?? 0,
            chipChange: chipChanges?.get(playerName) ?? 0,
            chipBalance: roundFinancial.chipBalances?.get(playerName) ?? null,
            arrangement: game.submittedHands.get(playerName) ?? null
        }));

        // JSON round trip strips undefined values, which RTDB set() rejects
        const roundResultsRecord = JSON.parse(JSON.stringify({
            round: scoringRound,
            tournamentNumber: game.tournamentNumber,
            pot: roundFinancial.pot ?? 0,
            winners: roundFinancial.winners ?? [],
            potShare: roundFinancial.potShare ?? 0,
            players: playerResults,
            detailedResults: detailedResults || []
        }));
        roundResultsRecord.writtenAt = firebase.database.ServerValue.TIMESTAMP;

        const roundResultsRef = firebase.database().ref(`tables/${game.currentTableId}/roundResults`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await roundResultsRef.set(roundResultsRecord);
                console.log(`🧪 roundResults written round=${scoringRound} attempt=${attempt}`);
                remoteDebugLogger('roundResultsWritten',
                    { round: scoringRound, tournamentNumber: roundResultsRecord.tournamentNumber ?? null, attempt, playerCount: playerResults.length },
                    true);
                return;
            } catch (writeError) {
                console.error(`❌ roundResults write failed (attempt ${attempt})`, writeError);
                remoteDebugLogger('roundResultsWriteFailed',
                    { round: scoringRound ?? null, attempt, error: String(writeError).slice(0, 300) },
                    attempt === 3);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    } catch (buildError) {
        // Building the record failed (bad data, missing game state): log it, never break the owner's popup
        console.error('❌ roundResults record could not be built', buildError);
        remoteDebugLogger('roundResultsWriteFailed',
            { round: scoringRound ?? null, attempt: 0, error: String(buildError?.stack || buildError).slice(0, 300) },
            true);
    }
}
