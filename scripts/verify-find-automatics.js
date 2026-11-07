// Check findAutomatics (js/hands/find-automatics.js) against built hands and an exhaustive oracle.
//   node scripts/verify-find-automatics.js [hands per wild count, default 300000] [--bug-checks]
// Built hands: each automatic, hands the old greedy detector missed, wild cases, near misses that must not qualify, and
// the dragon's standard-setup cases. Oracle: random 17-card hands from createDeck at 0, 1 and 2 wilds; every automatic
// is decided independently by trying every set of three row templates (full house, straight window, suit) against the
// card counts and wilds, and three full houses must also match the oracle's strongest rows.
// Every arrangement returned must: be accepted by validateAutomaticArrangement as its type, have 5-5-5 rows (dragon:
// exactly A-K-Q-J-10 / 9-8-7-6-5 / 4-3-2), pass validateHands' order check, use each card once, set every wild it places,
// and leave the input unchanged. Three-flush variants must each pass and run strongest first.
// --bug-checks also runs deliberately broken copies of find-automatics.js, each of which must fail. Exits 1 on any failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const FINDER_FILE = 'js/hands/find-automatics.js';
const GAME_FILES = ['js/utils.js', 'js/utilities/analysis.js', 'js/hands/card-utilities.js', 'js/ui/assign-wild-card.js',
    'js/ui/resolve-wild-in-hand.js', 'js/hands/evaluate-hand.js', 'js/core/game-config.js',
    'js/hands/validate-automatic-arrangement.js', FINDER_FILE];
const AUTOMATIC_TYPES = ['three-full-houses', 'dragon', 'three-straight', 'three-flush'];
const PRECEDENCE = { 'three-full-houses': 4, dragon: 3, 'three-straight': 2, 'three-flush': 1 };
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_LETTERS = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_VALUES = { A: 14, K: 13, Q: 12, J: 11 };
const DRAGON_ROW_VALUES = [[14, 13, 12, 11, 10], [9, 8, 7, 6, 5], [4, 3, 2]];
const FAILURES_SHOWN = 12;
const BUG_CHECK_HANDS = 5000;

const BUG_CHECKS = [
    ['two flushes of one suit not allowed', 'for (let second = first; second < 4; second++) for (let third = second; third < 4; third++)',
        'for (let second = first + 1; second < 4; second++) for (let third = second + 1; third < 4; third++)'],
    ['wild never pairs a single card', 'remainingByValue[pairValue] + wildsLeft < 2', 'remainingByValue[pairValue] < 2'],
    ['first full house kept (no backtracking)', 'if (chooseRow(rowIndex)) return true;', 'return chooseRow(rowIndex);'],
    ['wheel window missing', ', { values: [14, 5, 4, 3, 2], strength: [14, 5] }]', ']'],
    ['dragon fills only one missing rank', 'if (missingValues.length > cardCounts.wildCount) return null;',
        'if (missingValues.length > Math.min(1, cardCounts.wildCount)) return null;'],
    ['rows ordered weakest first', '.sort((first, second) => compareTuples(second.handStrength, first.handStrength))',
        '.sort((first, second) => compareTuples(first.handStrength, second.handStrength))'],
    ['placed wild left unassigned', 'value, number: value, isWild: false, wasWild: true', 'value, number: value, isWild: true, wasWild: false'],
    ['input cards used, not copies', "naturalCards: cards.filter((card) => !card.isWild).map((card) => ({ ...card }))",
        'naturalCards: cards.filter((card) => !card.isWild)'],
    ['dragon middle straight flush left in place', 'if (isOneSuit(middleRow) && !isOneSuit(backRow)) {', 'if (false) {'],
    ['three-flush variants not sorted', 'flushPlans.sort((first, second) => compareRowStrengthSets(second.rowStrengths, first.rowStrengths));',
        'flushPlans.reverse();']
];

