// Measure how much post-kicker score the cdf method leaves on the table on no-wild hands by choosing its played
// arrangement on the pre-kicker score.
// Usage: node scripts/measure-kicker-gap.js [--hands N] [--rounds 2000] [--seed 1] [--workers W] [--out data/kicker_gap.csv]
//
// Played arrangement: FindBestSetupNoWildBase.findBestSetupNoWild (js/arrange/find-best-setup-no-wild.js) keeps the
//   leaf with the best pre-kicker score (searchFrontHands: getHandScore summed over the hands as detected, often
//   incomplete) and then fills kickers with addKickersToArrangement, whose createArrangement score is the post-kicker
//   total. topArrangements (collectTopArrangements: true) holds explored leaves completed with kickers, ranked on that
//   post-kicker score; topArrangements[0] is the best of them.
// Gain = topArrangements[0].score - played arrangement score, both post-kicker. A lower bound: pruning and the early
//   stop use the pre-kicker score, so leaves with a higher post-kicker score may never be explored.
// Gate: the played arrangement must equal cdf's arrangement in the cdf vs tiered2 match CSVs (cdf is player A).
//   On any mismatch the run stops and lists the mismatches, since the gain would be measured against the wrong baseline.
// Hands: the first N no-wild hands (round order, then seat) of seed S rounds 0..rounds-1, dealt as the match dealt them.
// Writes one CSV row per hand whose arrangements differ; the CSV is not added to git.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { readMatchCsv } = require('./match-summary.js');
const { runProgress } = require('./run-progress.js');

const REPO = path.resolve(__dirname, '..');
const SEAT_COUNT = 6;
const MATCH_CSVS = ['data/matches/match_cdf_vs_tiered2_seed1_1000.csv', 'data/matches/match_cdf_vs_tiered2_seed1_1000_start1000.csv'];
const CDF_ARRAYS = 'data/cdf_arrays_netev.json';
const CDF_ARRAYS_MATCH_SHA256 = '498dc561f7a9b9c6619f1e698faefdced47ad9213d12ab1a2f470c7325ede504';
// Same game files and order as scripts/deal-lookup-rounds.js SCRIPT_FILES (that script runs on require, so it cannot be imported)
const SCRIPT_FILES = [
    'js/constants/hand-types.js', 'js/utils.js', 'js/utilities/analysis.js', 'js/utilities/card-count.js',
    'js/utilities/empirical-win-probability.js', 'js/utilities/tiered-win-probability.js', 'js/utilities/tiered2-win-probability.js',
    'js/utilities/netEV-lookup-table.js', 'js/utilities/cdf-lookup.js', 'js/utilities/derived-loss-penalties.js',
    'js/utilities/convert-to-card-model.js', 'js/hands/evaluate-hand.js', 'js/hands/hand-utilities.js', 'js/hands/scoring-utilities.js',
    'js/core/deck.js', 'js/utils/card-sorter.js', 'js/scoring/compare-hands.js', 'js/utilities/card-parser.js',
    'js/utilities/count-valid-hands.js', 'js/utilities/count-valid-hands-from-cards.js', 'js/utilities/create-arrangement.js',
    'js/arrange/hand-sorter.js', 'js/hands/hand-detector.js', 'js/hands/card-utilities.js', 'js/hands/arrangement-scorer.js',
    'js/hands/arrangement-validator.js', 'js/arrange/two-wild-strategy-one.js', 'js/arrange/two-wild-strategy-two.js',
    'js/core/game-config.js', 'js/arrange/find-best-setup-no-wild.js', 'js/arrange/one-wild-candidates.js',
    'js/arrange/find-best-setup-one-wild.js', 'js/arrange/find-best-setup-two-wild.js', 'js/arrange/find-best-setup.js',
    'js/stats/play-hand-stats.js'
];

function argValue(flag) {
    const flagIndex = process.argv.indexOf(flag);
    return flagIndex === -1 || flagIndex + 1 >= process.argv.length ? null : process.argv[flagIndex + 1];
}

