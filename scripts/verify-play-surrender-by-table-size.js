// Compare recommendPlayOrSurrender(thirteenCards, seatCount) with Python, hand by hand, at 2 to 6 seats.
// Run pyramid_poker_analysis/scripts/export_play_surrender_cell_table.py first, then:
//   node scripts/verify-play-surrender-by-table-size.js [--bug-checks] [path to play_surrender_by_table_size.csv]
// For every row and seat count: decision against Python's, the exact reason list (built here from Python's features, not
// the JS), the base-cell key against Python's key, the reversed hand, and that the input is not changed. Also: 6 seats
// equals rule D, seat counts other than 2-6 throw, and the verifier's cards match createDeck.
// --bug-checks also runs deliberately broken copies of the JS, each of which must fail. Exits 1 on any failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_HANDS_CSV = path.resolve(REPO, '..', 'pyramid_poker_analysis', 'data', 'selfplay', 'play_surrender_by_table_size.csv');
const RECOMMEND_FILE = 'js/heuristics/recommend-play-or-surrender.js';
const GAME_FILES = ['js/utils.js', 'js/utilities/analysis.js', 'js/hands/card-utilities.js', 'js/heuristics/play-surrender-cell-table.js',
    RECOMMEND_FILE];
const SEAT_COUNTS = [2, 3, 4, 5, 6];
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const MISMATCHES_SHOWN = 15;
const SOURCE_GROUPS = [
    ['rollout, all 1,700', (row) => row.source.startsWith('rollout')],
    ['replay, no wild', (row) => row.source.startsWith('replay') && row.wild_count === '0'],
    ['replay, one wild', (row) => row.source.startsWith('replay') && row.wild_count === '1'],
    ['replay, two wilds', (row) => row.source.startsWith('replay') && row.wild_count === '2'],
    ['rule D built hands', (row) => row.source === 'built'],
    ['table-size built hands', (row) => row.source === 'built_table_size']
];

// Expected wording, written out here so the reasons are checked against the approved text rather than against the JS
const SIZE_WORDS = { 3: 'Three', 4: 'Four', 5: 'Five' };
const TRIP_GROUP_TEXT = ['', '2 to 6', '7 or 8', '9 to K', 'aces'];
const DRAW_TEXT = ['no straight-flush draw', 'an inside straight-flush draw', 'an open-ended straight-flush draw'];
const PAIR_TEXT = ['no pair of 9 or higher', 'one pair of 9 or higher', 'two pairs of 9 or higher', 'three or more pairs of 9 or higher'];
const SUIT_TEXT = ['longest suit 4 cards or fewer', 'longest suit 5 cards', 'longest suit 6 cards', 'longest suit 7 or more cards'];
const CLOSE_CALL = 'Close call: the expected gain is within one standard error of zero';

const BUG_CHECKS = [
    ['longest-suit bucket off by one', RECOMMEND_FILE, 'longestSuitLength - 4', 'longestSuitLength - 3'],
    ['trip 9s placed in the 7-8 group', RECOMMEND_FILE, 'highestTripValue <= 8 ? 2', 'highestTripValue <= 9 ? 2'],
    ['pairs of 9+ counted from 8', RECOMMEND_FILE, 'Analysis.getRankValue(pairRank) >= 9', 'Analysis.getRankValue(pairRank) >= 8'],
    ['longest suit counted without duplicates', RECOMMEND_FILE, 'Math.max(...Object.values(handAnalysis.suitCounts))',
        'Math.max(...Object.values(CardUtilities.groupCardsBySuit(naturalCards)).map(suitCards => new Set(suitCards.map(card => card.value)).size))'],
    ['open-ended and inside swapped', RECOMMEND_FILE, 'hasOpenEndedDraw ? 2 : straightFlushFeatures.hasInsideDraw ? 1',
        'hasOpenEndedDraw ? 1 : straightFlushFeatures.hasInsideDraw ? 2'],
    ['lowest trip used for the rank group', RECOMMEND_FILE, 'Math.max(...tripValues)', 'Math.min(...tripValues)'],
    ['3- and 4-seat columns swapped', RECOMMEND_FILE, 'cell.plays[seatCount]', 'cell.plays[seatCount === 3 ? 4 : seatCount === 4 ? 3 : seatCount]'],
    ['6 seats routed to the lookup', RECOMMEND_FILE, 'if (seatCount === 6) return recommendByRuleD', 'if (seatCount === 7) return recommendByRuleD'],
    ['"one trip plays" used at 5 seats', RECOMMEND_FILE, 'cellKey.category === 1 && seatCount <= 4', 'cellKey.category === 1 && seatCount <= 5'],
    ['close-call line dropped', RECOMMEND_FILE, 'cell.nearLine[seatCount] ? [CLOSE_CALL_REASON] : []', '[]'],
    ['seat count 7 accepted', RECOMMEND_FILE, 'seatCount > 6)', 'seatCount > 7)'],
    ['unseen base cells fall back to fold', null, null, 'for (const key of PLAY_SURRENDER_CELL_TABLE.unseenKeys) PLAY_SURRENDER_CELL_TABLE.keyToCell[key] = 0;']
];

