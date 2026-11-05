// Kitty rollout value of a 13-card hand: the value of playing, estimated by sampling 4-card kitties from the cards the
// player cannot see, solving each 17-card hand with the cdf method, and averaging the post-kicker expected points.
// Usage:
//   node scripts/kitty-rollout-value.js --seed S --round R --seat I [--cdf-arrays <json>] [--sampling-seed T]
//        [--k-nowild 100] [--k-onewild 10] [--k-twowild 1] [--out data/kitty_rollout_seed<S>.csv]
//   Batch: --rounds N (rounds R..R+N-1), --seat all (every seat), --max-per-wild M (at most M hands per hero wild count),
//   --hero-wilds W (only hands with W wilds in the 13; others skipped silently),
//   --one-trip (only no-wild hands with exactly one rank held 3 times, no rank held 4+ and no 5-card straight flush).
// Hand: seat I's first 13 cards of round R's seeded deal (same PRNG and dealing as scripts/deal-lookup-rounds.js --match).
//   Hands with 2 wilds in the 13 are skipped (always play).
// Unseen pool: the 106-card deck minus the hero's 13 cards (93 cards: other seats, the 4 undealt cards, unseen wilds).
// Strata: how many wilds the kitty brings (0-2 for a no-wild hand, 0-1 for a one-wild hand), each with its exact
//   hypergeometric probability from the 93 unseen cards. --k-nowild/--k-onewild/--k-twowild set the kitties sampled per
//   stratum; within a stratum the kitty's wilds and naturals are drawn without replacement, by card id, from a PRNG keyed
//   by (sampling seed, seed, round, seat, stratum), so reruns are identical. A stratum may get 0 samples only if its
//   probability is under 0.5%; its probability is reported as omitted_mass and the mean is over the sampled strata
//   (stratum weights renormalized to sum to 1).
// Score per kitty: findBestSetup(17 cards).arrangement.score (post-kicker cdf expected points) with --cdf-arrays
//   (default data/cdf_arrays_netev.json, the gen0 table).
// Field: the table's meta.field (which hands its opponents are; export_cdf_json.py --field). Tables exported before the
//   tag existed (gen0-gen3) have none and are all-play (every seat played every hand), so a missing tag reads all-play.
//   The table and field are printed at start and written to every CSV row.
// Output, one CSV row per hand: stratum probabilities, samples, means; the stratified mean and its standard error
//   (strata with one sample add no variance term and are listed in se_missing_strata); standard deviation and 10th/90th
//   percentiles of the score across kitties, each kitty weighted by its stratum probability / samples; solve times.
//   The CSV is not added to git.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

const REPO = path.resolve(__dirname, '..');
const SEAT_COUNT = 6;
const HAND_CARDS = 13;
const KITTY_CARDS = 4;
const OMIT_PROBABILITY_LIMIT = 0.005;
const STRATUM_FLAGS = ['--k-nowild', '--k-onewild', '--k-twowild'];
const STRATUM_DEFAULTS = [100, 10, 1];
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
// Field of tables exported before meta.field existed (gen0-gen3): every seat played every hand
const UNTAGGED_FIELD = 'all-play';
const SUIT_LETTERS = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

function argValue(flag) {
    const flagIndex = process.argv.indexOf(flag);
    return flagIndex === -1 || flagIndex + 1 >= process.argv.length ? null : process.argv[flagIndex + 1];
}