// Host stubs and game code as in scripts/deal-lookup-rounds.js installHost / loadGameScripts
function loadGame() {
    global.window = global;
    global.performance = performance;
    global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
    global.document = {
        getElementById() { return { innerHTML: '', style: {}, appendChild() {}, addEventListener() {} }; },
        createElement() { return { className: '', style: {}, appendChild() {}, addEventListener() {} }; },
        addEventListener() {},
        body: { appendChild() {} }
    };
    const gameSource = SCRIPT_FILES.map((relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8') + '\n').join('\n');
    vm.runInThisContext(gameSource, { filename: 'measure-kicker-gap-game.js' });
    const cdfArraysBytes = fs.readFileSync(path.join(REPO, CDF_ARRAYS));
    const cdfArraysHash = crypto.createHash('sha256').update(cdfArraysBytes).digest('hex');
    if (cdfArraysHash !== CDF_ARRAYS_MATCH_SHA256) throw new Error(`${CDF_ARRAYS} is not the file the cdf vs tiered2 matches used`);
    cdfLookup.loadFromJson(JSON.parse(cdfArraysBytes.toString('utf8')));
    gameConfig.config.wildCardCount = 2;
    gameConfig.config.winProbabilityMethod = 'cdf';
    window.NETEV_USE_TIERED2_FORMULA = false;
    if (window.WIN_PROB_OVERRIDE !== undefined) throw new Error('window.WIN_PROB_OVERRIDE is set');
}

// Same PRNG and dealing as scripts/deal-lookup-rounds.js seededRandomForRound / dealMatchHands
function seededRandomForRound(seed, roundIndex) {
    let state = crypto.createHash('sha256').update(`${seed}:${roundIndex}`).digest().readUInt32LE(0);
    return function mulberry32() {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function dealMatchHands(seed, roundIndex) {
    const browserShuffleDeck = global.shuffleDeck;
    const roundRandom = seededRandomForRound(seed, roundIndex);
    global.shuffleDeck = function seededShuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(roundRandom() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    };
    try {
        const deckManager = new DeckManager();
        deckManager.createNewDeck();
        return Array.from({ length: SEAT_COUNT }, () => deckManager.dealCards(17));
    } finally {
        global.shuffleDeck = browserShuffleDeck;
    }
}

// As scripts/deal-lookup-rounds.js arrangementSignature
function arrangementSignature(arrangement) {
    return ['back', 'middle', 'front'].map((position) => arrangement[position].cards
        .map((card) => `${card.rank}${card.suit}${card.isWild || card.wasWild ? '*' : ''}`)
        .sort()
        .join(' ')).join(' / ');
}

function handTypes(arrangement) {
    return ['back', 'middle', 'front'].map((position) => arrangement[position].handType || arrangement[position].name || '?').join(' / ');
}

function selectedHands(seed, rounds, handLimit) {
    const hands = [];
    for (let roundIndex = 0; roundIndex < rounds && hands.length < handLimit; roundIndex++) {
        dealMatchHands(seed, roundIndex).forEach((handCards, handIndex) => {
            if (hands.length < handLimit && !handCards.some((card) => card.isWild)) hands.push({ round: roundIndex, handIndex });
        });
    }
    return hands;
}

function measureHand(seed, hand) {
    const handCards = dealMatchHands(seed, hand.round)[hand.handIndex].map((card) => ({ ...card }));
    const savedLog = console.log;
    console.log = () => {};
    let solved;
    try {
        solved = findBestSetup(handCards, { collectTopArrangements: true });
    } finally {
        console.log = savedLog;
    }
    if (!solved || !solved.success || !solved.arrangement) throw new Error(`round ${hand.round} hand ${hand.handIndex}: no arrangement`);
    const topEntry = solved.topArrangements && solved.topArrangements[0];
    if (!topEntry) throw new Error(`round ${hand.round} hand ${hand.handIndex}: no topArrangements`);
    return {
        round: hand.round,
        handIndex: hand.handIndex,
        playedSignature: arrangementSignature(solved.arrangement),
        topSignature: arrangementSignature(topEntry.arrangement),
        playedPreKickerScore: solved.score,
        playedScore: solved.arrangement.score,
        topScore: topEntry.score,
        playedTypes: handTypes(solved.arrangement),
        topTypes: handTypes(topEntry.arrangement),
        exploredNodes: solved.statistics.exploredNodes
    };
}

// Child: measure every hand whose position in the selection is workerIndex mod workerCount, one JSON line each
function runWorker(seed, rounds, handLimit, workerIndex, workerCount) {
    loadGame();
    const hands = selectedHands(seed, rounds, handLimit).filter((_, handPosition) => handPosition % workerCount === workerIndex);
    for (const hand of hands) process.stdout.write(`${JSON.stringify(measureHand(seed, hand))}\n`);
}

function csvField(text) {
    return `"${String(text).replace(/"/g, '""')}"`;
}

async function measureKickerGap() {
    const seed = Number(argValue('--seed') || '1');
    const rounds = Number(argValue('--rounds') || '2000');
    const handLimit = Number(argValue('--hands') || 'Infinity');
    const workerCount = Number(argValue('--workers') || '1');
    const outPath = path.resolve(REPO, argValue('--out') || 'data/kicker_gap.csv');
    if (argValue('--worker-index') !== null) {
        runWorker(seed, rounds, handLimit, Number(argValue('--worker-index')), workerCount);
        return;
    }

    loadGame();
    const matchSignatures = new Map();
    for (const matchCsv of MATCH_CSVS) {
        for (const matchRow of readMatchCsv(path.join(REPO, matchCsv))) matchSignatures.set(`${matchRow.round}:${matchRow.handIndex}`, matchRow);
    }
    const hands = selectedHands(seed, rounds, handLimit);
    console.log(`cdf, seed ${seed}, rounds 0-${rounds - 1}: ${hands.length} no-wild hands, ${workerCount} worker(s)`);

    const startedAt = Date.now();
    const handProgress = runProgress('Kicker gap', hands.length, outPath.replace(/\.csv$/i, '') + '_progress.txt', 'hand');
    const measuredHands = [];
    const mismatches = [];
    const workers = [];
    await new Promise((resolve, reject) => {
        let finishedWorkers = 0;
        for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
            const workerArgs = [__filename, '--seed', String(seed), '--rounds', String(rounds), '--hands', String(handLimit),
                '--workers', String(workerCount), '--worker-index', String(workerIndex)];
            const worker = spawn(process.execPath, workerArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
            workers.push(worker);
            let pendingText = '';
            worker.stdout.on('data', (chunk) => {
                pendingText += chunk.toString('utf8');
                const lines = pendingText.split('\n');
                pendingText = lines.pop();
                for (const line of lines.filter(Boolean)) {
                    const measured = JSON.parse(line);
                    const matchRow = matchSignatures.get(`${measured.round}:${measured.handIndex}`);
                    if (!matchRow || matchRow.w !== 0 || matchRow.signatureA !== measured.playedSignature) {
                        mismatches.push({ ...measured, matchSignature: matchRow ? matchRow.signatureA : '(no match row)' });
                        workers.forEach((runningWorker) => runningWorker.kill());
                        resolve();
                        return;
                    }
                    measuredHands.push(measured);
                    handProgress.report(measuredHands.length, () => `differ ${measuredHands.filter((row) => row.topSignature !== row.playedSignature).length}`);
                }
            });
            worker.on('exit', (exitCode) => {
                if (mismatches.length > 0) return;
                if (exitCode !== 0) {
                    reject(new Error(`worker ${workerIndex} exited with ${exitCode}`));
                    return;
                }
                finishedWorkers += 1;
                if (finishedWorkers === workerCount) resolve();
            });
        }
    });

    if (mismatches.length > 0) {
        console.log(`\nGATE FAILED after ${measuredHands.length} matching hands: the played arrangement differs from cdf's arrangement in the match CSVs.`);
        for (const mismatch of mismatches) {
            console.log(`  round ${mismatch.round} hand ${mismatch.handIndex}\n    re-solved: ${mismatch.playedSignature}\n    match:     ${mismatch.matchSignature}`);
        }
        console.log('No gain is reported: it would be measured against the wrong baseline.');
        process.exitCode = 1;
        return;
    }

    const differingHands = measuredHands.filter((row) => row.topSignature !== row.playedSignature);
    const gains = measuredHands.map((row) => row.topScore - row.playedScore);
    const differingGains = differingHands.map((row) => row.topScore - row.playedScore);
    const negativeGains = gains.filter((gain) => gain < -1e-9);
    const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const wallSeconds = (Date.now() - startedAt) / 1000;

    console.log(`\nHands examined: ${measuredHands.length} (all played arrangements match the cdf vs tiered2 match CSVs)`);
    console.log(`Wall ${wallSeconds.toFixed(1)}s, ${(wallSeconds * workerCount / Math.max(measuredHands.length, 1)).toFixed(3)} worker-seconds per hand`);
    console.log(`topArrangements[0] differs from the played arrangement: ${differingHands.length} (${(100 * differingHands.length / Math.max(measuredHands.length, 1)).toFixed(2)}%)`);
    console.log(`Post-kicker score gain from topArrangements[0] (cdf netEV units, sum over the three positions):`);
    console.log(`  mean over all hands      ${mean(gains).toFixed(4)}`);
    console.log(`  mean over differing hands ${mean(differingGains).toFixed(4)}`);
    console.log(`  max                      ${Math.max(0, ...gains).toFixed(4)}`);
    console.log(`  hands with gain > 0.01 ${gains.filter((gain) => gain > 0.01).length}, > 0.1 ${gains.filter((gain) => gain > 0.1).length}, > 0.5 ${gains.filter((gain) => gain > 0.5).length}`);
    if (negativeGains.length) console.log(`  hands where topArrangements[0] scores below the played arrangement: ${negativeGains.length} (min ${Math.min(...negativeGains).toFixed(4)})`);
    console.log('The gain is a lower bound: pruning and the early stop use the pre-kicker score, so leaves with a higher post-kicker score may never be explored.');

    const csvLines = ['round,hand_index,played_signature,top_signature,played_pre_kicker_score,played_score,top_score,gain,played_types,top_types,explored_nodes'];
    for (const row of differingHands) {
        csvLines.push([row.round, row.handIndex, csvField(row.playedSignature), csvField(row.topSignature), row.playedPreKickerScore.toFixed(6),
            row.playedScore.toFixed(6), row.topScore.toFixed(6), (row.topScore - row.playedScore).toFixed(6),
            csvField(row.playedTypes), csvField(row.topTypes), row.exploredNodes].join(','));
    }
    fs.writeFileSync(outPath, csvLines.join('\n') + '\n');
    console.log(`Wrote ${differingHands.length} rows to ${path.relative(REPO, outPath)}`);
}

if (require.main === module) {
    measureKickerGap().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { measureKickerGap };
