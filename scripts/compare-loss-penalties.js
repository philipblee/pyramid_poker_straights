// Compare formula netEV's static loss penalties with the expected loss implied by the CDF arrays.
// Usage: node scripts/compare-loss-penalties.js [--cdf-arrays data/cdf_arrays_netev.json] [--out data/<file>.csv]
//
// Static side: ScoringUtilities.lossPenalty (js/hands/scoring-utilities.js), used by netEVFromWinRate as
//   netEV = p * points - (1 - p) * penalty, so the penalty is the points lost per lost comparison.
//   Also backed out of data/netEV_lookup_table.csv per row: penalty = (p * points - netev) / (1 - p), p = wins / total.
// cdf side, per rank key at focal wild count w (the opponent mix cdf uses for that w, from the arrays):
//   expected loss = pointsAbove + 0.5 * equal * points (cdf's lookup, ties split), loss probability = 1 - winProb,
//   loss per loss = expected loss / loss probability (the quantity comparable to the static penalty).
// Aggregated by (position, hand type), weighted by each key's mass in the w0 arrays (the mix of hands all players
//   put in that position, used as the dealing frequency for every w). Per cell: mean, min, max and weighted
//   standard deviation of the expected loss across ranks, and loss per loss = mean expected loss / mean loss probability.
// Static expected loss is mean loss probability (cdf's) * penalty, so the static/cdf ratio equals penalty / loss per loss.
// Upgrade deltas compare adjacent hand types present in a position.
// Writes one CSV (row_kind type or upgrade); it is not added to git.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CdfLookupTable } = require('../js/utilities/cdf-lookup.js');

const REPO = path.resolve(__dirname, '..');
const POSITIONS = ['back', 'middle', 'front'];
const WILD_COUNTS = [0, 1, 2];
const HAND_TYPE_NAMES = {
    1: 'High Card', 2: 'Pair', 3: 'Two Pair', 4: 'Three of a Kind', 5: 'Straight', 6: 'Flush', 7: 'Full House',
    8: 'Four of a Kind', 9: 'Straight Flush', 10: 'Five of a Kind', 11: '6-card Straight Flush', 12: 'Six of a Kind',
    13: '7-card Straight Flush', 14: 'Seven of a Kind', 15: '8-card Straight Flush', 16: 'Eight of a Kind'
};

function argValue(flag) {
    const flagIndex = process.argv.indexOf(flag);
    return flagIndex === -1 || flagIndex + 1 >= process.argv.length ? null : process.argv[flagIndex + 1];
}

// The game's ScoringUtilities class (static lossPenalty), loaded as the browser would
function loadScoringUtilities() {
    global.window = global;
    vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js', 'hands', 'scoring-utilities.js'), 'utf8'), { filename: 'scoring-utilities.js' });
    return ScoringUtilities;
}

