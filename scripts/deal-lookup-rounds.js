// Deal rounds with PlayHandStats and write the August JSON shape.
// Usage:
//   node scripts/deal-lookup-rounds.js --method empirical --rounds 10000 --out <file.json>
//   node scripts/deal-lookup-rounds.js --write-netev <hand_tuple_lookup.csv> <netEV_lookup_table.csv>
//   node scripts/deal-lookup-rounds.js --match A,B --rounds N --seed S [--start-round R] [--workers W]
//   --cdf-arrays <path>  CDF arrays for --method cdf and --test-all (default data/cdf_arrays_netev.json)
//   --seed S             seeded deals: round r's deck comes from a PRNG keyed by (S, r) (batch path only;
//                        the browser keeps Math.random). --start-round R numbers the first round R (default 0).
// Batch runs also write <out>.meta.json (method, seed, rounds, git commit, table sha256s, node version, timestamp).
// --match writes data/matches/match_<A>_vs_<B>_seed<S>_<N>[_start<R>].{json,csv}; pool batches with scripts/pool-matches.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { matchSummary, formatMatchSummary, matchCsvText, MATCH_SEAT_COUNT } = require('./match-summary.js');
const { runProgress } = require('./run-progress.js');

const REPO = path.resolve(__dirname, '..');
const MATCH_DIR = path.join(REPO, 'data', 'matches');
const MATCH_METHODS = ['empirical', 'tiered', 'tiered2', 'netEV', 'cdf', 'netEV_derived'];
const AUTOMATICS_NOTE = 'Automatics are not modeled: every hand is solved and scored head-to-head, as in the batch runner.';

// Table files read through fetch or loadCdfArrays, hashed into run metadata
const tableFilesRead = new Set();
// Deck shuffle source for the current seeded round; null means Math.random
let currentRoundRandom = null;

const SCRIPT_FILES = [
    'js/constants/hand-types.js',
    'js/utils.js',
    'js/utilities/analysis.js',
    'js/utilities/card-count.js',
    'js/utilities/empirical-win-probability.js',
    'js/utilities/tiered-win-probability.js',
    'js/utilities/tiered2-win-probability.js',
    'js/utilities/netEV-lookup-table.js',
    'js/utilities/cdf-lookup.js',
    'js/utilities/derived-loss-penalties.js',
    'js/utilities/convert-to-card-model.js',
    'js/hands/evaluate-hand.js',
    'js/hands/hand-utilities.js',
    'js/hands/scoring-utilities.js',
    'js/core/deck.js',
    'js/utils/card-sorter.js',
    'js/scoring/compare-hands.js',
    'js/utilities/card-parser.js',
    'js/utilities/count-valid-hands.js',
    'js/utilities/count-valid-hands-from-cards.js',
    'js/utilities/create-arrangement.js',
    'js/arrange/hand-sorter.js',
    'js/hands/hand-detector.js',
    'js/hands/card-utilities.js',
    'js/hands/arrangement-scorer.js',
    'js/hands/arrangement-validator.js',
    'js/arrange/two-wild-strategy-one.js',
    'js/arrange/two-wild-strategy-two.js',
    'js/core/game-config.js',
    'js/arrange/find-best-setup-no-wild.js',
    'js/arrange/one-wild-candidates.js',
    'js/arrange/find-best-setup-one-wild.js',
    'js/arrange/find-best-setup-two-wild.js',
    'js/arrange/find-best-setup.js',
    'js/stats/play-hand-stats.js'
];

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index + 1 >= process.argv.length) return null;
    return process.argv[index + 1];
}

