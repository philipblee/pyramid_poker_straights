// Compare js/heuristics/recommend-play-or-surrender.js with the Python rule D, hand by hand.
// Run pyramid_poker_analysis/scripts/export_rule_d_decisions.py first, then:
//   node scripts/verify-recommend-play-or-surrender.js [path to rule_d_decisions.csv]
// Checks every row's decision and exact reason list (expected reasons are built from the Python features, not the JS),
// the reversed hand, that the input is not changed, the published 156/500, 345/1,395 and 0.316 counts, the wrong-size
// error, and that the verifier's cards match createDeck. Exits 1 on any mismatch.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_EXPORT_CSV = path.resolve(REPO, '..', 'pyramid_poker_analysis', 'data', 'selfplay', 'rule_d_decisions.csv');
const GAME_FILES = ['js/utils.js', 'js/utilities/analysis.js', 'js/hands/card-utilities.js', 'js/heuristics/recommend-play-or-surrender.js'];
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const MISMATCHES_SHOWN = 20;
const SOURCE_GROUPS = [
    ['rollout 500 file', (row) => row.source === 'rollout_500'],
    ['rollout 1,200 file', (row) => row.source === 'rollout_1200'],
    ['rollout, all 1,700', (row) => row.source.startsWith('rollout')],
    ['replay, no wild', (row) => row.source.startsWith('replay') && row.wild_count === '0'],
    ['replay, one wild', (row) => row.source.startsWith('replay') && row.wild_count === '1'],
    ['replay, two wilds', (row) => row.source.startsWith('replay') && row.wild_count === '2'],
    ['replay, all seats', (row) => row.source.startsWith('replay')],
    ['built hands', (row) => row.source === 'built']
];

function loadGameFiles() {
    global.window = global;
    GAME_FILES.forEach((relativePath) => {
        vm.runInThisContext(fs.readFileSync(path.join(REPO, relativePath), 'utf8'), { filename: relativePath });
    });
}

// Same quoted-comma handling as scripts/deal-lookup-rounds.js parseCsvLine (that script runs on require, so it cannot be imported)
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

function readExportRows(exportCsvPath) {
    const lines = fs.readFileSync(exportCsvPath, 'utf8').trim().split(/\r?\n/);
    const columns = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const fields = parseCsvLine(line);
        if (fields.length !== columns.length) throw new Error(`Bad row: ${line}`);
        return Object.fromEntries(columns.map((column, columnIndex) => [column, fields[columnIndex]]));
    });
}

function cardsFromHandText(handText) {
    return handText.split(' ').map((cardText, cardIndex) => {
        if (cardText === 'W') return { suit: '🃏', rank: '🃏', value: 15, id: `WILD_JOKER_${cardIndex}`, isWild: true };
        const rank = cardText.slice(1);
        const suit = SUIT_SYMBOLS[cardText[0]];
        return { suit, rank, value: Analysis.getRankValue(rank), id: `${rank}${suit}_${cardIndex}`, isWild: false };
    });
}

