// Audit: are the solver's arrangements legal under the game's own rules?
// Usage: node scripts/audit-arrangement-validity.js [match csv ...] [--prune-rounds N] [--skip-test-cases]
//   default CSVs: data/matches/match_cdf_vs_tiered2_seed1_1000.csv and ..._seed1_1000_start1000.csv
//
// Validity is what PyramidPoker.validateHands (js/core/game.js) requires before Submit is enabled, checked with the
// game's own functions: hand sizes (back 5-8, middle 5-7, front 3 or 5), PyramidPoker.prototype.validateLargeHand
// for 6+ card hands, ArrangementValidator.validateHandOrder (back >= middle >= front by compareTuples on
// evaluateHand / evaluateThreeCardHand, ties allowed) and ArrangementValidator.validateFrontHandConstraint
// (a 5-card front must be a straight or better). ArrangementValidator.validateFinalArrangement itself is not used:
// it calls this.validateLargeHands, which is not defined, so it always fails. Also checked: every non-wild card comes
// from the dealt hand, used once, and no more wilds are played than were dealt.
//
// Sections:
// 1. Both methods' arrangements in each match CSV, rebuilt as scripts/summarize-match-differences.js does.
// 2. The 30 stored test cases (1-10, 1001-1010, 2001-2010) solved by every method, as js/tests/test-all-methods.js does.
// 3. Pruning check for cdf: the same hands solved with pruning switched off at runtime (pruningBuffer = Infinity on
//    each no-wild finder; no solver code is changed), on the 30 test cases and the first N match rounds; plus
//    monotonicity of cdf netEV over the sorted CDF keys, which estimateMaxFrontScore's bound relies on.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const { readMatchCsv } = require('./match-summary.js');
const { arrangementFromSignature, dealtHandCards, dealtHandsForRound } = require('./summarize-match-differences.js');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_MATCH_CSVS = [
    'data/matches/match_cdf_vs_tiered2_seed1_1000.csv',
    'data/matches/match_cdf_vs_tiered2_seed1_1000_start1000.csv'
];
// The batch runner's script list (scripts/deal-lookup-rounds.js) plus game.js and the stored test cases
const SCRIPT_FILES = [
    'js/constants/hand-types.js', 'js/utils.js', 'js/utilities/analysis.js', 'js/utilities/card-count.js',
    'js/utilities/empirical-win-probability.js', 'js/utilities/tiered-win-probability.js',
    'js/utilities/tiered2-win-probability.js', 'js/utilities/netEV-lookup-table.js', 'js/utilities/cdf-lookup.js',
    'js/utilities/convert-to-card-model.js', 'js/hands/evaluate-hand.js', 'js/hands/hand-utilities.js',
    'js/hands/scoring-utilities.js', 'js/core/deck.js', 'js/utils/card-sorter.js', 'js/scoring/compare-hands.js',
    'js/utilities/card-parser.js', 'js/utilities/count-valid-hands.js', 'js/utilities/count-valid-hands-from-cards.js',
    'js/utilities/create-arrangement.js', 'js/arrange/hand-sorter.js', 'js/hands/hand-detector.js',
    'js/hands/card-utilities.js', 'js/hands/arrangement-scorer.js', 'js/hands/arrangement-validator.js',
    'js/arrange/two-wild-strategy-one.js', 'js/arrange/two-wild-strategy-two.js', 'js/core/game-config.js',
    'js/arrange/find-best-setup-no-wild.js', 'js/arrange/one-wild-candidates.js', 'js/arrange/find-best-setup-one-wild.js',
    'js/arrange/find-best-setup-two-wild.js', 'js/arrange/find-best-setup.js', 'js/stats/play-hand-stats.js',
    'js/core/game.js', 'js/tests/test-cases.js', 'js/tests/create-from-cards-test-case.js'
];
const TEST_METHODS = ['points', 'empirical', 'tiered', 'tiered2', 'netEV', 'cdf'];
const TEST_CASE_IDS = [1, 1001, 2001].flatMap((firstId) => Array.from({ length: 10 }, (_, offset) => firstId + offset));
const POSITIONS = ['back', 'middle', 'front'];
const EARLY_STOP_NODES = 100000;

function argValue(flag) {
    const flagIndex = process.argv.indexOf(flag);
    return flagIndex === -1 || flagIndex + 1 >= process.argv.length ? null : process.argv[flagIndex + 1];
}