function loadGame(mutation) {
    const sandbox = { console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    GAME_FILES.forEach((relativePath) => {
        let source = fs.readFileSync(path.join(REPO, relativePath), 'utf8');
        if (mutation && mutation.file === relativePath) {
            if (source.split(mutation.find).length !== 2) throw new Error(`Bug check "${mutation.name}": text not found exactly once`);
            source = source.replace(mutation.find, mutation.replacement);
        }
        vm.runInContext(source, sandbox, { filename: relativePath });
    });
    if (mutation && mutation.file === null) vm.runInContext(mutation.replacement, sandbox);
    return {
        recommend: vm.runInContext('recommendPlayOrSurrender', sandbox),
        cellKey: vm.runInContext('findPlaySurrenderCellKey', sandbox),
        getRankValue: vm.runInContext('Analysis.getRankValue', sandbox),
        createDeck: vm.runInContext('createDeck', sandbox)
    };
}

// Same quoted-comma handling as scripts/verify-recommend-play-or-surrender.js
function parseCsvLine(line) {
    const fields = [];
    let currentField = '';
    let inQuotes = false;
    for (const character of line) {
        if (character === '"') {
            inQuotes = !inQuotes;
        } else if (character === ',' && !inQuotes) {
            fields.push(currentField);
            currentField = '';
        } else {
            currentField += character;
        }
    }
    fields.push(currentField);
    return fields;
}

function readRows(csvPath) {
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
    const columns = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const fields = parseCsvLine(line);
        if (fields.length !== columns.length) throw new Error(`Bad row: ${line}`);
        return Object.fromEntries(columns.map((column, columnIndex) => [column, fields[columnIndex]]));
    });
}

function cardsFromHandText(handText, getRankValue) {
    return handText.split(' ').map((cardText, cardIndex) => {
        if (cardText === 'W') return { suit: '🃏', rank: '🃏', value: 15, id: `WILD_JOKER_${cardIndex}`, isWild: true };
        const rank = cardText.slice(1);
        const suit = SUIT_SYMBOLS[cardText[0]];
        return { suit, rank, value: getRankValue(rank), id: `${rank}${suit}_${cardIndex}`, isWild: false };
    });
}

function ruleDReasons(row) {
    const tripsCount = Number(row.trips);
    const hasThreeStrongPairs = Number(row.pairs_nine_plus) >= 3;
    const hasDraw = row.open_ended === 'True' || row.inside === 'True';
    const reasons = [];
    if (row.four_plus === 'True') reasons.push('Four or more of a kind');
    if (row.made_sf === 'True') reasons.push('A made straight flush');
    if (tripsCount >= 2) reasons.push('Two or more sets of trips');
    if (tripsCount === 1 && row.open_ended === 'True') reasons.push('One trip plus an open-ended straight-flush draw');
    if (tripsCount === 1 && row.inside === 'True') reasons.push('One trip plus an inside straight-flush draw');
    if (tripsCount === 1 && hasThreeStrongPairs) reasons.push('One trip plus three or more pairs of 9 or higher');
    if (reasons.length > 0) return reasons;
    if (tripsCount === 1) return ['One trip with no second trips, fewer than three pairs of 9 or higher and no straight-flush draw'];
    reasons.push('No trips or better');
    if (hasDraw) reasons.push('A straight-flush draw without trips is not enough');
    if (hasThreeStrongPairs) reasons.push('Three or more pairs of 9 or higher without trips are not enough');
    return reasons;
}

function cellDescription(row) {
    const category = Number(row.category);
    const tripText = TRIP_GROUP_TEXT[Number(row.trip_rank_group)];
    const handKind = ['no trips', `one trip of ${tripText}`, `two or more trips, highest ${tripText}`,
        'four of a kind or a made straight flush'][category];
    return [handKind, PAIR_TEXT[Number(row.strong_pairs)], SUIT_TEXT[Number(row.longest_suit)], DRAW_TEXT[Number(row.draw)]].join(', ');
}