// Per (position, type): implied penalty from netEV_lookup_table.csv rows with 0 < p < 1
function tableImpliedPenalties(cdfTable) {
    const tableLines = fs.readFileSync(path.join(REPO, 'data', 'netEV_lookup_table.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
    const penaltiesByCell = new Map();
    for (const tableLine of tableLines) {
        const lineMatch = tableLine.match(/^(\w+),"\(([^)]*)\)",(\d+),(\d+),([-\d.]+)$/);
        if (!lineMatch) throw new Error(`Unexpected netEV_lookup_table.csv line: ${tableLine}`);
        const [, position, tupleText, winsText, totalText, netEVText] = lineMatch;
        const handType = Number(tupleText.split(',')[0]);
        const winRate = Number(winsText) / Number(totalText);
        if (!(winRate > 0 && winRate < 1)) continue;
        const impliedPenalty = (winRate * cdfTable.handPoints(position, handType) - Number(netEVText)) / (1 - winRate);
        const cellKey = `${position}:${handType}`;
        if (!penaltiesByCell.has(cellKey)) penaltiesByCell.set(cellKey, []);
        penaltiesByCell.get(cellKey).push(impliedPenalty);
    }
    return penaltiesByCell;
}

// Mass-weighted loss statistics per (position, type) at focal wild count w
function lossCells(cdfTable, position, wildCount) {
    const { sortedKeys, massArrays } = cdfTable.positionMassArrays(position, wildCount);
    const dealingWeights = cdfTable.positionMassArrays(position, 0).massArrays.equal;
    const keysByType = new Map();
    sortedKeys.forEach((rankKey, keyIndex) => {
        const handType = rankKey[0];
        if (!keysByType.has(handType)) keysByType.set(handType, []);
        const keyPoints = cdfTable.handPoints(position, handType);
        const expectedLoss = massArrays.pointsAbove[keyIndex] + 0.5 * massArrays.equal[keyIndex] * keyPoints;
        const lossProbability = 1 - (massArrays.below[keyIndex] + 0.5 * massArrays.equal[keyIndex]);
        keysByType.get(handType).push({ expectedLoss, lossProbability, dealingWeight: dealingWeights[keyIndex] });
    });
    return [...keysByType.entries()].sort(([typeA], [typeB]) => typeA - typeB).map(([handType, typeKeys]) => {
        const totalWeight = typeKeys.reduce((sum, typeKey) => sum + typeKey.dealingWeight, 0);
        const weightOf = (typeKey) => totalWeight > 0 ? typeKey.dealingWeight / totalWeight : 1 / typeKeys.length;
        const meanLoss = typeKeys.reduce((sum, typeKey) => sum + weightOf(typeKey) * typeKey.expectedLoss, 0);
        const meanLossProbability = typeKeys.reduce((sum, typeKey) => sum + weightOf(typeKey) * typeKey.lossProbability, 0);
        const lossVariance = typeKeys.reduce((sum, typeKey) => sum + weightOf(typeKey) * (typeKey.expectedLoss - meanLoss) ** 2, 0);
        return {
            handType,
            keyCount: typeKeys.length,
            dealtShare: totalWeight,
            meanLoss,
            minLoss: Math.min(...typeKeys.map((typeKey) => typeKey.expectedLoss)),
            maxLoss: Math.max(...typeKeys.map((typeKey) => typeKey.expectedLoss)),
            lossStandardDeviation: Math.sqrt(lossVariance),
            meanLossProbability,
            lossPerLoss: meanLossProbability > 0 ? meanLoss / meanLossProbability : null
        };
    });
}

function formatFixed(value, digits = 3, width = 8) {
    return (value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits)).padStart(width);
}

function compareLossPenalties() {
    const cdfArraysPath = path.resolve(REPO, argValue('--cdf-arrays') || 'data/cdf_arrays_netev.json');
    const cdfTable = new CdfLookupTable();
    cdfTable.loadFromFile(cdfArraysPath);
    const scoringUtilities = loadScoringUtilities();
    const impliedPenalties = tableImpliedPenalties(cdfTable);
    const runLabel = `${cdfTable.cdfJson.meta.run}${cdfTable.cdfJson.meta.mode === 'noauto' ? '_noauto' : ''}`;
    const outPath = path.resolve(REPO, argValue('--out') || `data/cdf_loss_vs_static_penalty_${runLabel}.csv`);

    const csvRows = [['row_kind', 'position', 'w', 'hand_type', 'hand_name', 'to_hand_type', 'to_hand_name', 'keys', 'dealt_share',
        'static_penalty', 'table_implied_penalty_mean', 'table_implied_penalty_min', 'table_implied_penalty_max',
        'cdf_loss_mean', 'cdf_loss_min', 'cdf_loss_max', 'cdf_loss_sd', 'cdf_loss_probability', 'cdf_loss_per_loss',
        'static_expected_loss', 'difference_static_minus_cdf', 'ratio_static_over_cdf'].join(',')];
    const round6 = (value) => value === null || !Number.isFinite(value) ? '' : Number(value.toFixed(6));

    console.log(`CDF arrays ${path.relative(REPO, cdfArraysPath)} (${cdfTable.cdfJson.meta.run}, ${cdfTable.cdfJson.meta.mode});` +
        ' static penalty from ScoringUtilities.lossPenalty; table = penalty backed out of data/netEV_lookup_table.csv');
    console.log('loss = pointsAbove + 0.5*equal*points per opponent; loss/L = loss per lost comparison (compare with penalty);' +
        ' static E = cdf loss probability * penalty; diff and ratio are static E vs cdf mean loss');

    for (const position of POSITIONS) {
        for (const wildCount of WILD_COUNTS) {
            const cells = lossCells(cdfTable, position, wildCount);
            console.log(`\n${position} w${wildCount}`);
            console.log('  type                     keys  dealt  penalty   table   loss mean    min      max      sd   P(loss)  loss/L  static E   diff   ratio');
            for (const cell of cells) {
                const staticPenalty = scoringUtilities.lossPenalty(cell.handType, position);
                const tablePenalties = impliedPenalties.get(`${position}:${cell.handType}`) || [];
                const tablePenaltyMean = tablePenalties.length ? tablePenalties.reduce((sum, penalty) => sum + penalty, 0) / tablePenalties.length : null;
                const staticExpectedLoss = cell.meanLossProbability * staticPenalty;
                const difference = staticExpectedLoss - cell.meanLoss;
                const ratio = cell.meanLoss > 0 ? staticExpectedLoss / cell.meanLoss : null;
                Object.assign(cell, { staticPenalty, staticExpectedLoss });
                console.log(`  ${`${cell.handType} ${HAND_TYPE_NAMES[cell.handType]}`.padEnd(23)} ${String(cell.keyCount).padStart(5)} ${formatFixed(100 * cell.dealtShare, 1, 5)}%` +
                    ` ${formatFixed(staticPenalty, 1, 7)} ${formatFixed(tablePenaltyMean, 2, 7)} ${formatFixed(cell.meanLoss, 3, 10)}` +
                    ` ${formatFixed(cell.minLoss)} ${formatFixed(cell.maxLoss)} ${formatFixed(cell.lossStandardDeviation, 3, 7)}` +
                    ` ${formatFixed(cell.meanLossProbability, 3, 8)} ${formatFixed(cell.lossPerLoss, 2, 7)} ${formatFixed(staticExpectedLoss, 3, 9)}` +
                    ` ${formatFixed(difference, 3, 7)} ${formatFixed(ratio, 2, 7)}`);
                csvRows.push(['type', position, wildCount, cell.handType, HAND_TYPE_NAMES[cell.handType], '', '', cell.keyCount, round6(cell.dealtShare),
                    staticPenalty, round6(tablePenaltyMean), round6(tablePenalties.length ? Math.min(...tablePenalties) : null),
                    round6(tablePenalties.length ? Math.max(...tablePenalties) : null), round6(cell.meanLoss), round6(cell.minLoss),
                    round6(cell.maxLoss), round6(cell.lossStandardDeviation), round6(cell.meanLossProbability), round6(cell.lossPerLoss),
                    round6(staticExpectedLoss), round6(difference), round6(ratio)].map((field) => `"${field}"`).join(','));
            }

            console.log('  upgrades                                 penalty delta  loss/L delta   static E delta  cdf loss delta');
            for (let cellIndex = 1; cellIndex < cells.length; cellIndex++) {
                const fromCell = cells[cellIndex - 1];
                const toCell = cells[cellIndex];
                const penaltyDelta = toCell.staticPenalty - fromCell.staticPenalty;
                const lossPerLossDelta = toCell.lossPerLoss - fromCell.lossPerLoss;
                const staticExpectedDelta = toCell.staticExpectedLoss - fromCell.staticExpectedLoss;
                const cdfLossDelta = toCell.meanLoss - fromCell.meanLoss;
                console.log(`  ${`${HAND_TYPE_NAMES[fromCell.handType]} -> ${HAND_TYPE_NAMES[toCell.handType]}`.padEnd(40)}` +
                    ` ${formatFixed(penaltyDelta, 2, 13)} ${formatFixed(lossPerLossDelta, 2, 13)} ${formatFixed(staticExpectedDelta, 3, 16)} ${formatFixed(cdfLossDelta, 3, 15)}`);
                csvRows.push(['upgrade', position, wildCount, fromCell.handType, HAND_TYPE_NAMES[fromCell.handType], toCell.handType,
                    HAND_TYPE_NAMES[toCell.handType], '', '', penaltyDelta, '', '', '', round6(cdfLossDelta), '', '', '', '',
                    round6(lossPerLossDelta), round6(staticExpectedDelta), round6(staticExpectedDelta - cdfLossDelta), ''].map((field) => `"${field}"`).join(','));
            }
        }
    }

    fs.writeFileSync(outPath, csvRows.join('\n') + '\n');
    console.log(`\nWrote ${path.relative(REPO, outPath)} (${csvRows.length - 1} rows; upgrade rows hold deltas: static_penalty = penalty delta,` +
        ' cdf_loss_mean = cdf loss delta, cdf_loss_per_loss = loss/L delta, static_expected_loss = static E delta)');
}

if (require.main === module) compareLossPenalties();

module.exports = { compareLossPenalties };