function installHost() {
    global.window = global;
    global.performance = performance;
    global.localStorage = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    global.document = {
        getElementById() {
            return { innerHTML: '', style: {}, appendChild() {}, addEventListener() {} };
        },
        createElement() {
            return { className: '', style: {}, appendChild() {}, addEventListener() {} };
        },
        addEventListener() {},
        body: { appendChild() {} }
    };
    global.fetch = async function fetchLocal(url) {
        const relative = String(url).replace(/^\//, '');
        const filePath = path.resolve(REPO, relative);
        if (!fs.existsSync(filePath)) {
            return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        }
        const text = fs.readFileSync(filePath, 'utf8');
        tableFilesRead.add(filePath);
        return { ok: true, status: 200, statusText: 'OK', text: async () => text };
    };
}

function loadGameScripts() {
    const source = SCRIPT_FILES.map((relativePath) => {
        const filePath = path.join(REPO, relativePath);
        return fs.readFileSync(filePath, 'utf8') + '\n';
    }).join('\n');
    vm.runInThisContext(source, { filename: 'lookup-rebuild-scripts.js' });
}

// mulberry32 PRNG whose state is the first 4 bytes of sha256("<seed>:<roundIndex>")
function seededRandomForRound(seed, roundIndex) {
    let state = crypto.createHash('sha256').update(`${seed}:${roundIndex}`).digest().readUInt32LE(0);
    return function mulberry32() {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

// Replace the game's global shuffleDeck (js/utils.js, used by createDeck) with the same Fisher-Yates
// drawing from currentRoundRandom when a seeded round is in progress
function installSeededShuffle() {
    const browserShuffleDeck = global.shuffleDeck;
    global.shuffleDeck = function seededShuffleDeck(deck) {
        if (!currentRoundRandom) return browserShuffleDeck(deck);
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(currentRoundRandom() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    };
}

function withSeededRound(seed, roundIndex, dealFunction) {
    currentRoundRandom = seed === null ? null : seededRandomForRound(seed, roundIndex);
    try {
        return dealFunction();
    } finally {
        currentRoundRandom = null;
    }
}

function parseSeed() {
    const seedText = argValue('--seed');
    if (seedText === null) return null;
    const seed = Number(seedText);
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`--seed must be a non-negative integer, got ${seedText}`);
    return seed;
}

function parseStartRound() {
    const startRound = Number(argValue('--start-round') || '0');
    if (!Number.isSafeInteger(startRound) || startRound < 0) throw new Error('--start-round must be a non-negative integer');
    return startRound;
}

function gitText(gitArgs) {
    return execFileSync('git', gitArgs, { cwd: REPO, encoding: 'utf8' }).trim();
}

// Tracked-file changes only, so match outputs in data/matches/ do not mark the tree dirty
function runMetadata(runSettings) {
    const tableFiles = [...tableFilesRead].sort().map((filePath) => ({
        path: path.relative(REPO, filePath).replace(/\\/g, '/'),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    }));
    return {
        ...runSettings,
        gitCommit: gitText(['rev-parse', 'HEAD']),
        gitDirty: gitText(['status', '--porcelain', '--untracked-files=no']) !== '',
        tableFiles,
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
    };
}

function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

function parseHandRank(handRankStr) {
    let cleaned = handRankStr.trim();
    if (cleaned.startsWith('"')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('"')) cleaned = cleaned.slice(0, -1);
    if (!cleaned.startsWith('(') || !cleaned.endsWith(')')) return null;
    const values = cleaned.slice(1, -1).split(',').map((part) => parseInt(part.trim(), 10));
    if (values.some((value) => Number.isNaN(value))) return null;
    return values;
}

function assertEmpiricalAugustFile() {
    const straight = lookupEmpiricalWinProbability('front', {
        hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
        isIncomplete: false
    });
    const flush = lookupEmpiricalWinProbability('front', {
        hand_rank: [5, 14, 14],
        isIncomplete: false
    });
    if (straight == null || flush == null) {
        throw new Error(`August lookup miss. straight=${straight} flush=${flush}`);
    }
    if (!(straight > flush)) {
        throw new Error(`Front straight ${straight} does not beat front flush ${flush}`);
    }
    const loaded = empiricalWinProbability.probabilityMap.size;
    if (loaded !== 21032) {
        throw new Error(`Expected 21032 empirical rows, loaded ${loaded}`);
    }
    console.log(`Empirical check: front straight ${straight} > front flush ${flush} (${loaded} rows)`);
}

function loadCdfArrays() {
    const cdfArraysPath = path.resolve(REPO, argValue('--cdf-arrays') || 'data/cdf_arrays_netev.json');
    cdfLookup.loadFromJson(JSON.parse(fs.readFileSync(cdfArraysPath, 'utf8')));
    tableFilesRead.add(cdfArraysPath);
    const keyCounts = Object.entries(cdfLookup.cdfJson.positions)
        .map(([position, positionArrays]) => `${position} ${positionArrays.keys.length}`).join(', ');
    console.log(`CDF arrays loaded from ${cdfArraysPath} (${cdfLookup.cdfJson.meta.run}, ${cdfLookup.cdfJson.meta.mode}; keys ${keyCounts})`);
}

async function loadMethodTable(method) {
    if (method === 'empirical') {
        const ok = await initializeEmpiricalWinProbability();
        if (!ok) throw new Error('Empirical table failed to load');
        assertEmpiricalAugustFile();
        return;
    }
    if (method === 'tiered') {
        const ok = await initializeTieredWinProbability();
        if (!ok) throw new Error('Tiered table failed to load');
        const straight = lookupTieredWinProbability('front', {
            hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
            isIncomplete: false
        });
        const flush = lookupTieredWinProbability('front', {
            hand_rank: [5, 14, 13],
            isIncomplete: false
        });
        console.log(`Tiered loaded ${tieredWinProbability.probabilityMap.size} rows. Sample straight=${straight} flush=${flush}`);
        if (straight == null || flush == null) {
            throw new Error('Tiered lookup missed a known front straight or flush');
        }
        if (!(straight > flush)) {
            throw new Error(`Front straight ${straight} does not beat front flush ${flush}`);
        }
        return;
    }
    if (method === 'netEV') {
        const ok = await initializeTiered2WinProbability();
        if (!ok) throw new Error('Tiered2 table failed to load');
        window.NETEV_USE_TIERED2_FORMULA = true;
        const straight = lookupTiered2WinProbability('front', {
            hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
            isIncomplete: false
        });
        const flush = lookupTiered2WinProbability('front', {
            hand_rank: [5, 14, 14],
            isIncomplete: false
        });
        console.log(`Tiered2 loaded ${tiered2WinProbability.probabilityMap.size} rows. Sample straight=${straight} flush=${flush}`);
        if (straight == null || flush == null) {
            throw new Error('Tiered2 lookup missed a known front straight or flush');
        }
        const straightScore = ScoringUtilities.netEVFromWinRate('front', 6, straight);
        const flushScore = ScoringUtilities.netEVFromWinRate('front', 5, flush);
        console.log(`Formula sample: straight netEV ${straightScore} flush netEV ${flushScore}`);
        if (!(straightScore > flushScore)) {
            throw new Error('Formula did not rank the sample straight above the sample flush');
        }
        return;
    }
    if (method === 'tiered2') {
        const ok = await initializeTiered2WinProbability();
        if (!ok) throw new Error('Tiered2 table failed to load');
        const straight = lookupTiered2WinProbability('front', { hand_rank: [6, 14, 13, 1, 1, 1, 1, 4], isIncomplete: false });
        const flush = lookupTiered2WinProbability('front', { hand_rank: [5, 14, 14], isIncomplete: false });
        console.log(`Tiered2 loaded ${tiered2WinProbability.probabilityMap.size} rows. Sample straight=${straight} flush=${flush}`);
        if (straight == null || flush == null) throw new Error('Tiered2 lookup missed a known front straight or flush');
        return;
    }
    if (method === 'cdf') {
        loadCdfArrays();
        const pairEV = cdfLookup.lookup('front', 0, [2, 14, 13]).netEV;
        const tripsEV = cdfLookup.lookup('front', 0, [4, 14]).netEV;
        console.log(`CDF sample: front AA-K netEV ${pairEV} front trip aces netEV ${tripsEV}`);
        if (!(tripsEV > pairEV)) {
            throw new Error('CDF did not rank front trip aces above a front pair of aces');
        }
        return;
    }
    if (method === 'netEV_derived') {
        const ok = await initializeTiered2WinProbability();
        if (!ok) throw new Error('Tiered2 table failed to load');
        const penaltyPath = path.resolve(REPO, 'data/derived_loss_penalties.json');
        derivedLossPenalties.loadFromJson(JSON.parse(fs.readFileSync(penaltyPath, 'utf8')));
        tableFilesRead.add(penaltyPath);
        const pairEV = ScoringUtilities.netEVDerivedFromTiered2Rate({ hand_rank: [2, 14, 13], isIncomplete: false }, 'front');
        const tripsEV = ScoringUtilities.netEVDerivedFromTiered2Rate({ hand_rank: [4, 14], isIncomplete: false }, 'front');
        console.log(`netEV_derived penalties loaded from ${penaltyPath}. Sample: front AA-K ${pairEV} front trip aces ${tripsEV}`);
        if (!(tripsEV > pairEV)) {
            throw new Error('netEV_derived did not rank front trip aces above a front pair of aces');
        }
        return;
    }
    throw new Error(`Unknown method ${method}`);
}

function writeChunk(stream, text) {
    if (stream.write(text)) return Promise.resolve();
    return new Promise((resolve) => stream.once('drain', resolve));
}

async function dealRounds(method, rounds, outPath, seed, startRound) {
    if (gameConfig.config.winProbabilityMethod !== method) {
        throw new Error(`winProbabilityMethod is "${gameConfig.config.winProbabilityMethod}", expected "${method}"`);
    }
    if (!MATCH_METHODS.includes(method)) {
        throw new Error(`Refusing method "${method}"`);
    }
    gameConfig.config.wildCardCount = 2;
    window.NETEV_USE_TIERED2_FORMULA = method === 'netEV';

    await loadMethodTable(method);
    const metadataPath = outPath.replace(/\.json$/i, '') + '.meta.json';
    const batchMetadata = runMetadata({ method, seed, rounds, startRound });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const stream = fs.createWriteStream(outPath);
    await writeChunk(stream, '[\n');

    const stats = new PlayHandStats();
    const started = Date.now();
    const batchProgress = runProgress(`Batch ${method}`, rounds, outPath.replace(/\.json$/i, '') + '_progress.txt');
    let written = 0;
    let failures = 0;

    while (written < rounds) {
        const result = withSeededRound(seed, startRound + written, () => stats.playHandStats(6, 2));
        if (!result || result.error || !result.players || !result.scoringMatrix) {
            failures += 1;
            console.error(`Round failed (${failures}): ${result && result.error}`);
            if (seed !== null) throw new Error(`Seeded round ${startRound + written} failed; retrying would replay the same deal`);
            if (failures > 50) throw new Error('Too many failed rounds');
            continue;
        }
        if (written > 0) await writeChunk(stream, ',\n');
        await writeChunk(stream, JSON.stringify(result));
        written += 1;
        batchProgress.report(written, () => `failures ${failures}`);
    }

    await writeChunk(stream, '\n]\n');
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    console.log(`Wrote ${written} rounds to ${outPath}`);
    const wallSeconds = (Date.now() - started) / 1000;
    fs.writeFileSync(metadataPath, JSON.stringify({ ...batchMetadata, failures, wallSeconds }, null, 2) + '\n');
    console.log(`Wrote run metadata to ${metadataPath}`);
}

// ---------------------------------------------------------------------------
// Paired match runner (--match A,B)
// ---------------------------------------------------------------------------

function dealMatchHands(seed, roundIndex) {
    const deckManager = new DeckManager();
    return withSeededRound(seed, roundIndex, () => {
        deckManager.createNewDeck();
        return Array.from({ length: MATCH_SEAT_COUNT }, () => deckManager.dealCards(17));
    });
}

// Solve one hand with one method: the solver reads gameConfig.config.winProbabilityMethod,
// so set it (and the batch netEV formula flag) for this solve only, on a copy of the cards
function solveWithMethod(dealtCards, method) {
    if (window.WIN_PROB_OVERRIDE !== undefined) {
        throw new Error(`window.WIN_PROB_OVERRIDE is set (${window.WIN_PROB_OVERRIDE}); it would override the match method`);
    }
    const savedMethod = gameConfig.config.winProbabilityMethod;
    const savedFormulaFlag = window.NETEV_USE_TIERED2_FORMULA;
    gameConfig.config.winProbabilityMethod = method;
    window.NETEV_USE_TIERED2_FORMULA = method === 'netEV';
    try {
        const cardsCopy = dealtCards.map((card) => ({ ...card }));
        const solved = findBestSetup(cardsCopy, { collectTopArrangements: false });
        if (!solved || !solved.success || !solved.arrangement) {
            throw new Error(`${method} found no arrangement: ${solved && solved.error}`);
        }
        return solved;
    } finally {
        gameConfig.config.winProbabilityMethod = savedMethod;
        window.NETEV_USE_TIERED2_FORMULA = savedFormulaFlag;
    }
}

// Cards per position as rank+suit (wild cards as played, marked *), sorted, back/middle/front
function arrangementSignature(arrangement) {
    return ['back', 'middle', 'front'].map((position) => arrangement[position].cards
        .map((card) => `${card.rank}${card.suit}${card.isWild || card.wasWild ? '*' : ''}`)
        .sort()
        .join(' ')).join(' / ');
}

// Round scores of the six seats, scored like PlayHandStats.playHandStats steps 3-4
function scoreTable(handStats, seatSolutions) {
    const seatPlayers = seatSolutions.map((solution, seatIndex) => ({
        name: `Player${seatIndex + 1}`,
        arrangement: solution,
        roundScore: 0
    }));
    for (const matchup of handStats.calculateHeadToHeadScoring(seatPlayers)) {
        seatPlayers.find((seatPlayer) => seatPlayer.name === matchup.player1).roundScore += matchup.player1Score;
        seatPlayers.find((seatPlayer) => seatPlayer.name === matchup.player2).roundScore += matchup.player2Score;
    }
    return seatPlayers.map((seatPlayer) => seatPlayer.roundScore);
}

// One deal: 12 solves (each hand by A and by B), two tables. Orientation 1: seats 1-3 A, seats 4-6 B;
// orientation 2 swaps the methods. Each hand is played once by A and once by B.
function playMatchDeal(methodA, methodB, seed, roundIndex, handStats) {
    const dealtHands = dealMatchHands(seed, roundIndex);
    const solvesA = dealtHands.map((dealtCards) => solveWithMethod(dealtCards, methodA));
    const solvesB = dealtHands.map((dealtCards) => solveWithMethod(dealtCards, methodB));
    const firstHalf = (seatIndex) => seatIndex < MATCH_SEAT_COUNT / 2;
    const orientation1Scores = scoreTable(handStats, dealtHands.map((_, seatIndex) => firstHalf(seatIndex) ? solvesA[seatIndex] : solvesB[seatIndex]));
    const orientation2Scores = scoreTable(handStats, dealtHands.map((_, seatIndex) => firstHalf(seatIndex) ? solvesB[seatIndex] : solvesA[seatIndex]));
    const tableSum = (seatScores) => seatScores.reduce((total, seatScore) => total + seatScore, 0);
    return {
        round: roundIndex,
        tableSums: [tableSum(orientation1Scores), tableSum(orientation2Scores)],
        hands: dealtHands.map((dealtCards, handIndex) => {
            const signatureA = arrangementSignature(solvesA[handIndex].arrangement);
            const signatureB = arrangementSignature(solvesB[handIndex].arrangement);
            return {
                round: roundIndex,
                handIndex,
                w: dealtCards.filter((card) => card.isWild).length,
                signatureA,
                signatureB,
                sameArrangement: signatureA === signatureB,
                scoreA: firstHalf(handIndex) ? orientation1Scores[handIndex] : orientation2Scores[handIndex],
                orientationA: firstHalf(handIndex) ? 'o1' : 'o2',
                scoreB: firstHalf(handIndex) ? orientation2Scores[handIndex] : orientation1Scores[handIndex],
                orientationB: firstHalf(handIndex) ? 'o2' : 'o1'
            };
        })
    };
}

// Play rounds [startRound, startRound + rounds) in this process; each deal goes to onDeal.
// Yields to the event loop between deals so worker progress messages are sent as deals complete.
async function playMatchRange(methodA, methodB, seed, startRound, rounds, onDeal) {
    const handStats = new PlayHandStats();
    for (let offset = 0; offset < rounds; offset++) {
        onDeal(playMatchDeal(methodA, methodB, seed, startRound + offset, handStats));
        await new Promise((resolve) => setImmediate(resolve));
    }
}

// Running mean X (with standard error) and different-arrangement share over the deals finished so far, in completion order
function runningMatchTally() {
    let dealsDone = 0;
    let dealAverageSum = 0;
    let dealAverageSquareSum = 0;
    let handsDone = 0;
    let differentHands = 0;
    return {
        add(matchDeal) {
            const dealAverage = matchDeal.hands.reduce((total, handRow) => total + handRow.scoreA, 0) / matchDeal.hands.length;
            dealsDone += 1;
            dealAverageSum += dealAverage;
            dealAverageSquareSum += dealAverage * dealAverage;
            handsDone += matchDeal.hands.length;
            differentHands += matchDeal.hands.filter((handRow) => !handRow.sameArrangement).length;
        },
        get dealsDone() { return dealsDone; },
        text() {
            const meanX = dealAverageSum / dealsDone;
            const variance = dealsDone > 1 ? Math.max(0, dealAverageSquareSum - dealsDone * meanX * meanX) / (dealsDone - 1) : null;
            const standardErrorText = variance === null ? 'n/a' : Math.sqrt(variance / dealsDone).toFixed(4);
            return `X mean ${meanX.toFixed(4)} SE ${standardErrorText}; different arrangements ${(100 * differentHands / handsDone).toFixed(1)}%`;
        }
    };
}

// Child process for --workers: plays its round range, writes one JSON line per deal,
// and sends each finished deal to the parent for its combined progress line
async function runMatchWorker(methodA, methodB, seed, startRound, rounds, workerOutPath) {
    const lines = [];
    const pendingSends = [];
    await playMatchRange(methodA, methodB, seed, startRound, rounds, (matchDeal) => {
        lines.push(JSON.stringify(matchDeal));
        if (process.send) pendingSends.push(new Promise((resolve) => process.send(matchDeal, resolve)));
    });
    fs.writeFileSync(workerOutPath, lines.join('\n') + '\n');
    await Promise.all(pendingSends);
    if (process.disconnect) process.disconnect();
}

function spawnMatchWorker(workerArgs, workerOutPath, onWorkerDeal) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, ...workerArgs, '--worker-out', workerOutPath],
            { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        child.on('message', onWorkerDeal);
        child.on('error', reject);
        child.on('exit', (exitCode) => exitCode === 0 ? resolve() : reject(new Error(`Worker ${workerArgs.join(' ')} exited ${exitCode}`)));
    });
}