// Built hands: S/H/D/C + rank, W for a wild. best is checked when given; mustHave / mustNotHave list automatic types.
const BUILT_HANDS = [
    { name: 'three full houses, plain', hand: 'SK HK DK C9 S9 D7 S7 H7 C4 D4 SA HA DA C2 S2 H6 D8', best: 'three-full-houses' },
    { name: 'dragon, plain', hand: 'SA HK DQ CJ S10 H9 D8 C7 S6 H5 D4 C3 S2 HA DA CK SQ', best: 'dragon' },
    { name: 'three straights, plain', hand: 'SA HK DQ CJ S10 CK SQ HJ D10 H9 S7 D6 C5 H4 D3 HA DK', best: 'three-straight' },
    { name: 'three flushes, plain', hand: 'S2 S5 S8 SJ SK H3 H6 H9 HQ HA D2 D5 D8 D10 DK C3 C9', best: 'three-flush' },

    { name: 'greedy miss: full houses 666-33, QQQ-AA, 999-4+W', hand: 'D6 H6 W C4 CQ D5 HK D6 D3 C9 H3 S9 SQ HQ D9 CA CA', best: 'three-full-houses' },
    { name: 'greedy miss: full houses 2/Q, 5/K, 9/K', hand: 'SQ W HK SK S9 C9 CQ D9 D2 S5 S10 D5 D5 HK H2 C8 SK', best: 'three-full-houses' },
    { name: 'greedy miss: full houses 3/2, J/10, Q/K', hand: 'CQ DK S10 CJ H2 HK S3 DQ D10 CQ S8 W HJ H6 SJ D3 D3', best: 'three-full-houses' },
    { name: 'greedy miss: straights K-9, 7-3, 7-3', hand: 'C5 HK H4 CQ SQ D9 D4 S5 H6 W S10 H3 W DQ CJ C7 S3', mustHave: ['three-straight'] },
    { name: 'greedy miss: straights J-7, 10-6 (W as 9), wheel', hand: 'DJ D5 H10 C8 S8 H7 H6 C7 D10 CA D4 W S9 C5 D3 H8 S2', mustHave: ['three-straight'] },
    { name: 'greedy miss: straights K-9, Q-8, wheel', hand: 'S5 H2 DA S10 W CJ S2 D9 S4 HJ SQ H10 SK H8 H3 H10 H9', mustHave: ['three-straight'] },
    { name: 'greedy miss: flushes spades, spades, clubs', hand: 'S4 DK SK SA S5 DQ C3 CK C5 S5 S8 S2 SJ SQ C4 SJ C10', best: 'three-flush' },
    { name: 'greedy miss: flushes hearts, clubs, clubs', hand: 'CK C2 CQ C10 S4 CK C4 H10 S10 H7 HK HK C6 H6 C2 C10 C3', mustHave: ['three-flush'] },
    { name: 'old 5-5-2 bug: dragon needing both wilds', hand: 'H8 C6 W H7 SA SQ H9 C7 SJ H4 H8 H2 CA S10 SJ C3 W', best: 'dragon' },
    { name: 'old wild bug: three flush with the wild made a full house', hand: 'DJ H9 C4 W HQ D9 CQ H10 D5 S7 D9 H4 C5 W HK D3 S9', mustHave: ['three-flush'] },

    { name: 'wild pairs a single card (2 + W)', hand: 'SA HA DA SK HK DK SQ HQ DQ SJ HJ S9 H9 C2 W D5 C7', best: 'three-full-houses' },
    { name: 'two wilds in one full house (9-W-W, 2-2)', hand: 'SA HA DA SK HK SQ HQ DQ SJ HJ S9 W W C2 D2 H5 D7', best: 'three-full-houses' },
    { name: 'wild fills a straight gap (A-K-Q-J-W)', hand: 'SA HK DQ CJ W SK HQ DJ C10 S9 CQ SJ H10 D9 H8 C2 D4', best: 'three-straight' },
    { name: 'two wilds in one straight (A-W-W-J-10)', hand: 'SA W W CJ S10 S9 H8 D7 C6 S5 H9 D8 C7 S6 H5 D2 C3', mustHave: ['three-straight'] },
    { name: 'wild completes a flush', hand: 'S2 S5 S8 SJ W H3 H6 H9 HQ HA D2 D5 D8 D10 DK C3 C9', best: 'three-flush' },
    { name: 'three flush with a wild to spare (variants)', hand: 'S2 S5 S8 SJ SK H3 H6 H9 HQ HA D2 D5 D8 D10 DK W C3', best: 'three-flush', variants: true },

    { name: 'near miss: third full house one card short', hand: 'SA HA DA SK HK DK SQ HQ DQ SJ HJ S9 H9 C2 D5 C7 H4', mustNotHave: ['three-full-houses'] },
    { name: 'near miss: third straight has a pair, no 8', hand: 'SA HK DQ CJ S10 SK HQ DJ C10 S9 CQ SJ H10 D9 D9 C2 D4', mustNotHave: ['three-straight'] },
    { name: 'near miss: 12 ranks, no wild', hand: 'SA HK DQ CJ S10 H9 D8 C7 S6 H5 D4 C3 HA DK CQ SJ H10', mustNotHave: ['dragon'] },
    { name: 'near miss: suits 4 + 5 + 5, no wild', hand: 'S2 S5 S8 SJ H3 H6 H9 HQ HA D2 D5 D8 D10 DK C3 C9 C5', mustNotHave: ['three-flush'] },
    { name: 'near miss: dragon missing 3 and 2, one wild', hand: 'SA HK DQ CJ S10 H9 D8 C7 S6 H5 D4 W HA DK CQ SJ H10', mustNotHave: ['dragon'] },

    { name: 'dragon: middle can only be spades, back cannot be one suit', hand: 'SA HK DQ CJ S10 S9 S8 S7 S6 S5 D4 C3 H2 HA DK CQ HJ', mustNotHave: ['dragon'] },
    { name: 'dragon: middle only spades, back made a spade straight flush', hand: 'HA DK CQ HJ SA SK SQ SJ S10 S9 S8 S7 S6 S5 D4 C3 H2', best: 'dragon' },
    { name: 'dragon: middle all spades, swap in the 9 of hearts', hand: 'SA HK DQ CJ S10 S9 S8 S7 S6 S5 D4 C3 H2 H9 DK CQ HJ', best: 'dragon' },
    { name: 'dragon: middle all spades, spare wild breaks the suit', hand: 'SA HK DQ CJ S10 S9 S8 S7 S6 S5 D4 C3 H2 W DK CQ HJ', mustHave: ['dragon'] },
    { name: 'dragon: wild as the 9 is re-suited', hand: 'SA HK DQ CJ S10 W S8 S7 S6 S5 D4 C3 H2 HA DK CQ HJ', mustHave: ['dragon'] },
    { name: '13 cards: dragon', hand: 'SA HK DQ CJ S10 H9 D8 C7 S6 H5 D4 C3 S2', best: 'dragon' },
    { name: '13 cards: no full houses possible', hand: 'SA HA DA SK HK DK SQ HQ DQ SJ HJ S9 H9', mustNotHave: ['three-full-houses'] }
];

