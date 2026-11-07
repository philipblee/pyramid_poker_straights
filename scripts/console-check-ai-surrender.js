// Check the computers' play/surrender decision (decideAISurrender in js/ui/surrender-decision.js).
// Browser: open a single-player game, paste this whole file into the console. Node: node scripts/console-check-ai-surrender.js
// Deals random tables at 2 to 6 seats on a stand-in game, runs the real processAIDecisions, and checks:
//   - every computer's decision equals recommendPlayOrSurrender(its first 13 cards, seat count).decision (expect 100%)
//   - the no-wild play rate by seat count is near the replay analysis (1.000, 0.911, 0.712, 0.559, 0.329)
//   - hands with a wild always play, the dealt cards are not changed, and nothing falls back
//   - 'simple' gives the old logic (about 0.72 no-wild at every seat count)
//   - a 7-seat table falls back to the simple logic with one warning and one 'aiSurrenderFallback' log per computer
// The real window.game, gameConfig setting, console.warn and remoteDebugLogger are restored afterwards.

function consoleCheckAiSurrender(tablesPerSeatCount = 3000) {
    const EXPECTED_NO_WILD_PLAY_RATE = { 2: 1.000, 3: 0.911, 4: 0.712, 5: 0.559, 6: 0.329 };
    const SIMPLE_TABLES_PER_SEAT_COUNT = 1000;

    const realGame = window.game;
    const realLogic = window.gameConfig.config.computerSurrenderLogic;
    const realWarn = console.warn;
    const realDebugLogger = window.remoteDebugLogger;
    const fallbackWarnings = [];
    const fallbackLogs = [];
    console.warn = (...warningParts) => fallbackWarnings.push(warningParts.join(' '));
    window.remoteDebugLogger = (eventName, eventDetails) => fallbackLogs.push({ eventName, eventDetails });

    // A stand-in game: one human plus computers, each dealt 17 cards from one shuffled deck (or a fresh deck per seat past 6)
    function dealStandInTable(seatCount) {
        const players = [{ name: 'Check_Human', type: 'human' }];
        for (let computerIndex = 1; computerIndex < seatCount; computerIndex++) {
            players.push({ name: `Check_${computerIndex}_AI`, type: 'ai' });
        }
        const sharedDeck = shuffleDeck(createDeck());
        const playerHands = new Map();
        players.forEach((player, seatIndex) => {
            const dealtCards = seatCount <= 6
                ? sharedDeck.slice(seatIndex * 17, seatIndex * 17 + 17)
                : shuffleDeck(createDeck()).slice(0, 17);
            playerHands.set(player.name, { cards: dealtCards, originalCards: dealtCards.map(card => ({ ...card })) });
        });
        const surrenderDecisions = new Map([['Check_Human', 'play']]);
        return { playerManager: { players }, playerHands, surrenderDecisions };
    }

    function runTables(seatCount, tableCount) {
        const tally = { computers: 0, agree: 0, noWild: 0, noWildPlays: 0, wild: 0, wildPlays: 0, unchanged: 0 };
        for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
            const standInGame = dealStandInTable(seatCount);
            const cardsBefore = JSON.stringify([...standInGame.playerHands.values()].map(hand => hand.originalCards));
            window.game = standInGame;
            processAIDecisions();
            if (JSON.stringify([...standInGame.playerHands.values()].map(hand => hand.originalCards)) === cardsBefore) tally.unchanged++;
            standInGame.playerManager.players.filter(player => player.type === 'ai').forEach(computer => {
                const thirteenCards = standInGame.playerHands.get(computer.name).originalCards.slice(0, 13);
                const decision = standInGame.surrenderDecisions.get(computer.name);
                const hasWild = thirteenCards.some(card => card.isWild);
                tally.computers++;
                if (seatCount <= 6 && decision === recommendPlayOrSurrender(thirteenCards, seatCount).decision) tally.agree++;
                if (hasWild) {
                    tally.wild++;
                    if (decision === 'play') tally.wildPlays++;
                } else {
                    tally.noWild++;
                    if (decision === 'play') tally.noWildPlays++;
                }
            });
        }
        return tally;
    }

    const reportLines = [];
    let allPass = true;
    try {
        const wildCount = window.gameConfig.getWildCardCount();
        reportLines.push(`Deck: 2 decks + ${wildCount} wilds. ${tablesPerSeatCount} tables per seat count.`);
        if (wildCount !== 2) reportLines.push('Note: the analysis used 2 wilds, so no-wild play rates may differ slightly from the targets.');

        window.gameConfig.config.computerSurrenderLogic = 'table-size-rule';
        reportLines.push('\ntable-size-rule');
        reportLines.push('seats  computers   agree  no-wild  play rate  target  band     wild  wild play  cards unchanged  result');
        [2, 3, 4, 5, 6].forEach(seatCount => {
            const warningsBefore = fallbackWarnings.length;
            const tally = runTables(seatCount, tablesPerSeatCount);
            const playRate = tally.noWildPlays / tally.noWild;
            const target = EXPECTED_NO_WILD_PLAY_RATE[seatCount];
            const band = Math.max(0.01, 3 * Math.sqrt(target * (1 - target) / tally.noWild));
            const pass = tally.agree === tally.computers && Math.abs(playRate - target) <= band &&
                tally.wildPlays === tally.wild && tally.unchanged === tablesPerSeatCount && fallbackWarnings.length === warningsBefore;
            allPass = allPass && pass;
            reportLines.push(`${String(seatCount).padStart(5)}  ${String(tally.computers).padStart(9)}  ${String(tally.agree).padStart(6)}  ${String(tally.noWild).padStart(7)}  ${playRate.toFixed(3).padStart(9)}  ${target.toFixed(3)}  ±${band.toFixed(3)}  ${String(tally.wild).padStart(5)}  ${(tally.wildPlays / tally.wild).toFixed(3).padStart(9)}  ${String(tally.unchanged === tablesPerSeatCount).padStart(15)}  ${pass ? 'ok' : 'FAIL'}`);
        });

        window.gameConfig.config.computerSurrenderLogic = 'simple';
        reportLines.push(`\nsimple (old logic, ${SIMPLE_TABLES_PER_SEAT_COUNT} tables per seat count)`);
        reportLines.push('seats  no-wild  play rate  wild play  result');
        [2, 3, 4, 5, 6].forEach(seatCount => {
            const tally = runTables(seatCount, SIMPLE_TABLES_PER_SEAT_COUNT);
            const playRate = tally.noWildPlays / tally.noWild;
            const pass = playRate > 0.65 && playRate < 0.80 && tally.wildPlays === tally.wild;
            allPass = allPass && pass;
            reportLines.push(`${String(seatCount).padStart(5)}  ${String(tally.noWild).padStart(7)}  ${playRate.toFixed(3).padStart(9)}  ${(tally.wildPlays / tally.wild).toFixed(3).padStart(9)}  ${pass ? 'ok' : 'FAIL'}`);
        });

        window.gameConfig.config.computerSurrenderLogic = 'table-size-rule';
        fallbackWarnings.length = 0;
        fallbackLogs.length = 0;
        const sevenSeatTally = runTables(7, 1);
        const fallbackLogged = fallbackLogs.filter(log => log.eventName === 'aiSurrenderFallback' && log.eventDetails.seatCount === 7);
        const fallbackPass = sevenSeatTally.computers === 6 && fallbackWarnings.length === 6 && fallbackLogged.length === 6 &&
            fallbackWarnings.every(warning => warning.includes('using simple logic'));
        allPass = allPass && fallbackPass;
        reportLines.push(`\n7-seat table: ${fallbackWarnings.length} warnings, ${fallbackLogged.length} aiSurrenderFallback logs for 6 computers  ${fallbackPass ? 'ok' : 'FAIL'}`);
        reportLines.push(`Example warning: ${fallbackWarnings[0]}`);
    } finally {
        window.game = realGame;
        window.gameConfig.config.computerSurrenderLogic = realLogic;
        console.warn = realWarn;
        window.remoteDebugLogger = realDebugLogger;
    }

    reportLines.push(allPass ? '\nALL CHECKS PASS' : '\nSOME CHECKS FAILED');
    console.log(reportLines.join('\n'));
    return allPass;
}

if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module) {
    // Node: load the game files into this context with a minimal document, then run the check
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const repoRoot = path.resolve(__dirname, '..');
    global.window = global;
    global.document = { readyState: 'loading', addEventListener: () => {} };
    global.remoteDebugLogger = () => {};
    ['js/utils.js', 'js/utilities/analysis.js', 'js/hands/card-utilities.js', 'js/heuristics/play-surrender-cell-table.js',
        'js/heuristics/recommend-play-or-surrender.js', 'js/core/game-config.js', 'js/ui/surrender-decision.js'].forEach(relativePath => {
        vm.runInThisContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), { filename: relativePath });
    });
    window.gameConfig.config.wildCardCount = 2;
    process.exit(consoleCheckAiSurrender(Number(process.argv[2]) || 3000) ? 0 : 1);
} else {
    consoleCheckAiSurrender();
}
