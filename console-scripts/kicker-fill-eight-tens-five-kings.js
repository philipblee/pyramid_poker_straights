// Research repro: kicker fill and score for an Eight Tens hand and a Five Kings hand under empirical, cdf, tiered2.
// Usage: node console-scripts/kicker-fill-eight-tens-five-kings.js
// Read-only: loads game files into a vm like scripts/measure-kicker-gap.js; edits nothing.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const REPO = path.resolve(__dirname, '..');
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
    'js/arrange/find-best-setup-one-wild.js', 'js/arrange/find-best-setup-two-wild.js', 'js/arrange/find-best-setup.js'
];

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
    global.fetch = async (url) => {
        const filePath = path.resolve(REPO, String(url).replace(/^\//, ''));
        if (!fs.existsSync(filePath)) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        const text = fs.readFileSync(filePath, 'utf8');
        return { ok: true, status: 200, statusText: 'OK', text: async () => text };
    };
    const source = SCRIPT_FILES.map((p) => fs.readFileSync(path.join(REPO, p), 'utf8') + '\n').join('\n');
    vm.runInThisContext(source, { filename: 'kicker-fill-repro-game.js' });
}

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
function makeCards(specs) {
    const used = {};
    return specs.split(' ').map((spec) => {
        const rank = spec.slice(0, -1);
        const suit = SUIT[spec.slice(-1)];
        const base = `${rank}${suit}`;
        used[base] = (used[base] || 0) + 1;
        return { suit, rank, value: getCardValue(rank), id: `${base}_${used[base]}`, isWild: false };
    });
}

const cardText = (cards) => cards.map((c) => `${c.rank}${c.suit}`).join(' ');

function solve(method, cards) {
    gameConfig.config.winProbabilityMethod = method;
    window.NETEV_USE_TIERED2_FORMULA = false;
    const finder = createFindBestSetupNoWild(method, { wildCount: 0, collectTopArrangements: true });
    const savedLog = console.log;
    console.log = () => {};
    let solved;
    try { solved = finder.findBestSetupNoWild(cards.map((c) => ({ ...c }))); } finally { console.log = savedLog; }
    const viaDispatcher = (() => {
        console.log = () => {};
        try { return findBestSetup(cards.map((c) => ({ ...c }))); } finally { console.log = savedLog; }
    })();
    return { solved, preKicker: finder.bestArrangement, viaDispatcher };
}

function report(label, cards) {
    console.log(`\n================ ${label}: ${cardText(cards)}`);
    for (const method of ['empirical', 'cdf', 'tiered2']) {
        const { solved, preKicker, viaDispatcher } = solve(method, cards);
        const arrangement = solved.arrangement;
        console.log(`\n--- ${method}: pre-kicker score ${solved.score.toFixed(3)}, post-kicker score ${arrangement.score.toFixed(3)}` +
            ` (explored ${solved.statistics.exploredNodes}, pruned ${solved.statistics.prunedNodes})`);
        for (const position of ['back', 'middle', 'front']) {
            const hand = arrangement[position];
            const detectedIds = new Set(preKicker[position].cards.map((c) => c.id));
            const kickers = hand.cards.filter((c) => !detectedIds.has(c.id));
            const positionScore = position === 'back' ? arrangement.scoreBack : position === 'middle' ? arrangement.scoreMiddle : arrangement.scoreFront;
            console.log(`  ${position.padEnd(6)} ${hand.name || '?'} [type ${hand.handType}] hand_rank (${(hand.hand_rank || []).join(',')})`);
            console.log(`         detected: ${cardText(preKicker[position].cards)}   kickers: ${kickers.length ? cardText(kickers) : '(none)'}   score ${Number(positionScore).toFixed(3)}`);
        }
        console.log(`  staging: ${cardText(arrangement.stagingCards || [])}`);
        const dispatched = viaDispatcher.arrangement;
        const same = ['back', 'middle', 'front'].every((p) => cardText(dispatched[p].cards) === cardText(arrangement[p].cards));
        console.log(`  findBestSetup() dispatcher gives the same arrangement: ${same}`);
        console.log('  top arrangements (post-kicker):');
        (solved.topArrangements || []).forEach((entry, i) => {
            const a = entry.arrangement;
            console.log(`    ${i + 1}. ${entry.score.toFixed(3)}  B: ${cardText(a.back.cards)} | M: ${cardText(a.middle.cards)} | F: ${cardText(a.front.cards)}`);
        });
    }
}

async function main() {
    loadGame();
    gameConfig.config.wildCardCount = 2;
    if (!(await initializeEmpiricalWinProbability())) throw new Error('empirical table failed to load');
    if (!(await initializeTiered2WinProbability())) throw new Error('tiered2 table failed to load');
    cdfLookup.loadFromJson(JSON.parse(fs.readFileSync(path.join(REPO, 'data/cdf_arrays_netev.json'), 'utf8')));

    // Raw empirical lookups for the big hands, to show what the table returns
    for (const [position, tuple] of [['back', [16, 10]], ['back', [10, 13]], ['middle', [10, 13]], ['middle', [16, 10]]]) {
        console.log(`lookupEmpiricalWinProbability(${position}, (${tuple})) = ${lookupEmpiricalWinProbability(position, { hand_rank: tuple, isIncomplete: false })}`);
    }

    // Eight Tens: all eight natural tens of the two decks, no wilds
    report('Eight Tens', makeCards('10s 10h 10d 10c 10s 10h 10d 10c As Kh Qd Jc 9s 7h 5d 3c 2s'));
    // Five Kings: five natural kings, no wilds
    report('Five Kings', makeCards('Ks Kh Kd Kc Ks As Ah Qd Jc 9s 8h 7d 6c 4s 4h 3d 2c'));
}

main().catch((error) => { console.error(error); process.exit(1); });