function loadGame(mutation) {
    const quietConsole = { log() {}, warn() {}, info() {}, debug() {}, error: console.error };
    const sandbox = { console: quietConsole };
    sandbox.window = sandbox;
    sandbox.document = { querySelector: () => null, getElementById: () => null, readyState: 'complete', addEventListener() {} };
    vm.createContext(sandbox);
    GAME_FILES.forEach((relativePath) => {
        let source = fs.readFileSync(path.join(REPO, relativePath), 'utf8');
        if (mutation && relativePath === FINDER_FILE) {
            if (source.split(mutation.find).length !== 2) throw new Error(`Bug check "${mutation.name}": text not found exactly once`);
            source = source.replace(mutation.find, mutation.replacement);
        }
        vm.runInContext(source, sandbox, { filename: relativePath });
    });
    const get = (name) => vm.runInContext(name, sandbox);
    return {
        findAutomatics: get('findAutomatics'),
        validateAutomaticArrangement: get('validateAutomaticArrangement'),
        evaluateHand: get('evaluateHand'),
        evaluateThreeCardHand: get('evaluateThreeCardHand'),
        compareTuples: get('compareTuples'),
        createDeck: get('createDeck'),
        setWildCount: (wildCount) => { get('window.gameConfig').config.wildCardCount = wildCount; }
    };
}

