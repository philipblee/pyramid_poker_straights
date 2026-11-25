// js/multiplayer/show-round-results.js
// Multi-device non-owners: don't score. Wait for the owner's tables/{tableId}/roundResults record
// for this round and show the scoring popup from it.

const ROUND_RESULTS_TIMEOUT_MS = 20000;

let roundResultsRef = null;
let roundResultsHandler = null;
let roundResultsTimeoutId = null;
let lastShownRoundResultsWrittenAt = null;

function stopWaitingForRoundResults() {
    if (roundResultsRef && roundResultsHandler) {
        roundResultsRef.off('value', roundResultsHandler);
    }
    roundResultsRef = null;
    roundResultsHandler = null;
    clearTimeout(roundResultsTimeoutId);
    roundResultsTimeoutId = null;
}

function setRoundResultsStatus(statusText) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.innerHTML = statusText;
    }
}

function showRoundResults() {
    const game = window.game;
    const expectedRound = game.currentRound;
    const waitStartTime = performance.now();

    // Only one wait at a time
    stopWaitingForRoundResults();

    console.log(`🧪 showRoundResults waiting for round=${expectedRound}`);
    setRoundResultsStatus('Waiting for results from the table owner...');

    roundResultsTimeoutId = setTimeout(() => {
        remoteDebugLogger('roundResultsTimeout', { expectedRound, waitedMs: ROUND_RESULTS_TIMEOUT_MS }, true);
        setRoundResultsStatus("Still waiting for the table owner's results...");
    }, ROUND_RESULTS_TIMEOUT_MS);

    roundResultsRef = firebase.database().ref(`tables/${game.currentTableId}/roundResults`);
    roundResultsHandler = (snapshot) => {
        const roundResultsRecord = snapshot.val();
        if (!roundResultsRecord || typeof roundResultsRecord.round !== 'number') return;

        // Older record (previous round, not yet cleared): keep waiting
        if (roundResultsRecord.round < game.currentRound) return;

        // This device is behind the owner: adopt the owner's round
        if (roundResultsRecord.round > game.currentRound) {
            remoteDebugLogger('roundResync', { localRound: game.currentRound, ownerRound: roundResultsRecord.round }, true);
            game.currentRound = roundResultsRecord.round;
        }

        stopWaitingForRoundResults();

        // Already shown this exact record (e.g. a repeated SCORING event). writtenAt identifies one owner write;
        // round numbers alone repeat across tournaments
        if (lastShownRoundResultsWrittenAt === roundResultsRecord.writtenAt) return;
        lastShownRoundResultsWrittenAt = roundResultsRecord.writtenAt;
        if (window.multiDeviceIntegration) {
            window.multiDeviceIntegration.lastScoringRound = roundResultsRecord.round;  // keeps the ?debug overlay accurate
        }

        remoteDebugLogger('roundResultsReceived',
            { round: roundResultsRecord.round, waitedMs: Math.round(performance.now() - waitStartTime) }, true);

        displayRoundResults(game, roundResultsRecord);
    };
    roundResultsRef.on('value', roundResultsHandler);
}

// Rebuild this round's local state from the owner's record, then show the popup from it
function displayRoundResults(game, roundResultsRecord) {
    const ownerPlayerResults = roundResultsRecord.players || [];
    // RTDB drops empty arrays, so restore them
    const detailedResults = (roundResultsRecord.detailedResults || []).map(matchup => ({
        ...matchup,
        details: matchup.details || []
    }));

    // Arrangements (RTDB drops empty arrays, so restore the three rows)
    game.submittedHands.clear();
    game.automaticHands?.clear();
    ownerPlayerResults.forEach(playerResult => {
        if (!playerResult.arrangement) return;
        const arrangement = {
            ...playerResult.arrangement,
            back: playerResult.arrangement.back || [],
            middle: playerResult.arrangement.middle || [],
            front: playerResult.arrangement.front || []
        };
        game.submittedHands.set(playerResult.name, arrangement);

        if (arrangement.playedAutomatic === 'yes' && game.automaticHands) {
            game.automaticHands.set(playerResult.name, {
                type: arrangement.automaticType,
                arrangement: { back: arrangement.back, middle: arrangement.middle, front: arrangement.front }
            });
        }
    });

    // Surrender decisions for this round only
    game.surrenderDecisions = game.surrenderDecisions || new Map();
    game.surrenderDecisions.clear();
    ownerPlayerResults.forEach(playerResult => {
        game.surrenderDecisions.set(playerResult.name, playerResult.surrendered ? 'surrender' : 'play');
    });

    // Round scores: players still in the round, as calculateScores builds them
    const roundScores = new Map(ownerPlayerResults
        .filter(playerResult => !playerResult.surrendered)
        .map(playerResult => [playerResult.name, playerResult.score ?? 0]));

    game.recordRoundHistory(roundScores, detailedResults);
    game.detailedResults = detailedResults;

    // Not awaited: the popup stays open until the owner continues
    showScoringPopup(game, detailedResults, roundScores, new Map(), null, roundResultsRecord)
        .then(() => updateDisplay(game))
        .catch(displayError => {
            console.error('❌ showRoundResults popup failed', displayError);
            remoteDebugLogger('roundResultsDisplayFailed',
                { round: roundResultsRecord.round, error: String(displayError?.stack || displayError).slice(0, 300) }, true);
        });
}