function installHost() {
    global.window = global;
    global.performance = performance;
    global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
    const stubElement = () => ({ innerHTML: '', style: {}, children: [], classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {} });
    global.document = { getElementById: stubElement, createElement: stubElement, addEventListener() {}, body: { appendChild() {} } };
    global.fetch = async function fetchLocal(url) {
        const filePath = path.resolve(REPO, String(url).replace(/^\//, ''));
        if (!fs.existsSync(filePath)) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        const fileText = fs.readFileSync(filePath, 'utf8');
        return { ok: true, status: 200, statusText: 'OK', text: async () => fileText };
    };
}

function loadGameScripts() {
    const gameSource = SCRIPT_FILES.map((relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8')).join('\n');
    vm.runInThisContext(gameSource, { filename: 'audit-arrangement-validity-scripts.js' });
}

async function loadTables() {
    if (!await initializeEmpiricalWinProbability()) throw new Error('Empirical table failed to load');
    if (!await initializeTieredWinProbability()) throw new Error('Tiered table failed to load');
    if (!await initializeTiered2WinProbability()) throw new Error('Tiered2 table failed to load');
    if (!await initializeNetEVLookup()) throw new Error('NetEV table failed to load');
    cdfLookup.loadFromJson(JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'cdf_arrays_netev.json'), 'utf8')));
}

// Run with console.log silenced (the solver and ArrangementValidator log freely)
function quietly(quietFunction) {
    const savedLog = console.log;
    console.log = () => {};
    try {
        return quietFunction();
    } finally {
        console.log = savedLog;
    }
}

// Played cards per position -> list of rule violations (empty when the game would accept the arrangement)
function arrangementProblems(cardsByPosition) {
    const { back, middle, front } = cardsByPosition;
    const problems = [];
    if (![5, 6, 7, 8].includes(back.length)) problems.push(`back has ${back.length} cards`);
    if (![5, 6, 7].includes(middle.length)) problems.push(`middle has ${middle.length} cards`);
    if (front.length !== 3 && front.length !== 5) problems.push(`front has ${front.length} cards`);
    if (problems.length > 0) return problems;
    for (const [position, cards] of [['back', back], ['middle', middle]]) {
        if (!PyramidPoker.prototype.validateLargeHand.call(PyramidPoker.prototype, cards)) {
            problems.push(`${position} has ${cards.length} cards but is not a straight flush or same rank`);
        }
    }
    const backEvaluation = evaluateHand(back);
    const middleEvaluation = evaluateHand(middle);
    const frontEvaluation = evaluateThreeCardHand(front);
    const validator = new ArrangementValidator(null);
    if (!quietly(() => validator.validateHandOrder(backEvaluation, middleEvaluation, frontEvaluation))) {
        if (compareTuples(backEvaluation.handStrength, middleEvaluation.handStrength) < 0) {
            problems.push(`back [${backEvaluation.handStrength}] < middle [${middleEvaluation.handStrength}]`);
        }
        if (compareTuples(middleEvaluation.handStrength, frontEvaluation.handStrength) < 0) {
            problems.push(`middle [${middleEvaluation.handStrength}] < front [${frontEvaluation.handStrength}]`);
        }
    }
    if (!quietly(() => validator.validateFrontHandConstraint({ front }, frontEvaluation))) {
        problems.push(`5-card front is ${frontEvaluation.name}, below a straight`);
    }
    return problems;
}

function describePlayedCards(cards) {
    return cards.map((card) => `${card.rank}${card.suit}${card.playedAsWild ? '*' : ''}`).join(' ');
}

function describeArrangement(cardsByPosition) {
    return POSITIONS.map((position) => `${position} ${describePlayedCards(cardsByPosition[position])}`).join(' | ');
}

// ---------------------------------------------------------------------------
// 1. Match CSVs
// ---------------------------------------------------------------------------

function auditMatchCsv(csvPath) {
    const matchMetadata = JSON.parse(fs.readFileSync(csvPath.replace(/\.csv$/i, '.json'), 'utf8')).metadata;
    const handRows = readMatchCsv(csvPath);
    const invalidCounts = { [matchMetadata.methodA]: 0, [matchMetadata.methodB]: 0 };
    const invalidHands = [];
    for (const handRow of handRows) {
        const arrangementA = arrangementFromSignature(handRow.signatureA);
        const arrangementB = arrangementFromSignature(handRow.signatureB);
        let rebuildProblem = null;
        try {
            dealtHandCards(matchMetadata.seed, handRow, [arrangementA, arrangementB]);
        } catch (error) {
            rebuildProblem = error.message;
        }
        const problemsByMethod = {};
        for (const [method, arrangement] of [[matchMetadata.methodA, arrangementA], [matchMetadata.methodB, arrangementB]]) {
            const cardsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, arrangement[position].cards]));
            const problems = arrangementProblems(cardsByPosition);
            const wildsPlayed = POSITIONS.flatMap((position) => cardsByPosition[position]).filter((card) => card.playedAsWild).length;
            if (wildsPlayed > handRow.w) problems.push(`${wildsPlayed} wilds played, ${handRow.w} dealt`);
            if (rebuildProblem) problems.push(rebuildProblem);
            if (problems.length > 0) invalidCounts[method] += 1;
            problemsByMethod[method] = problems;
        }
        if (Object.values(problemsByMethod).some((problems) => problems.length > 0)) {
            invalidHands.push({ handRow, arrangementA, arrangementB, problemsByMethod });
        }
    }

    console.log(`\n${path.basename(csvPath)}: ${handRows.length} hands, seed ${matchMetadata.seed}, rounds ${matchMetadata.startRound}-${matchMetadata.endRound}`);
    for (const [method, invalidCount] of Object.entries(invalidCounts)) {
        console.log(`  ${method}: ${invalidCount} invalid of ${handRows.length}`);
    }
    for (const { handRow, arrangementA, arrangementB, problemsByMethod } of invalidHands) {
        const dealtCards = dealtHandsForRound(matchMetadata.seed, handRow.round)[handRow.handIndex];
        console.log(`  round ${handRow.round} hand ${handRow.handIndex}, w=${handRow.w}: ${dealtCards.map((card) => card.isWild ? '🃏' : `${card.rank}${card.suit}`).join(' ')}`);
        for (const [method, arrangement] of [[matchMetadata.methodA, arrangementA], [matchMetadata.methodB, arrangementB]]) {
            const cardsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, arrangement[position].cards]));
            const problems = problemsByMethod[method];
            console.log(`    ${method.padEnd(8)} ${describeArrangement(cardsByPosition)}${problems.length ? `  INVALID: ${problems.join('; ')}` : ''}`);
        }
    }
    return { handCount: handRows.length, invalidCounts };
}