function parseHand(handText) {
    let wildNumber = 0;
    const seen = {};
    return handText.split(/\s+/).map((token) => {
        if (token === 'W') {
            wildNumber++;
            return { suit: '🃏', rank: '🃏', value: 15, id: `WILD_JOKER_${wildNumber}`, isWild: true };
        }
        const suit = SUIT_SYMBOLS[token[0]];
        const rank = token.slice(1);
        const value = RANK_VALUES[rank] || Number(rank);
        const baseId = `${rank}${suit}`;
        seen[baseId] = (seen[baseId] || 0) + 1;
        return { suit, rank, value, id: `${baseId}_${seen[baseId]}`, isWild: false };
    });
}

const cardText = (card) => (card.isWild ? 'W' : `${SUIT_LETTERS[card.suit]}${card.rank}`);
const handText = (cards) => cards.map(cardText).join(' ');

// ---------- oracle: every set of three row templates ----------

const ORACLE_FULL_HOUSE_ROWS = [];
for (let tripsValue = 2; tripsValue <= 14; tripsValue++) {
    for (let pairValue = 2; pairValue <= 14; pairValue++) if (tripsValue !== pairValue) ORACLE_FULL_HOUSE_ROWS.push([tripsValue, pairValue]);
}
const ORACLE_STRAIGHT_ROWS = [[14, 2, 3, 4, 5]];
for (let highValue = 6; highValue <= 14; highValue++) ORACLE_STRAIGHT_ROWS.push([highValue - 4, highValue - 3, highValue - 2, highValue - 1, highValue]);

function countHand(cards) {
    const countByValue = new Array(15).fill(0);
    const countBySuit = [0, 0, 0, 0];
    const countByValueAndSuit = new Array(60).fill(0);
    let wildCount = 0;
    cards.forEach((card) => {
        if (card.isWild) { wildCount++; return; }
        const suitIndex = SUITS.indexOf(card.suit);
        countByValue[card.value]++;
        countBySuit[suitIndex]++;
        countByValueAndSuit[card.value * 4 + suitIndex]++;
    });
    return { countByValue, countBySuit, countByValueAndSuit, wildCount };
}

function shortfall(needByKey, haveByKey) {
    let missing = 0;
    for (let key = 0; key < needByKey.length; key++) if (needByKey[key] > haveByKey[key]) missing += needByKey[key] - haveByKey[key];
    return missing;
}

// Rows as value lists; all triples of templates (repeats allowed), skipping a third row only when the first two already fail
function oracleTriples(templates, toNeed, have, wildCount, keepAll) {
    const feasibleTriples = [];
    for (let first = 0; first < templates.length; first++) {
        for (let second = first; second < templates.length; second++) {
            const twoRowNeed = new Array(have.length).fill(0);
            toNeed(templates[first], twoRowNeed);
            toNeed(templates[second], twoRowNeed);
            if (shortfall(twoRowNeed, have) > wildCount) continue;
            for (let third = second; third < templates.length; third++) {
                const threeRowNeed = [...twoRowNeed];
                toNeed(templates[third], threeRowNeed);
                if (shortfall(threeRowNeed, have) <= wildCount) {
                    feasibleTriples.push([templates[first], templates[second], templates[third]]);
                    if (!keepAll) return feasibleTriples;
                }
            }
        }
    }
    return feasibleTriples;
}