// Split [startRound, startRound + rounds) into contiguous ranges, one per worker
function workerRanges(startRound, rounds, workers) {
    const ranges = [];
    const baseSize = Math.floor(rounds / workers);
    let nextRound = startRound;
    for (let workerIndex = 0; workerIndex < workers; workerIndex++) {
        const rangeSize = baseSize + (workerIndex < rounds % workers ? 1 : 0);
        if (rangeSize > 0) ranges.push({ startRound: nextRound, rounds: rangeSize });
        nextRound += rangeSize;
    }
    return ranges;
}

async function runMatch() {
    const methodPair = argValue('--match').split(',').map((method) => method.trim());
    const [methodA, methodB] = methodPair;
    if (methodPair.length !== 2 || !MATCH_METHODS.includes(methodA) || !MATCH_METHODS.includes(methodB)) {
        throw new Error(`--match needs two of ${MATCH_METHODS.join('|')}, got ${argValue('--match')}`);
    }
    const seed = parseSeed();
    if (seed === null) throw new Error('--match needs --seed');
    const rounds = Number(argValue('--rounds'));
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--match needs --rounds N');
    const startRound = parseStartRound();
    const workers = Number(argValue('--workers') || '1');
    if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('--workers must be a positive integer');

    gameConfig.config.wildCardCount = 2;
    for (const method of new Set(methodPair)) await loadMethodTable(method);

    const workerOutPath = argValue('--worker-out');
    if (workerOutPath) {
        await runMatchWorker(methodA, methodB, seed, startRound, rounds, workerOutPath);
        return;
    }
    const fileStem = `match_${methodA}_vs_${methodB}_seed${seed}_${rounds}${startRound > 0 ? `_start${startRound}` : ''}`;
    const matchProgress = runProgress(`Match ${methodA} vs ${methodB}`, rounds, path.join(MATCH_DIR, `${fileStem}_progress.txt`));
    const matchTally = runningMatchTally();
    const recordFinishedDeal = (matchDeal) => {
        matchTally.add(matchDeal);
        matchProgress.report(matchTally.dealsDone, () => matchTally.text());
    };

    const matchMetadata = runMetadata({
        methodA, methodB, seed, rounds, startRound, endRound: startRound + rounds - 1, workers,
        scoring: 'js/stats/play-hand-stats.js calculateHeadToHeadScoring, roundScore units; per point = /5',
        notes: AUTOMATICS_NOTE
    });
    const started = Date.now();
    const matchDeals = [];
    if (workers === 1) {
        await playMatchRange(methodA, methodB, seed, startRound, rounds, (matchDeal) => {
            matchDeals.push(matchDeal);
            recordFinishedDeal(matchDeal);
        });
    } else {
        const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-match-'));
        const ranges = workerRanges(startRound, rounds, workers);
        const rangeOutPaths = ranges.map((range) => path.join(scratchDir, `rounds_${range.startRound}.jsonl`));
        const passThroughArgs = ['--cdf-arrays'].flatMap((flag) => argValue(flag) ? [flag, argValue(flag)] : []);
        await Promise.all(ranges.map((range, rangeIndex) => spawnMatchWorker(
            ['--match', `${methodA},${methodB}`, '--seed', String(seed), '--start-round', String(range.startRound),
                '--rounds', String(range.rounds), ...passThroughArgs], rangeOutPaths[rangeIndex], recordFinishedDeal)));
        for (const rangeOutPath of rangeOutPaths) {
            fs.readFileSync(rangeOutPath, 'utf8').trim().split('\n').forEach((line) => matchDeals.push(JSON.parse(line)));
        }
        fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    matchDeals.sort((dealA, dealB) => dealA.round - dealB.round);
    const wallSeconds = (Date.now() - started) / 1000;

    const handRows = matchDeals.flatMap((matchDeal) => matchDeal.hands);
    const summary = {
        ...matchSummary(handRows),
        tablesChecked: matchDeals.length * 2,
        tablesNotZeroSum: matchDeals.reduce((count, matchDeal) => count + matchDeal.tableSums.filter((tableSum) => tableSum !== 0).length, 0)
    };
    fs.mkdirSync(MATCH_DIR, { recursive: true });
    const csvPath = path.join(MATCH_DIR, `${fileStem}.csv`);
    const jsonPath = path.join(MATCH_DIR, `${fileStem}.json`);
    fs.writeFileSync(csvPath, matchCsvText(handRows));
    fs.writeFileSync(jsonPath, JSON.stringify({
        metadata: { ...matchMetadata, wallSeconds, secondsPerRound: wallSeconds / rounds },
        summary
    }, null, 2) + '\n');

    console.log(`\n${methodA} (A) vs ${methodB} (B), seed ${seed}, rounds ${startRound}-${startRound + rounds - 1}, workers ${workers}`);
    console.log(`Wall ${wallSeconds.toFixed(1)}s, ${(wallSeconds / rounds).toFixed(2)}s/round`);
    console.log(formatMatchSummary(summary));
    console.log(`Tables not zero-sum: ${summary.tablesNotZeroSum}/${summary.tablesChecked}`);
    console.log(AUTOMATICS_NOTE);
    console.log(`Wrote ${jsonPath}\nWrote ${csvPath}`);
}

async function writeNetEV(winRatePath, outPath) {
    window.NETEV_USE_TIERED2_FORMULA = true;
    const text = fs.readFileSync(winRatePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.trim().split(/\r?\n/);
    const header = parseCsvLine(lines[0]).map((field) => field.trim());
    const positionIndex = header.indexOf('position');
    const tupleIndex = header.indexOf('hand_rank_tuple');
    const winsIndex = header.indexOf('wins');
    const totalIndex = header.indexOf('total_matchups');
    const rateIndex = header.indexOf('win_rate');
    if (positionIndex < 0 || tupleIndex < 0 || winsIndex < 0 || totalIndex < 0 || rateIndex < 0) {
        throw new Error(`Unexpected win-rate header: ${header.join(',')}`);
    }

    const output = ['position,hand_rank_tuple,wins,total_matchups,netev'];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const fields = parseCsvLine(lines[i]);
        const position = fields[positionIndex].trim();
        const handRank = parseHandRank(fields[tupleIndex]);
        const wins = fields[winsIndex].trim();
        const total = fields[totalIndex].trim();
        const winRate = parseFloat(fields[rateIndex]);
        if (!handRank) throw new Error(`Bad tuple on line ${i + 1}: ${fields[tupleIndex]}`);
        const netev = ScoringUtilities.netEVFromWinRate(position, handRank[0], winRate);
        const tupleText = fields[tupleIndex].trim();
        output.push(`${position},"${tupleText.replace(/"/g, '')}",${wins},${total},${netev.toFixed(6)}`);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output.join('\n') + '\n');
    console.log(`Wrote ${output.length - 1} netEV rows to ${outPath}`);
}

async function main() {
    installHost();
    loadGameScripts();

    if (process.argv.includes('--test-all')) {
        for (const relativePath of [
            'js/tests/test-cases.js',
            'js/tests/create-from-cards-test-case.js',
            'js/tests/test-all-methods.js'
        ]) {
            vm.runInThisContext(fs.readFileSync(path.join(REPO, relativePath), 'utf8') + '\n', { filename: relativePath });
        }
        if (!await initializeEmpiricalWinProbability()) throw new Error('Empirical table failed to load');
        if (!await initializeTieredWinProbability()) throw new Error('Tiered table failed to load');
        if (!await initializeTiered2WinProbability()) throw new Error('Tiered2 table failed to load');
        if (!await initializeNetEVLookup()) throw new Error('NetEV table failed to load');
        loadCdfArrays();
        console.log(`Loaded empirical ${empiricalWinProbability.probabilityMap.size}, tiered ${tieredWinProbability.probabilityMap.size}, tiered2 ${tiered2WinProbability.probabilityMap.size}, netEV ${netEVLookup.evMap.size}`);
        testAllMethods();
        return;
    }

    const writeIndex = process.argv.indexOf('--write-netev');
    if (writeIndex !== -1) {
        const winRatePath = process.argv[writeIndex + 1];
        const outPath = process.argv[writeIndex + 2];
        if (!winRatePath || !outPath) throw new Error('--write-netev needs a win-rate csv and an output csv');
        await writeNetEV(path.resolve(winRatePath), path.resolve(outPath));
        return;
    }

    const seed = parseSeed();
    if (seed !== null) installSeededShuffle();

    if (argValue('--match')) {
        await runMatch();
        return;
    }

    const method = argValue('--method');
    const rounds = parseInt(argValue('--rounds') || '10000', 10);
    const outPath = argValue('--out');
    if (!method || !outPath || !Number.isFinite(rounds) || rounds < 1) {
        throw new Error('Need --method empirical|tiered|tiered2|netEV|cdf --rounds N --out file.json');
    }
    gameConfig.config.winProbabilityMethod = method;
    if (gameConfig.config.winProbabilityMethod !== method) {
        throw new Error('Failed to set winProbabilityMethod exactly');
    }
    await dealRounds(method, rounds, path.resolve(outPath), seed, parseStartRound());
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