// ---------------------------------------------------------------------------
// 2. Stored test cases, every method
// ---------------------------------------------------------------------------

function isWildDerived(card) {
    return Boolean(card.isWild || card.wasWild || /WILD/i.test(String(card.id)));
}

// Solver result -> played cards per position, with played wilds marked
function playedCardsFromSolve(solved) {
    return Object.fromEntries(POSITIONS.map((position) => [position, solved.arrangement[position].cards.map((card) => ({
        rank: card.rank, suit: card.suit, value: card.value, id: card.id, isWild: false, playedAsWild: isWildDerived(card)
    }))]));
}

// Non-wild cards must be distinct cards of the dealt hand; played wilds no more than dealt wilds
function cardSourceProblems(dealtCards, cardsByPosition) {
    const dealtIds = new Set(dealtCards.filter((card) => !card.isWild).map((card) => card.id));
    const playedCards = POSITIONS.flatMap((position) => cardsByPosition[position]);
    const playedIds = playedCards.filter((card) => !card.playedAsWild).map((card) => card.id);
    const problems = [];
    const foreignIds = playedIds.filter((cardId) => !dealtIds.has(cardId));
    if (foreignIds.length > 0) problems.push(`cards not in the hand: ${foreignIds.join(' ')}`);
    if (new Set(playedIds).size !== playedIds.length) problems.push('a card is used twice');
    const wildsPlayed = playedCards.filter((card) => card.playedAsWild).length;
    const wildsDealt = dealtCards.filter((card) => card.isWild).length;
    if (wildsPlayed > wildsDealt) problems.push(`${wildsPlayed} wilds played, ${wildsDealt} dealt`);
    return problems;
}