function compareRowLists(firstRows, secondRows) {
    for (let index = 0; index < firstRows.length; index++) {
        for (let part = 0; part < firstRows[index].length; part++) {
            if (firstRows[index][part] !== secondRows[index][part]) return firstRows[index][part] - secondRows[index][part];
        }
    }
    return 0;
}

function oracle(cards, wantStrongestFullHouses) {
    const counts = countHand(cards);
    const fullHouseTriples = oracleTriples(ORACLE_FULL_HOUSE_ROWS,
        ([tripsValue, pairValue], need) => { need[tripsValue] += 3; need[pairValue] += 2; }, counts.countByValue, counts.wildCount, wantStrongestFullHouses);
    let strongestFullHouses = null;
    fullHouseTriples.forEach((triple) => {
        const sortedRows = [...triple].sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        if (!strongestFullHouses || compareRowLists(sortedRows, strongestFullHouses) > 0) strongestFullHouses = sortedRows;
    });
    const straightTriples = oracleTriples(ORACLE_STRAIGHT_ROWS, (row, need) => row.forEach((value) => { need[value]++; }),
        counts.countByValue, counts.wildCount, false);
    const flushTriples = oracleTriples([0, 1, 2, 3], (suitIndex, need) => { need[suitIndex] += 5; }, counts.countBySuit, counts.wildCount, false);

    // Dragon in the standard setup: missing ranks <= wilds, unless the middle can only be one suit (no 9-5 missing, every
    // 9-5 card in one suit, no spare wild) and no suit holds every back rank that is present
    const missingValues = DRAGON_ROW_VALUES.flat().filter((value) => counts.countByValue[value] === 0);
    let hasDragon = missingValues.length <= counts.wildCount;
    if (hasDragon && missingValues.every((value) => value > 9 || value < 5) && counts.wildCount === missingValues.length) {
        const middleSuits = new Set();
        [9, 8, 7, 6, 5].forEach((value) => SUITS.forEach((suit, suitIndex) => {
            if (counts.countByValueAndSuit[value * 4 + suitIndex] > 0) middleSuits.add(suit);
        }));
        const backCanBeOneSuit = [0, 1, 2, 3].some((suitIndex) => DRAGON_ROW_VALUES[0].every((value) =>
            counts.countByValue[value] === 0 || counts.countByValueAndSuit[value * 4 + suitIndex] > 0));
        if (middleSuits.size === 1 && !backCanBeOneSuit) hasDragon = false;
    }
    return {
        present: {
            'three-full-houses': fullHouseTriples.length > 0,
            dragon: hasDragon,
            'three-straight': straightTriples.length > 0,
            'three-flush': flushTriples.length > 0
        },
        strongestFullHouses
    };
}

// ---------- arrangement checks ----------

function fullHouseRowValues(rowCards) {
    const countByValue = {};
    rowCards.forEach((card) => { countByValue[card.value] = (countByValue[card.value] || 0) + 1; });
    const tripsValue = Number(Object.keys(countByValue).find((value) => countByValue[value] === 3));
    const pairValue = Number(Object.keys(countByValue).find((value) => countByValue[value] === 2));
    return [tripsValue, pairValue];
}

// Strength without the suit tie-break, for the variants' strongest-first check
function strengthWithoutSuits(handStrength) {
    return handStrength[0] === 5 ? handStrength.slice(0, 6) : handStrength.slice(0, 3);
}