function expectedReasons(row, seatCount) {
    if (row.wild_count === '1') return ['One wild card in the 13'];
    if (row.wild_count === '2') return ['Two wild cards in the 13'];
    if (seatCount === 6) return ruleDReasons(row);
    if (seatCount === 2) return ['At a 2-player table, playing every hand beats surrendering'];
    const decision = row[`decision_n${seatCount}`];
    const closeCall = row[`near_line_n${seatCount}`] === 'True' ? [CLOSE_CALL] : [];
    if (decision === 'play' && row.python_decision === 'play') return [...ruleDReasons(row), ...closeCall];
    if (decision === 'play' && row.category === '1' && seatCount <= 4) return [`${SIZE_WORDS[seatCount]}-player table: one trip plays`, ...closeCall];
    return [`${SIZE_WORDS[seatCount]}-player table: ${cellDescription(row)}. Hands like this ${decision}`, ...closeCall];
}

function pythonKey(row) {
    return [row.category, row.trip_rank_group, row.draw, row.strong_pairs, row.longest_suit].join('|');
}

// One row at every seat count; returns a failure description per failed check
function checkRow(game, row, fullChecks) {
    const thirteenCards = cardsFromHandText(row.hand, game.getRankValue);
    const cardsBefore = fullChecks ? JSON.stringify(thirteenCards) : '';
    const failures = [];
    const isNatural = row.wild_count === '0';
    if (isNatural && game.cellKey(thirteenCards).text !== pythonKey(row)) {
        failures.push(`key js ${game.cellKey(thirteenCards).text} python ${pythonKey(row)}`);
    }
    const results = {};
    SEAT_COUNTS.forEach((seatCount) => {
        const recommendation = game.recommend(thirteenCards, seatCount);
        results[seatCount] = recommendation;
        if (recommendation.decision !== row[`decision_n${seatCount}`]) {
            failures.push(`n${seatCount} decision js ${recommendation.decision} python ${row[`decision_n${seatCount}`]}`);
        }
        const wanted = expectedReasons(row, seatCount);
        if (JSON.stringify(recommendation.reasons) !== JSON.stringify(wanted)) {
            failures.push(`n${seatCount} reasons js [${recommendation.reasons.join(' + ')}] want [${wanted.join(' + ')}]`);
        }
        if (fullChecks && JSON.stringify(game.recommend([...thirteenCards].reverse(), seatCount)) !== JSON.stringify(recommendation)) {
            failures.push(`n${seatCount} reversed hand differs`);
        }
    });
    if (fullChecks && JSON.stringify(thirteenCards) !== cardsBefore) failures.push('input changed');
    if (row.decision_n6 !== row.python_decision) failures.push('python n6 differs from rule D');
    return { row, failures, results };
}

function seatCountsRejected(game) {
    const hand = cardsFromHandText('S2 H3 D4 C5 S6 H7 D8 C9 S10 HJ DQ CK SA', game.getRankValue);
    const rejected = [1, 7, 0, undefined, null, '3', 3.5].every((badSeatCount) => {
        try {
            game.recommend(hand, badSeatCount);
            return false;
        } catch (seatError) {
            return seatError.message.includes('seat count from 2 to 6');
        }
    });
    const sizeRejected = [[], hand.slice(0, 12)].every((badHand) => {
        try {
            game.recommend(badHand, 4);
            return false;
        } catch (sizeError) {
            return sizeError.message.includes('needs 13 cards');
        }
    });
    return rejected && sizeRejected;
}

function verifierCardsMatchDeck(game) {
    const suitLetters = Object.fromEntries(Object.entries(SUIT_SYMBOLS).map(([letter, symbol]) => [symbol, letter]));
    return game.createDeck().every((deckCard) => {
        const cardText = deckCard.isWild ? 'W' : `${suitLetters[deckCard.suit]}${deckCard.rank}`;
        const [rebuiltCard] = cardsFromHandText(cardText, game.getRankValue);
        return ['suit', 'rank', 'value', 'isWild'].every((field) => rebuiltCard[field] === deckCard[field]);
    });
}