function solveWithMethod(dealtCards, method) {
    const savedMethod = gameConfig.config.winProbabilityMethod;
    gameConfig.config.winProbabilityMethod = method;
    try {
        return quietly(() => new FindBestSetup().findBestSetup(dealtCards.map((card) => ({ ...card }))));
    } finally {
        gameConfig.config.winProbabilityMethod = savedMethod;
    }
}

function auditTestCases() {
    const invalidCounts = Object.fromEntries(TEST_METHODS.map((method) => [method, 0]));
    const failedSolves = [];
    console.log(`\nStored test cases: ${TEST_CASE_IDS.length} cases x ${TEST_METHODS.length} methods (netEV uses the interpolated table, as in the browser)`);
    for (const caseId of TEST_CASE_IDS) {
        const dealtCards = quietly(() => createFromCardsTestCase(caseId));
        for (const method of TEST_METHODS) {
            const solved = solveWithMethod(dealtCards, method);
            if (!solved || !solved.success || !solved.arrangement) {
                failedSolves.push(`case ${caseId} ${method}: ${solved && solved.error}`);
                invalidCounts[method] += 1;
                continue;
            }
            const cardsByPosition = playedCardsFromSolve(solved);
            const problems = [...arrangementProblems(cardsByPosition), ...cardSourceProblems(dealtCards, cardsByPosition)];
            if (problems.length > 0) {
                invalidCounts[method] += 1;
                console.log(`  case ${caseId} ${method} INVALID: ${problems.join('; ')}`);
                console.log(`    cards: ${dealtCards.map((card) => card.isWild ? '🃏' : `${card.rank}${card.suit}`).join(' ')}`);
                console.log(`    ${describeArrangement(cardsByPosition)}`);
            }
        }
    }
    for (const method of TEST_METHODS) console.log(`  ${method.padEnd(9)} ${invalidCounts[method]} invalid of ${TEST_CASE_IDS.length}`);
    failedSolves.forEach((failedSolve) => console.log(`  no arrangement: ${failedSolve}`));
    return invalidCounts;
}

// ---------------------------------------------------------------------------
// 3. Pruning check for cdf
// ---------------------------------------------------------------------------

const pruningControl = { disabled: false, maxExploredNodes: 0 };

// Wrap the game's no-wild finder factory (used by the no-, one- and two-wild solvers) so pruning can be switched off
// and the explored-node count (early stop above 100000) observed
function installPruningControl() {
    const gameFinderFactory = global.createFindBestSetupNoWild;
    global.createFindBestSetupNoWild = function auditedFinderFactory(flag, options) {
        const finder = gameFinderFactory(flag, options);
        if (pruningControl.disabled) finder.pruningBuffer = Infinity;
        const gameSearch = finder.findBestSetupNoWild.bind(finder);
        finder.findBestSetupNoWild = (allCards) => {
            const searched = gameSearch(allCards);
            pruningControl.maxExploredNodes = Math.max(pruningControl.maxExploredNodes, finder.exploredNodes);
            return searched;
        };
        return finder;
    };
}

function solvedSignature(solved) {
    const cardsByPosition = playedCardsFromSolve(solved);
    return POSITIONS.map((position) => describePlayedCards([...cardsByPosition[position]].sort((cardA, cardB) =>
        cardB.value - cardA.value || cardA.suit.localeCompare(cardB.suit)))).join(' / ');
}

function comparePrunedAndUnpruned(label, dealtCards) {
    pruningControl.disabled = false;
    pruningControl.maxExploredNodes = 0;
    const pruned = solveWithMethod(dealtCards, 'cdf');
    const prunedNodes = pruningControl.maxExploredNodes;
    pruningControl.disabled = true;
    pruningControl.maxExploredNodes = 0;
    const startedAt = performance.now();
    const unpruned = solveWithMethod(dealtCards, 'cdf');
    const unprunedMs = performance.now() - startedAt;
    const unprunedNodes = pruningControl.maxExploredNodes;
    pruningControl.disabled = false;
    return {
        label,
        prunedScore: pruned.score,
        unprunedScore: unpruned.score,
        sameArrangement: solvedSignature(pruned) === solvedSignature(unpruned),
        prunedSignature: solvedSignature(pruned),
        unprunedSignature: solvedSignature(unpruned),
        earlyStop: prunedNodes > EARLY_STOP_NODES || unprunedNodes > EARLY_STOP_NODES,
        unprunedMs
    };
}