function checkArrangement(game, inputCards, automaticType, arrangement, isBest) {
    const problems = [];
    const rows = [arrangement.back, arrangement.middle, arrangement.front];
    const sizes = rows.map((rowCards) => rowCards.length).join('-');
    const expectedSizes = automaticType === 'dragon' ? '5-5-3' : '5-5-5';
    if (sizes !== expectedSizes) problems.push(`rows ${sizes}, expected ${expectedSizes}`);
    if (automaticType === 'dragon') {
        rows.forEach((rowCards, rowIndex) => {
            const rowValues = rowCards.map((card) => card.value).sort((a, b) => b - a).join(',');
            if (rowValues !== DRAGON_ROW_VALUES[rowIndex].join(',')) problems.push(`dragon row ${rowIndex} is ${rowValues}`);
        });
    }

    const validated = game.validateAutomaticArrangement(arrangement);
    if (!validated) problems.push('validateAutomaticArrangement rejects it');
    else if (isBest ? validated.type !== automaticType : validated.precedence < PRECEDENCE[automaticType]) {
        problems.push(`validateAutomaticArrangement says ${validated.type}`);
    }

    if (sizes === expectedSizes) {
        const backStrength = game.evaluateHand(arrangement.back).handStrength;
        const middleStrength = game.evaluateHand(arrangement.middle).handStrength;
        const frontEvaluation = game.evaluateThreeCardHand(arrangement.front);
        if (game.compareTuples(backStrength, middleStrength) < 0) problems.push('back weaker than middle');
        if (game.compareTuples(middleStrength, frontEvaluation.handStrength) < 0) problems.push('middle weaker than front');
        if (arrangement.front.length === 5 && frontEvaluation.handType < 5) problems.push('5-card front below a straight');
    }

    // Every input card exactly once; naturals unchanged; wilds in rows set and listed; wilds in discards still wild
    const inputById = new Map(inputCards.map((card) => [card.id, card]));
    const placedCards = rows.flat();
    const allOutputCards = [...placedCards, ...arrangement.discards];
    const outputIds = allOutputCards.map((card) => card.id).sort();
    if (outputIds.join('|') !== [...inputById.keys()].sort().join('|')) problems.push('cards lost, added or repeated');
    const assignmentById = new Map(arrangement.wildAssignments.map((assignment) => [assignment.id, assignment]));
    allOutputCards.forEach((card) => {
        const inputCard = inputById.get(card.id);
        if (!inputCard) return;
        if (inputCards.includes(card)) problems.push(`card ${card.id} is the input object, not a copy`);
        if (!inputCard.isWild) {
            if (card.isWild || card.rank !== inputCard.rank || card.suit !== inputCard.suit || card.value !== inputCard.value) {
                problems.push(`natural card ${card.id} changed`);
            }
        }
    });
    placedCards.filter((card) => inputById.get(card.id)?.isWild).forEach((card) => {
        const assignment = assignmentById.get(card.id);
        const valueFromRank = RANK_VALUES[card.rank] || Number(card.rank);
        if (card.isWild || !card.wasWild || !SUITS.includes(card.suit) || card.value !== valueFromRank) {
            problems.push(`placed wild ${card.id} not set`);
        } else if (!assignment || assignment.rank !== card.rank || assignment.suit !== card.suit) {
            problems.push(`placed wild ${card.id} does not match wildAssignments`);
        }
    });
    arrangement.discards.filter((card) => inputById.get(card.id)?.isWild).forEach((card) => {
        if (!card.isWild || assignmentById.has(card.id)) problems.push(`discarded wild ${card.id} was changed`);
    });
    const placedWildIds = placedCards.filter((card) => inputById.get(card.id)?.isWild).map((card) => card.id).sort().join('|');
    if ([...assignmentById.keys()].sort().join('|') !== placedWildIds) problems.push('wildAssignments do not match the placed wilds');

    if (arrangement.variants) {
        if (automaticType !== 'three-flush') problems.push('variants on a type other than three flush');
        if (arrangement.variants[0] !== arrangement) problems.push('variants[0] is not the arrangement');
        arrangement.variants.slice(1).forEach((variant, index) => {
            checkArrangement(game, inputCards, automaticType, variant, false).forEach((problem) => problems.push(`variant ${index + 2}: ${problem}`));
        });
        const variantStrengths = arrangement.variants.map((variant) =>
            [variant.back, variant.middle, variant.front].map((rowCards) => strengthWithoutSuits(game.evaluateHand(rowCards).handStrength)));
        for (let index = 1; index < variantStrengths.length; index++) {
            if (compareRowLists(variantStrengths[index - 1], variantStrengths[index]) < 0) problems.push(`variant ${index + 1} stronger than variant ${index}`);
        }
    }
    return problems;
}

