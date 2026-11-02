// Summary statistics for paired method matches (scripts/deal-lookup-rounds.js --match, scripts/pool-matches.js).
// Each deal is played twice with the methods swapping seats, so every hand is played once by A and once by B.
// X(d) = average round score of an A-player over both orientations (B's is -X(d) by zero-sum).
// Per hand, Y = (score played by A - score played by B) / 2; the mean of Y over a deal's six hands is X(d).
// Per point = roundScore / 5, as in the CDF validation.

const fs = require('fs');

const MATCH_SEAT_COUNT = 6;
const POINT_DIVISOR = 5;
const WILD_COUNTS = [0, 1, 2];
const MATCH_CSV_COLUMNS = ['round', 'hand_index', 'w', 'signature_a', 'signature_b', 'same_arrangement',
    'score_a', 'orientation_a', 'score_b', 'orientation_b'];

// Mean, standard error (sample sd / sqrt(n)), t-stat and sign shares of a list of values
function meanStatistics(values) {
    const count = values.length;
    const mean = count > 0 ? values.reduce((total, value) => total + value, 0) / count : null;
    const variance = count > 1 ? values.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1) : null;
    const standardError = variance === null ? null : Math.sqrt(variance / count);
    return {
        count,
        mean,
        standardError,
        tStat: standardError ? mean / standardError : null,
        sharePositive: count > 0 ? values.filter((value) => value > 0).length / count : null,
        shareZero: count > 0 ? values.filter((value) => value === 0).length / count : null,
        shareNegative: count > 0 ? values.filter((value) => value < 0).length / count : null
    };
}

function perPoint(statistics) {
    return {
        mean: statistics.mean === null ? null : statistics.mean / POINT_DIVISOR,
        standardError: statistics.standardError === null ? null : statistics.standardError / POINT_DIVISOR,
        tStat: statistics.tStat
    };
}

function differentArrangementShare(handRows) {
    return handRows.length > 0 ? handRows.filter((handRow) => !handRow.sameArrangement).length / handRows.length : null;
}

// handRows: one row per (round, hand) with w, scoreA, scoreB, sameArrangement
function matchSummary(handRows) {
    const handsByRound = new Map();
    for (const handRow of handRows) {
        if (!handsByRound.has(handRow.round)) handsByRound.set(handRow.round, []);
        handsByRound.get(handRow.round).push(handRow);
    }
    const dealAverages = [...handsByRound.entries()].sort(([roundA], [roundB]) => roundA - roundB).map(([round, roundHands]) => {
        if (roundHands.length !== MATCH_SEAT_COUNT) throw new Error(`Round ${round} has ${roundHands.length} hands, expected ${MATCH_SEAT_COUNT}`);
        return roundHands.reduce((total, handRow) => total + handRow.scoreA, 0) / MATCH_SEAT_COUNT;
    });
    const roundScore = meanStatistics(dealAverages);

    const byWildCount = {};
    for (const wildCount of WILD_COUNTS) {
        const wildHands = handRows.filter((handRow) => handRow.w === wildCount);
        const pairedDifference = meanStatistics(wildHands.map((handRow) => (handRow.scoreA - handRow.scoreB) / 2));
        byWildCount[wildCount] = {
            hands: wildHands.length,
            pairedDifference,
            pairedDifferencePerPoint: perPoint(pairedDifference),
            differentArrangementShare: differentArrangementShare(wildHands)
        };
    }

    return {
        deals: dealAverages.length,
        hands: handRows.length,
        roundScore,
        perPoint: perPoint(roundScore),
        differentArrangementShare: differentArrangementShare(handRows),
        byWildCount,
        byWildCountNote: 'per-hand Y = (A score - B score) / 2; standard errors treat hands as independent, though the six hands of a deal are not'
    };
}

function formatNumber(value, digits = 4) {
    return value === null || value === undefined ? 'n/a' : value.toFixed(digits);
}

function formatShare(value) {
    return value === null || value === undefined ? 'n/a' : `${(100 * value).toFixed(1)}%`;
}

function formatMatchSummary(summary) {
    const { roundScore } = summary;
    const summaryLines = [
        `Deals ${summary.deals}, hands ${summary.hands}`,
        `X (A-player round score, both orientations): mean ${formatNumber(roundScore.mean)}, SE ${formatNumber(roundScore.standardError)},` +
            ` t ${formatNumber(roundScore.tStat, 2)}; per point mean ${formatNumber(summary.perPoint.mean)}, SE ${formatNumber(summary.perPoint.standardError)}`,
        `Deals X>0 ${formatShare(roundScore.sharePositive)}, X=0 ${formatShare(roundScore.shareZero)}, X<0 ${formatShare(roundScore.shareNegative)};` +
            ` hands with different arrangements ${formatShare(summary.differentArrangementShare)}`
    ];
    for (const wildCount of WILD_COUNTS) {
        const wildSummary = summary.byWildCount[wildCount];
        const pairedDifference = wildSummary.pairedDifference;
        summaryLines.push(`  w=${wildCount}: hands ${wildSummary.hands}, Y mean ${formatNumber(pairedDifference.mean)}, SE ${formatNumber(pairedDifference.standardError)},` +
            ` t ${formatNumber(pairedDifference.tStat, 2)}, per point ${formatNumber(wildSummary.pairedDifferencePerPoint.mean)};` +
            ` Y>0 ${formatShare(pairedDifference.sharePositive)}, Y=0 ${formatShare(pairedDifference.shareZero)};` +
            ` different arrangements ${formatShare(wildSummary.differentArrangementShare)}`);
    }
    return summaryLines.join('\n');
}

function matchCsvText(handRows) {
    const csvLines = handRows.map((handRow) => [
        handRow.round, handRow.handIndex, handRow.w, `"${handRow.signatureA}"`, `"${handRow.signatureB}"`,
        handRow.sameArrangement ? 1 : 0, handRow.scoreA, handRow.orientationA, handRow.scoreB, handRow.orientationB
    ].join(','));
    return [MATCH_CSV_COLUMNS.join(','), ...csvLines].join('\n') + '\n';
}

// Parse a match CSV back into hand rows (signatures are quoted and contain no commas or quotes)
function readMatchCsv(csvPath) {
    const csvLines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
    if (csvLines[0] !== MATCH_CSV_COLUMNS.join(',')) throw new Error(`${csvPath}: unexpected header ${csvLines[0]}`);
    return csvLines.slice(1).map((csvLine) => {
        const fields = csvLine.split(',');
        return {
            round: Number(fields[0]),
            handIndex: Number(fields[1]),
            w: Number(fields[2]),
            signatureA: fields[3].replace(/"/g, ''),
            signatureB: fields[4].replace(/"/g, ''),
            sameArrangement: fields[5] === '1',
            scoreA: Number(fields[6]),
            orientationA: fields[7],
            scoreB: Number(fields[8]),
            orientationB: fields[9]
        };
    });
}

module.exports = { matchSummary, formatMatchSummary, matchCsvText, readMatchCsv, MATCH_SEAT_COUNT };