// The reason list the approved table gives for a row's Python features
function expectedReasons(row) {
    if (row.wild_count === '1') return ['One wild card in the 13'];
    if (row.wild_count === '2') return ['Two wild cards in the 13'];
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

function isOneTrip(row) {
    return row.trips === '1' && row.four_plus === 'False' && row.made_sf === 'False';
}

function checkRow(row) {
    const thirteenCards = cardsFromHandText(row.hand);
    const cardsBefore = JSON.stringify(thirteenCards);
    const recommendation = recommendPlayOrSurrender(thirteenCards);
    const reversedRecommendation = recommendPlayOrSurrender([...thirteenCards].reverse());
    const reasonsWanted = JSON.stringify(expectedReasons(row));
    return {
        row,
        decision: recommendation.decision,
        reasons: recommendation.reasons,
        decisionAgrees: recommendation.decision === row.python_decision,
        reasonsAgree: JSON.stringify(recommendation.reasons) === reasonsWanted,
        reversedAgrees: JSON.stringify(reversedRecommendation) === JSON.stringify(recommendation),
        inputUnchanged: JSON.stringify(thirteenCards) === cardsBefore
    };
}

function printAgreement(checks) {
    console.log(`\n${'set'.padEnd(22)} ${'hands'.padStart(6)} ${'decision'.padStart(8)} ${'reasons'.padStart(8)} ${'reversed'.padStart(8)} ${'unchanged'.padStart(9)} ${'plays'.padStart(6)}`);
    SOURCE_GROUPS.forEach(([groupName, inGroup]) => {
        const groupChecks = checks.filter((check) => inGroup(check.row));
        const agreeing = (flag) => groupChecks.filter((check) => check[flag]).length;
        const playRate = groupChecks.filter((check) => check.decision === 'play').length / groupChecks.length;
        console.log(`${groupName.padEnd(22)} ${String(groupChecks.length).padStart(6)} ${String(agreeing('decisionAgrees')).padStart(8)} ${String(agreeing('reasonsAgree')).padStart(8)} ${String(agreeing('reversedAgrees')).padStart(8)} ${String(agreeing('inputUnchanged')).padStart(9)} ${playRate.toFixed(3).padStart(6)}`);
    });
}

function printPublishedCounts(checks) {
    const plays = (rows) => rows.filter((check) => check.decision === 'play').length;
    const fileChecks = checks.filter((check) => check.row.source === 'rollout_500');
    const oneTripInFile = fileChecks.filter((check) => isOneTrip(check.row));
    const oneTripAll = [...oneTripInFile, ...checks.filter((check) => check.row.source === 'rollout_1200')];
    const otherPlays = plays(fileChecks) - plays(oneTripInFile);
    const oneTripWeight = oneTripInFile.length / oneTripAll.length;
    const combinedShare = (otherPlays + plays(oneTripAll) * oneTripWeight) / fileChecks.length;
    console.log(`\nPublished counts from the JS: ${plays(fileChecks)}/${fileChecks.length} (want 156/500), ${plays(oneTripAll)}/${oneTripAll.length} (want 345/1395), combined ${combinedShare.toFixed(3)} (want 0.316)`);
    return plays(fileChecks) === 156 && fileChecks.length === 500 && plays(oneTripAll) === 345 && oneTripAll.length === 1395 && combinedShare.toFixed(3) === '0.316';
}

function printReasonTally(checks) {
    [['rollout, all 1,700', (row) => row.source.startsWith('rollout')], ['replay, all seats', (row) => row.source.startsWith('replay')]].forEach(([groupName, inGroup]) => {
        const reasonTally = new Map();
        checks.filter((check) => inGroup(check.row)).forEach((check) => {
            const reasonKey = `${check.decision}: ${check.reasons.join(' + ')}`;
            reasonTally.set(reasonKey, (reasonTally.get(reasonKey) || 0) + 1);
        });
        console.log(`\nReason lists, ${groupName}`);
        [...reasonTally.entries()].sort((first, second) => second[1] - first[1]).forEach(([reasonKey, handCount]) => {
            console.log(`${String(handCount).padStart(7)}  ${reasonKey}`);
        });
    });
}

function printBuiltHands(checks) {
    console.log('\nBuilt hands');
    checks.filter((check) => check.row.source === 'built').forEach((check) => {
        const status = check.decisionAgrees && check.reasonsAgree && check.reversedAgrees && check.inputUnchanged ? 'ok  ' : 'FAIL';
        console.log(`${status} ${check.decision.padEnd(9)} ${check.row.name}: ${check.reasons.join(' + ')}`);
    });
}

function wrongSizeIsRejected() {
    const twelveCards = cardsFromHandText('S2 H3 D4 C5 S6 H7 D8 C9 S10 HJ DQ CK');
    const seventeenCards = cardsFromHandText('S2 H3 D4 C5 S6 H7 D8 C9 S10 HJ DQ CK SA H2 D3 C4 S5');
    return [[], twelveCards, seventeenCards].every((wrongSizeHand) => {
        try {
            recommendPlayOrSurrender(wrongSizeHand);
            return false;
        } catch (sizeError) {
            return sizeError.message.includes('needs 13 cards');
        }
    });
}

// Every deck card, rebuilt from its letter form, must carry the same suit, rank, value and wild flag as createDeck
function verifierCardsMatchDeck() {
    const suitLetters = Object.fromEntries(Object.entries(SUIT_SYMBOLS).map(([letter, symbol]) => [symbol, letter]));
    return createDeck().every((deckCard) => {
        const cardText = deckCard.isWild ? 'W' : `${suitLetters[deckCard.suit]}${deckCard.rank}`;
        const [rebuiltCard] = cardsFromHandText(cardText);
        return ['suit', 'rank', 'value', 'isWild'].every((field) => rebuiltCard[field] === deckCard[field]);
    });
}

function main() {
    loadGameFiles();
    const exportCsvPath = path.resolve(process.argv[2] || DEFAULT_EXPORT_CSV);
    const checks = readExportRows(exportCsvPath).map(checkRow);
    console.log(`${checks.length} rows from ${exportCsvPath}`);

    printAgreement(checks);
    const publishedCountsMatch = printPublishedCounts(checks);
    printReasonTally(checks);
    printBuiltHands(checks);

    const failedChecks = checks.filter((check) => !(check.decisionAgrees && check.reasonsAgree && check.reversedAgrees && check.inputUnchanged));
    failedChecks.slice(0, MISMATCHES_SHOWN).forEach((check) => {
        console.log(`MISMATCH ${check.row.source} ${check.row.round}/${check.row.seat} ${check.row.hand}: js ${check.decision} [${check.reasons.join(' + ')}], python ${check.row.python_decision} [${expectedReasons(check.row).join(' + ')}]`);
    });
    const sizeRejected = wrongSizeIsRejected();
    const deckMatches = verifierCardsMatchDeck();
    console.log(`\nWrong-size hands rejected: ${sizeRejected}. Verifier cards match createDeck: ${deckMatches}. Failed rows: ${failedChecks.length} of ${checks.length}.`);
    if (failedChecks.length > 0 || !publishedCountsMatch || !sizeRejected || !deckMatches) process.exit(1);
    console.log('ALL CHECKS PASS');
}

main();