function integerArg(flag, defaultValue, minimum = 0) {
    const text = argValue(flag);
    const value = text === null ? defaultValue : Number(text);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${flag} must be an integer >= ${minimum}, got ${text}`);
    return value;
}

// Host stubs and game code as in scripts/deal-lookup-rounds.js installHost / loadGameScripts
function loadGame(cdfArraysPath) {
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
    vm.runInThisContext(gameSource, { filename: 'kitty-rollout-value-game.js' });
    const cdfArraysBytes = fs.readFileSync(cdfArraysPath);
    cdfLookup.loadFromJson(JSON.parse(cdfArraysBytes.toString('utf8')));
    gameConfig.config.wildCardCount = 2;
    gameConfig.config.winProbabilityMethod = 'cdf';
    window.NETEV_USE_TIERED2_FORMULA = false;
    if (window.WIN_PROB_OVERRIDE !== undefined) throw new Error('window.WIN_PROB_OVERRIDE is set');
    const fieldTag = cdfLookup.cdfJson.meta.field;
    return {
        run: cdfLookup.cdfJson.meta.run,
        field: fieldTag || UNTAGGED_FIELD,
        fieldSource: fieldTag ? 'meta.field' : 'no meta.field, untagged tables are all-play',
        sha256: crypto.createHash('sha256').update(cdfArraysBytes).digest('hex')
    };
}

// mulberry32 whose state is the first 4 bytes of sha256(keyText), as scripts/deal-lookup-rounds.js seededRandomForRound
function seededRandom(keyText) {
    let state = crypto.createHash('sha256').update(keyText).digest().readUInt32LE(0);
    return function mulberry32() {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

// Round R's six 17-card hands and the full deck, dealt as scripts/deal-lookup-rounds.js dealMatchHands
function dealRound(seed, roundIndex) {
    const browserShuffleDeck = global.shuffleDeck;
    const roundRandom = seededRandom(`${seed}:${roundIndex}`);
    global.shuffleDeck = function seededShuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(roundRandom() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    };
    try {
        const deckManager = new DeckManager();
        const fullDeck = [...deckManager.createNewDeck()];
        return { seatHands: Array.from({ length: SEAT_COUNT }, () => deckManager.dealCards(17)), fullDeck };
    } finally {
        global.shuffleDeck = browserShuffleDeck;
    }
}

function choose(n, k) {
    if (k < 0 || k > n) return 0;
    let value = 1;
    for (let i = 1; i <= k; i++) value = value * (n - k + i) / i;
    return value;
}

// count distinct items from pool, by partial Fisher-Yates on a copy
function drawWithoutReplacement(pool, count, random) {
    const remaining = [...pool];
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(random() * (remaining.length - i));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    return remaining.slice(0, count);
}

function cardText(card) {
    return card.isWild ? 'W' : `${SUIT_LETTERS[card.suit] || card.suit}${card.rank}`;
}

function solveScore(seventeenCards) {
    const savedLog = console.log;
    console.log = () => {};
    const started = performance.now();
    let solved;
    try {
        solved = findBestSetup(seventeenCards.map((card) => ({ ...card })), { collectTopArrangements: false });
    } finally {
        console.log = savedLog;
    }
    if (!solved || !solved.success || !solved.arrangement) throw new Error(`findBestSetup found no arrangement: ${solved && solved.error}`);
    return { score: solved.arrangement.score, solveMs: performance.now() - started };
}

// Weighted quantile: first score whose cumulative weight reaches q
const RANK_VALUES = { J: 11, Q: 12, K: 13, A: 14 };

// No wilds, exactly one rank held 3 times, no rank held 4+, no 5-card straight flush (ace high or low)
function isOneTripHand(heroCards) {
    if (heroCards.some((card) => card.isWild)) return false;
    const rankCounts = new Map();
    heroCards.forEach((card) => rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1));
    const counts = [...rankCounts.values()];
    if (counts.some((count) => count >= 4) || counts.filter((count) => count === 3).length !== 1) return false;
    const suitRanks = new Map();
    for (const card of heroCards) {
        const rankValue = RANK_VALUES[card.rank] || Number(card.rank);
        if (!suitRanks.has(card.suit)) suitRanks.set(card.suit, new Set());
        suitRanks.get(card.suit).add(rankValue);
        if (rankValue === 14) suitRanks.get(card.suit).add(1);
    }
    for (const ranks of suitRanks.values()) {
        for (let low = 1; low <= 10; low++) {
            if ([0, 1, 2, 3, 4].every((step) => ranks.has(low + step))) return false;
        }
    }
    return true;
}

function weightedQuantile(weightedScores, quantile) {
    const sorted = [...weightedScores].sort((a, b) => a.score - b.score);
    let cumulative = 0;
    for (const entry of sorted) {
        cumulative += entry.weight;
        if (cumulative >= quantile - 1e-12) return entry.score;
    }
    return sorted[sorted.length - 1].score;
}

function rolloutHand(seed, roundIndex, seat, heroCards, fullDeck, samplingSeed, samplesPerStratum) {
    const heroIds = new Set(heroCards.map((card) => card.id));
    const unseen = fullDeck.filter((card) => !heroIds.has(card.id));
    if (unseen.length !== fullDeck.length - HAND_CARDS) throw new Error(`Round ${roundIndex} seat ${seat}: hero card ids not unique in the deck`);
    const unseenWilds = unseen.filter((card) => card.isWild);
    const unseenNaturals = unseen.filter((card) => !card.isWild);
    const heroWilds = HAND_CARDS - heroCards.filter((card) => !card.isWild).length;

    const strata = [];
    for (let kittyWilds = 0; kittyWilds <= Math.min(KITTY_CARDS, unseenWilds.length); kittyWilds++) {
        const probability = choose(unseenWilds.length, kittyWilds) * choose(unseenNaturals.length, KITTY_CARDS - kittyWilds) /
            choose(unseen.length, KITTY_CARDS);
        const samples = samplesPerStratum[kittyWilds];
        if (samples === 0 && probability >= OMIT_PROBABILITY_LIMIT) {
            throw new Error(`Stratum kitty wilds ${kittyWilds} has probability ${probability.toFixed(4)} >= ${OMIT_PROBABILITY_LIMIT}; ` +
                `${STRATUM_FLAGS[kittyWilds]} 0 is only allowed below that`);
        }
        const random = seededRandom(`kitty:${samplingSeed}:${seed}:${roundIndex}:${seat}:${kittyWilds}`);
        const results = [];
        for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
            const kitty = [...drawWithoutReplacement(unseenWilds, kittyWilds, random),
                ...drawWithoutReplacement(unseenNaturals, KITTY_CARDS - kittyWilds, random)];
            results.push(solveScore([...heroCards, ...kitty]));
        }
        strata.push({ kittyWilds, probability, results });
    }

    const sampledStrata = strata.filter((stratum) => stratum.results.length > 0);
    const omittedMass = strata.filter((stratum) => stratum.results.length === 0).reduce((total, stratum) => total + stratum.probability, 0);
    const sampledMass = 1 - omittedMass;
    let mean = 0;
    let variance = 0;
    const seMissingStrata = [];
    const weightedScores = [];
    for (const stratum of sampledStrata) {
        const weight = stratum.probability / sampledMass;
        const scores = stratum.results.map((result) => result.score);
        const stratumMean = scores.reduce((total, score) => total + score, 0) / scores.length;
        stratum.mean = stratumMean;
        mean += weight * stratumMean;
        if (scores.length > 1) {
            const stratumVariance = scores.reduce((total, score) => total + (score - stratumMean) ** 2, 0) / (scores.length - 1);
            variance += weight * weight * stratumVariance / scores.length;
        } else {
            seMissingStrata.push(stratum.kittyWilds);
        }
        scores.forEach((score) => weightedScores.push({ score, weight: weight / scores.length }));
    }
    const sd = Math.sqrt(weightedScores.reduce((total, entry) => total + entry.weight * (entry.score - mean) ** 2, 0));
    const allSolveMs = strata.flatMap((stratum) => stratum.results.map((result) => result.solveMs));

    const row = {
        seed, round: roundIndex, seat, hero_wilds: heroWilds, hand: heroCards.map(cardText).join(' '), sampling_seed: samplingSeed,
        mean, se: Math.sqrt(variance), sd, p10: weightedQuantile(weightedScores, 0.1), p90: weightedQuantile(weightedScores, 0.9),
        omitted_mass: omittedMass, se_missing_strata: seMissingStrata.join('|'),
        solves: allSolveMs.length, solve_seconds: allSolveMs.reduce((total, ms) => total + ms, 0) / 1000
    };
    for (let kittyWilds = 0; kittyWilds <= 2; kittyWilds++) {
        const stratum = strata.find((entry) => entry.kittyWilds === kittyWilds);
        const solveMs = stratum ? stratum.results.map((result) => result.solveMs) : [];
        row[`p_k${kittyWilds}`] = stratum ? stratum.probability : '';
        row[`n_k${kittyWilds}`] = stratum ? stratum.results.length : '';
        row[`mean_k${kittyWilds}`] = stratum && stratum.results.length ? stratum.mean : '';
        row[`solve_ms_k${kittyWilds}`] = solveMs.length ? solveMs.reduce((total, ms) => total + ms, 0) / solveMs.length : '';
    }
    return row;
}

const CSV_COLUMNS = ['seed', 'round', 'seat', 'hero_wilds', 'hand', 'sampling_seed', 'cdf_arrays_run', 'cdf_arrays_sha256', 'field',
    'mean', 'se', 'sd', 'p10', 'p90', 'omitted_mass', 'se_missing_strata',
    'p_k0', 'p_k1', 'p_k2', 'n_k0', 'n_k1', 'n_k2', 'mean_k0', 'mean_k1', 'mean_k2',
    'solves', 'solve_seconds', 'solve_ms_k0', 'solve_ms_k1', 'solve_ms_k2', 'wall_seconds'];

function csvField(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(6);
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
    const seed = integerArg('--seed', null);
    const startRound = integerArg('--round', null);
    const rounds = integerArg('--rounds', 1, 1);
    const seatText = argValue('--seat');
    if (seatText === null) throw new Error('Need --seat I (0-5) or --seat all');
    const seats = seatText === 'all' ? [...Array(SEAT_COUNT).keys()] : [integerArg('--seat', null)];
    if (seats.some((seat) => seat >= SEAT_COUNT)) throw new Error(`--seat must be 0-${SEAT_COUNT - 1} or all`);
    const maxPerWild = argValue('--max-per-wild') === null ? Infinity : integerArg('--max-per-wild', null);
    const heroWildsFilter = argValue('--hero-wilds') === null ? null : integerArg('--hero-wilds', null);
    const oneTripOnly = process.argv.includes('--one-trip');
    const samplingSeed = integerArg('--sampling-seed', 1);
    const samplesPerStratum = STRATUM_FLAGS.map((flag, index) => integerArg(flag, STRATUM_DEFAULTS[index]));
    const cdfArraysPath = path.resolve(REPO, argValue('--cdf-arrays') || 'data/cdf_arrays_netev.json');
    const outPath = path.resolve(REPO, argValue('--out') || `data/kitty_rollout_seed${seed}.csv`);

    const cdfArrays = loadGame(cdfArraysPath);
    console.log(`Table ${cdfArraysPath} (run ${cdfArrays.run}, sha256 ${cdfArrays.sha256.slice(0, 16)}); ` +
        `field ${cdfArrays.field} (${cdfArrays.fieldSource})`);
    console.log(`Samples per kitty-wild stratum ${samplesPerStratum.join('/')}, sampling seed ${samplingSeed}`);

    const handsPerWild = [0, 0];
    const csvLines = [CSV_COLUMNS.join(',')];
    for (let roundIndex = startRound; roundIndex < startRound + rounds; roundIndex++) {
        const { seatHands, fullDeck } = dealRound(seed, roundIndex);
        for (const seat of seats) {
            const heroCards = seatHands[seat].slice(0, HAND_CARDS);
            const heroWilds = heroCards.filter((card) => card.isWild).length;
            if (heroWilds >= 2) {
                console.log(`round ${roundIndex} seat ${seat}: ${heroWilds} wilds, skipped (always play)`);
                continue;
            }
            if (heroWildsFilter !== null && heroWilds !== heroWildsFilter) continue;
            if (oneTripOnly && !isOneTripHand(heroCards)) continue;
            if (handsPerWild[heroWilds] >= maxPerWild) continue;
            handsPerWild[heroWilds] += 1;
            const started = performance.now();
            const row = rolloutHand(seed, roundIndex, seat, heroCards, fullDeck, samplingSeed, samplesPerStratum);
            row.cdf_arrays_run = cdfArrays.run;
            row.cdf_arrays_sha256 = cdfArrays.sha256;
            row.field = cdfArrays.field;
            row.wall_seconds = (performance.now() - started) / 1000;
            csvLines.push(CSV_COLUMNS.map((column) => csvField(row[column])).join(','));
            console.log(`round ${roundIndex} seat ${seat} w=${heroWilds}: mean ${row.mean.toFixed(3)} se ${row.se.toFixed(3)} ` +
                `sd ${row.sd.toFixed(3)} p10 ${row.p10.toFixed(3)} p90 ${row.p90.toFixed(3)} omitted ${row.omitted_mass.toFixed(4)}; ` +
                `${row.solves} solves, ${row.wall_seconds.toFixed(1)}s`);
        }
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, csvLines.join('\n') + '\n');
    console.log(`Wrote ${csvLines.length - 1} hands to ${outPath}`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