function checkHand(game, cards, expectation) {
    const problems = [];
    const inputSnapshot = JSON.stringify(cards);
    const startTime = process.hrtime.bigint();
    const automaticsFound = game.findAutomatics(cards);
    const microseconds = Number(process.hrtime.bigint() - startTime) / 1000;
    if (JSON.stringify(cards) !== inputSnapshot) problems.push('input cards changed');

    const oracleAnswer = oracle(cards, true);
    AUTOMATIC_TYPES.forEach((automaticType) => {
        const found = Boolean(automaticsFound.automatics[automaticType]);
        if (found !== oracleAnswer.present[automaticType]) problems.push(`${automaticType}: found ${found}, oracle ${oracleAnswer.present[automaticType]}`);
    });
    const oracleBest = AUTOMATIC_TYPES.find((automaticType) => oracleAnswer.present[automaticType]) || null;
    if (automaticsFound.best !== oracleBest) problems.push(`best ${automaticsFound.best}, oracle ${oracleBest}`);

    AUTOMATIC_TYPES.forEach((automaticType) => {
        const arrangement = automaticsFound.automatics[automaticType];
        if (!arrangement) return;
        checkArrangement(game, cards, automaticType, arrangement, automaticType === automaticsFound.best)
            .forEach((problem) => problems.push(`${automaticType}: ${problem}`));
    });
    const fullHouses = automaticsFound.automatics['three-full-houses'];
    if (fullHouses && oracleAnswer.strongestFullHouses) {
        const foundRows = [fullHouses.back, fullHouses.middle, fullHouses.front].map(fullHouseRowValues);
        if (compareRowLists(foundRows, oracleAnswer.strongestFullHouses) !== 0) {
            problems.push(`three full houses ${JSON.stringify(foundRows)}, strongest is ${JSON.stringify(oracleAnswer.strongestFullHouses)}`);
        }
    }

    if (expectation) {
        if ('best' in expectation && automaticsFound.best !== expectation.best) problems.push(`expected best ${expectation.best}, got ${automaticsFound.best}`);
        (expectation.mustHave || []).forEach((automaticType) => { if (!automaticsFound.automatics[automaticType]) problems.push(`expected ${automaticType}`); });
        (expectation.mustNotHave || []).forEach((automaticType) => { if (automaticsFound.automatics[automaticType]) problems.push(`unexpected ${automaticType}`); });
        if (expectation.variants && !(automaticsFound.automatics['three-flush']?.variants?.length > 1)) problems.push('expected three-flush variants');
    }
    return { problems, microseconds, automaticsFound };
}

function runBuiltHands(game, report) {
    let failures = 0;
    BUILT_HANDS.forEach((builtHand) => {
        const { problems, automaticsFound } = checkHand(game, parseHand(builtHand.hand), builtHand);
        if (problems.length) failures++;
        if (report) {
            const variantCount = automaticsFound.best === 'three-flush' && automaticsFound.automatics['three-flush'].variants?.length;
            report(`${problems.length ? 'FAIL' : 'ok  '}  ${builtHand.name}: best ${automaticsFound.best}${variantCount ? `, ${variantCount} variants` : ''}`);
            problems.forEach((problem) => report(`        ${problem}`));
        }
    });
    return failures;
}