function cdfMonotonicity() {
    const monotonicityLines = [];
    for (const [position, positionArrays] of Object.entries(cdfLookup.cdfJson.positions)) {
        for (const w of [0, 1, 2]) {
            const netEVs = positionArrays.keys.map((rankKey) => cdfLookup.lookup(position, w, rankKey).netEV);
            const decreases = netEVs.filter((netEV, keyIndex) => keyIndex > 0 && netEV < netEVs[keyIndex - 1] - 1e-12).length;
            monotonicityLines.push(`  ${position} w${w}: ${positionArrays.keys.length} keys, netEV decreases ${decreases},` +
                ` range ${Math.min(...netEVs).toFixed(3)} to ${Math.max(...netEVs).toFixed(3)}`);
        }
    }
    return monotonicityLines;
}

function auditPruning(matchCsvPaths, pruneRounds) {
    console.log('\nPruning check (cdf): netEV over the sorted CDF keys (estimateMaxFrontScore assumes the first front-valid hand in sort order scores highest)');
    cdfMonotonicity().forEach((monotonicityLine) => console.log(monotonicityLine));

    const comparisons = TEST_CASE_IDS.map((caseId) => comparePrunedAndUnpruned(`case ${caseId}`, quietly(() => createFromCardsTestCase(caseId))));
    if (pruneRounds > 0 && matchCsvPaths.length > 0) {
        const { seed, startRound } = JSON.parse(fs.readFileSync(matchCsvPaths[0].replace(/\.csv$/i, '.json'), 'utf8')).metadata;
        for (let roundIndex = startRound; roundIndex < startRound + pruneRounds; roundIndex++) {
            dealtHandsForRound(seed, roundIndex).forEach((dealtCards, handIndex) =>
                comparisons.push(comparePrunedAndUnpruned(`round ${roundIndex} hand ${handIndex}`, dealtCards)));
        }
    }
    const lostScore = comparisons.filter((comparison) => comparison.unprunedScore > comparison.prunedScore + 1e-9);
    const changedArrangement = comparisons.filter((comparison) => !comparison.sameArrangement);
    console.log(`  ${comparisons.length} hands solved with and without pruning (30 test cases + ${pruneRounds} match rounds x 6 hands):` +
        ` unpruned scored higher on ${lostScore.length}, arrangement differs on ${changedArrangement.length},` +
        ` early stop (>${EARLY_STOP_NODES} nodes) on ${comparisons.filter((comparison) => comparison.earlyStop).length};` +
        ` unpruned solve ${(comparisons.reduce((total, comparison) => total + comparison.unprunedMs, 0) / comparisons.length).toFixed(0)} ms average`);
    for (const comparison of changedArrangement.concat(lostScore.filter((comparison) => comparison.sameArrangement))) {
        console.log(`  ${comparison.label}: pruned ${comparison.prunedScore.toFixed(4)} ${comparison.prunedSignature}`);
        console.log(`  ${' '.repeat(comparison.label.length)}  unpruned ${comparison.unprunedScore.toFixed(4)} ${comparison.unprunedSignature}`);
    }
}

async function auditArrangementValidity() {
    installHost();
    loadGameScripts();
    gameConfig.config.wildCardCount = 2;
    delete window.WIN_PROB_OVERRIDE;
    window.NETEV_USE_TIERED2_FORMULA = undefined;
    await quietly(loadTables);
    installPruningControl();

    const pruneRounds = Number(argValue('--prune-rounds') || '0');
    const flagValues = new Set([argValue('--prune-rounds')]);
    const csvArguments = process.argv.slice(2).filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));
    const matchCsvPaths = (csvArguments.length > 0 ? csvArguments : DEFAULT_MATCH_CSVS).map((csvPath) => path.resolve(REPO, csvPath));

    console.log('1. Match arrangements');
    matchCsvPaths.forEach(auditMatchCsv);
    if (!process.argv.includes('--skip-test-cases')) {
        console.log('\n2. Stored test cases');
        auditTestCases();
    }
    console.log('\n3. Pruning');
    auditPruning(matchCsvPaths, pruneRounds);
}

if (require.main === module) {
    auditArrangementValidity().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { auditArrangementValidity };