function printAgreement(checks) {
    console.log(`\n${'set'.padEnd(24)} ${'hands'.padStart(6)}  ${SEAT_COUNTS.map((seatCount) => `n${seatCount} agree`.padStart(9)).join(' ')}  ` +
        `${SEAT_COUNTS.map((seatCount) => `n${seatCount} play`.padStart(8)).join(' ')}`);
    SOURCE_GROUPS.forEach(([groupName, inGroup]) => {
        const groupChecks = checks.filter((check) => inGroup(check.row));
        const agreeing = SEAT_COUNTS.map((seatCount) => groupChecks
            .filter((check) => !check.failures.some((failure) => failure.startsWith(`n${seatCount} `)) &&
                !check.failures.some((failure) => failure.startsWith('key') || failure === 'input changed')).length);
        const playRates = SEAT_COUNTS.map((seatCount) => groupChecks
            .filter((check) => check.results[seatCount].decision === 'play').length / groupChecks.length);
        console.log(`${groupName.padEnd(24)} ${String(groupChecks.length).padStart(6)}  ${agreeing.map((count) => String(count).padStart(9)).join(' ')}  ` +
            `${playRates.map((rate) => rate.toFixed(3).padStart(8)).join(' ')}`);
    });
}

function printBuiltHands(checks) {
    console.log('\nTable-size built hands (decisions at 2, 3, 4, 5, 6 seats)');
    checks.filter((check) => check.row.source === 'built_table_size').forEach((check) => {
        const decisions = SEAT_COUNTS.map((seatCount) => (check.results[seatCount].decision === 'play' ? 'P' : 'F')).join('');
        console.log(`${check.failures.length === 0 ? 'ok  ' : 'FAIL'} ${decisions} key ${pythonKey(check.row)}  ${check.row.name}`);
        [3, 4, 5].forEach((seatCount) => console.log(`        n${seatCount}: ${check.results[seatCount].reasons.join(' + ')}`));
    });
}

function runBugChecks(rows) {
    console.log('\nDeliberate-bug checks (each broken copy must fail)');
    let allCaught = true;
    BUG_CHECKS.forEach(([name, file, find, replacement]) => {
        const game = loadGame({ name, file, find, replacement });
        let failedRows = 0;
        let thrown = 0;
        rows.forEach((row) => {
            try {
                if (checkRow(game, row, false).failures.length > 0) failedRows++;
            } catch (rowError) {
                thrown++;
            }
        });
        const seatCheckFails = !seatCountsRejected(game);
        const caught = failedRows + thrown > 0 || seatCheckFails;
        allCaught = allCaught && caught;
        console.log(`${caught ? 'caught ' : 'MISSED '} ${name.padEnd(42)} failed rows ${String(failedRows).padStart(6)}` +
            `${thrown ? `, rows that threw ${thrown}` : ''}${seatCheckFails ? ', seat-count check fails' : ''}`);
    });
    return allCaught;
}

function main() {
    const runBugs = process.argv.includes('--bug-checks');
    const csvArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
    const csvPath = path.resolve(csvArgument || DEFAULT_HANDS_CSV);
    const rows = readRows(csvPath);
    const game = loadGame(null);
    const checks = rows.map((row) => checkRow(game, row, true));
    console.log(`${rows.length} rows from ${csvPath}`);

    printAgreement(checks);
    printBuiltHands(checks);
    const failedChecks = checks.filter((check) => check.failures.length > 0);
    failedChecks.slice(0, MISMATCHES_SHOWN).forEach((check) => {
        console.log(`MISMATCH ${check.row.source} ${check.row.name || `${check.row.round}/${check.row.seat}`} ${check.row.hand}: ${check.failures.join('; ')}`);
    });
    const naturalRows = checks.filter((check) => check.row.wild_count === '0').length;
    const sixMatchesRuleD = checks.every((check) => check.results[6].decision === check.row.python_decision);
    const seatsRejected = seatCountsRejected(game);
    const deckMatches = verifierCardsMatchDeck(game);
    console.log(`\nBase-cell keys checked on ${naturalRows} no-wild rows. 6 seats equals rule D on all ${checks.length} rows: ${sixMatchesRuleD}. ` +
        `Bad seat counts and sizes rejected: ${seatsRejected}. Verifier cards match createDeck: ${deckMatches}. ` +
        `Failed rows: ${failedChecks.length} of ${checks.length}.`);

    const bugsCaught = runBugs ? runBugChecks(rows) : true;
    if (failedChecks.length > 0 || !sixMatchesRuleD || !seatsRejected || !deckMatches || !bugsCaught) process.exit(1);
    console.log(runBugs ? 'ALL CHECKS PASS, ALL BUGS CAUGHT' : 'ALL CHECKS PASS');
}

main();