function runRandomHands(game, wildCount, handCount, report) {
    game.setWildCount(wildCount);
    const tally = { hands: 0, failures: 0, totalMicroseconds: 0, maxMicroseconds: 0, timings: [], foundByType: {}, failureExamples: [] };
    AUTOMATIC_TYPES.forEach((automaticType) => { tally.foundByType[automaticType] = 0; });
    let handsWithAny = 0;
    for (let handIndex = 0; handIndex < handCount; handIndex++) {
        const cards = game.createDeck().slice(0, 17);
        const { problems, microseconds, automaticsFound } = checkHand(game, cards, null);
        tally.hands++;
        tally.totalMicroseconds += microseconds;
        tally.maxMicroseconds = Math.max(tally.maxMicroseconds, microseconds);
        tally.timings.push(microseconds);
        AUTOMATIC_TYPES.forEach((automaticType) => { if (automaticsFound.automatics[automaticType]) tally.foundByType[automaticType]++; });
        if (automaticsFound.best) handsWithAny++;
        if (problems.length) {
            tally.failures++;
            if (tally.failureExamples.length < FAILURES_SHOWN) tally.failureExamples.push(`${handText(cards)}\n        ${problems.join('\n        ')}`);
        }
    }
    if (report) {
        tally.timings.sort((a, b) => a - b);
        const percentile99 = tally.timings[Math.floor(tally.timings.length * 0.99)];
        const perMillion = (count) => String(Math.round(count / handCount * 1e6)).padStart(7);
        report(`${wildCount} wilds  ${String(handCount).padStart(7)} hands  ${String(handCount - tally.failures).padStart(7)} agree  ` +
            `${AUTOMATIC_TYPES.map((automaticType) => perMillion(tally.foundByType[automaticType])).join(' ')}  ${perMillion(handsWithAny)}  ` +
            `${(tally.totalMicroseconds / handCount).toFixed(1).padStart(6)}  ${percentile99.toFixed(0).padStart(6)}  ${tally.maxMicroseconds.toFixed(0).padStart(6)}  ` +
            `${tally.failures ? 'FAIL' : 'ok'}`);
        tally.failureExamples.forEach((example) => report(`    ${example}`));
    }
    return tally.failures;
}

function main() {
    const handCount = Number(process.argv.find((argument) => /^\d+$/.test(argument))) || 300000;
    const runBugChecks = process.argv.includes('--bug-checks');
    const report = (line) => console.log(line);
    let allPass = true;

    const game = loadGame(null);
    report('Built hands');
    if (runBuiltHands(game, report) > 0) allPass = false;

    report(`\nRandom 17-card hands (per million: hands with each automatic; times in microseconds per findAutomatics call)`);
    report('wilds    hands      agree  fullhse  dragon straight   flush    any   avg µs  p99 µs  max µs');
    [0, 1, 2].forEach((wildCount) => { if (runRandomHands(game, wildCount, handCount, report) > 0) allPass = false; });

    if (runBugChecks) {
        report(`\nBug checks (built hands + ${BUG_CHECK_HANDS} random hands at 2 wilds; each must fail)`);
        BUG_CHECKS.forEach(([name, find, replacement]) => {
            let caught = 0;
            try {
                const brokenGame = loadGame({ name, find, replacement });
                caught = runBuiltHands(brokenGame, null) + runRandomHands(brokenGame, 2, BUG_CHECK_HANDS, null);
            } catch (error) {
                if (error.message.startsWith('Bug check')) {
                    report(`FAIL  ${name}: ${error.message}`);
                    allPass = false;
                    return;
                }
                caught = 1;
            }
            if (caught === 0) allPass = false;
            report(`${caught > 0 ? 'ok  ' : 'FAIL'}  ${name}: ${caught > 0 ? `caught (${caught} failing hands)` : 'NOT caught'}`);
        });
    }

    report(allPass ? '\nALL CHECKS PASS' : '\nSOME CHECKS FAILED');
    process.exit(allPass ? 0 : 1);
}

main();
