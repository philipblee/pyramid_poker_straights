// Compare tiered2's win probability with cdf's by (position, hand type), at w0.
// Usage: node scripts/compare-win-probabilities.js [--cdf-arrays data/cdf_arrays_netev.json] [--out data/<file>.csv]
//
// Keys: every rank key of data/cdf_arrays_netev.json per position (suit-stripped hand_rank tuples, cdf-lookup.js
//   rankKeyFromHandTuple). Each key is turned back into a complete hand_rank tuple by appending suit codes
//   (one for flush / straight flush types, one per card otherwise) and given to the game's
//   ScoringUtilities.getWinProbabilityForMethod('tiered2', position, { hand_rank, isIncomplete: false }).
//   lookupTiered2WinProbability reads only hand_rank and isIncomplete. The bare key is also looked up, to check
//   that the appended suit codes do not change the answer.
// cdf side, per key at w0: win = below + 0.5 * equal (ties half, cdfLookup.lookup), strict win = below.
// Weights: each key's w0 equal mass in its position (the w0 mix, as in scripts/compare-loss-penalties.js lossCells).
// Per (position, hand type): mass share, mass-weighted tiered2 p, cdf p (ties half), cdf p (strict),
//   tiered2 - cdf (ties half) and its min / max across keys, plus which tiered2 table level answered the keys.
// Writes one CSV; it is not added to git.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const POSITIONS = ['back', 'middle', 'front'];
const FLAG_DIFFERENCE = 0.05;
const FLAG_MASS_SHARE = 0.01;
// Numeric hand types as built in js/hands/evaluate-hand.js (5 is Flush, 6 is Straight: straights rank above flushes)
const HAND_TYPE_LABELS = {
    1: 'High Card', 2: 'Pair', 3: 'Two Pair', 4: 'Three of a Kind', 5: 'Flush', 6: 'Straight', 7: 'Full House',
    8: 'Four of a Kind', 9: 'Straight Flush', 10: 'Five of a Kind', 11: '6-card Straight Flush', 12: 'Six of a Kind',
    13: '7-card Straight Flush', 14: 'Seven of a Kind', 15: '8-card Straight Flush', 16: 'Eight of a Kind'
};
const ONE_SUIT_TYPES = new Set([5, 9, 11, 13, 15]);
const GAME_FILES = ['js/hands/hand-utilities.js', 'js/utilities/tiered2-win-probability.js', 'js/utilities/cdf-lookup.js',
    'js/hands/scoring-utilities.js'];

function argValue(flag) {
    const flagIndex = process.argv.indexOf(flag);
    return flagIndex === -1 || flagIndex + 1 >= process.argv.length ? null : process.argv[flagIndex + 1];
}

async function loadGameCode(cdfArraysPath) {
    global.window = global;
    global.fetch = async function fetchLocal(url) {
        const filePath = path.resolve(REPO, String(url).replace(/^\//, ''));
        if (!fs.existsSync(filePath)) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        const fileText = fs.readFileSync(filePath, 'utf8');
        return { ok: true, status: 200, statusText: 'OK', text: async () => fileText };
    };
    const gameSource = GAME_FILES.map((relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8')).join('\n');
    vm.runInThisContext(gameSource, { filename: 'compare-win-probabilities-game.js' });
    const tiered2Loaded = await withConsoleSilenced(() => initializeTiered2WinProbability());
    if (!tiered2Loaded) throw new Error('tiered2 table failed to load');
    cdfLookup.loadFromJson(JSON.parse(fs.readFileSync(cdfArraysPath, 'utf8')));
}

async function withConsoleSilenced(silencedCall) {
    const savedLog = console.log;
    console.log = () => {};
    try {
        return await silencedCall();
    } finally {
        console.log = savedLog;
    }
}

function cardCountForKey(position, handType) {
    if (position === 'front') return [1, 2, 4].includes(handType) ? 3 : 5;
    if (handType >= 15) return 8;
    if (handType >= 13) return 7;
    if (handType >= 11) return 6;
    return 5;
}

// Complete hand_rank tuple for a rank key: suit codes appended (spades, 4; tiered2 never reads them)
function completeTupleForKey(position, rankKey) {
    const handType = rankKey[0];
    const suitCodeCount = ONE_SUIT_TYPES.has(handType) ? 1 : cardCountForKey(position, handType);
    return [...rankKey, ...Array(suitCodeCount).fill(4)];
}

// Which tiered2 table level answers a complete tuple, following lookupTiered2WinProbability's order
function tiered2MatchLevel(position, handTuple) {
    const probabilityMap = tiered2WinProbability.probabilityMap;
    if (handTuple.length > 3 && probabilityMap.has(tiered2WinProbability.createLookupKey(position, handTuple))) return 'full tuple';
    for (let prefixLength = Math.min(handTuple.length, 3); prefixLength >= 2; prefixLength--) {
        const lookupKey = tiered2WinProbability.createLookupKey(position, handTuple.slice(0, prefixLength));
        if (probabilityMap.has(lookupKey)) return `exact ${prefixLength}`;
        if ([...probabilityMap.keys()].some((mapKey) => mapKey.startsWith(lookupKey))) return `prefix ${prefixLength}`;
    }
    return 'hardcoded or none';
}

async function keyRows(position) {
    const { sortedKeys, massArrays } = cdfLookup.positionMassArrays(position, 0);
    const rows = [];
    const unmappedKeys = [];
    const suitSensitiveKeys = [];
    await withConsoleSilenced(async () => {
        sortedKeys.forEach((rankKey, keyIndex) => {
            const handTuple = completeTupleForKey(position, rankKey);
            const tiered2Win = ScoringUtilities.getWinProbabilityForMethod('tiered2', position, { hand_rank: handTuple, isIncomplete: false });
            const bareKeyWin = ScoringUtilities.getWinProbabilityForMethod('tiered2', position, { hand_rank: rankKey, isIncomplete: false });
            if (tiered2Win == null || Number.isNaN(Number(tiered2Win))) {
                unmappedKeys.push({ rankKey, weight: massArrays.equal[keyIndex] });
                return;
            }
            if (bareKeyWin !== tiered2Win) suitSensitiveKeys.push({ rankKey, tiered2Win, bareKeyWin });
            const cdfLookedUp = cdfLookup.lookup(position, 0, rankKey);
            rows.push({
                handType: rankKey[0],
                rankKey,
                weight: massArrays.equal[keyIndex],
                tiered2Win: Number(tiered2Win),
                cdfWin: cdfLookedUp.winProb,
                cdfStrictWin: massArrays.below[keyIndex],
                matchLevel: tiered2MatchLevel(position, handTuple)
            });
        });
    });
    return { rows, unmappedKeys, suitSensitiveKeys, positionMass: massArrays.equal.reduce((sum, weight) => sum + weight, 0) };
}

function typeCells(rows, positionMass) {
    const rowsByType = new Map();
    for (const row of rows) {
        if (!rowsByType.has(row.handType)) rowsByType.set(row.handType, []);
        rowsByType.get(row.handType).push(row);
    }
    return [...rowsByType.entries()].sort(([typeA], [typeB]) => typeA - typeB).map(([handType, typeRows]) => {
        const typeMass = typeRows.reduce((sum, row) => sum + row.weight, 0);
        const weightOf = (row) => typeMass > 0 ? row.weight / typeMass : 1 / typeRows.length;
        const weightedMean = (field) => typeRows.reduce((sum, row) => sum + weightOf(row) * row[field], 0);
        const keyDifferences = typeRows.map((row) => row.tiered2Win - row.cdfWin);
        const levelCounts = {};
        for (const row of typeRows) levelCounts[row.matchLevel] = (levelCounts[row.matchLevel] || 0) + 1;
        const tiered2Mean = weightedMean('tiered2Win');
        const cdfMean = weightedMean('cdfWin');
        return {
            handType,
            keyCount: typeRows.length,
            massShare: typeMass / positionMass,
            tiered2Mean,
            cdfMean,
            cdfStrictMean: weightedMean('cdfStrictWin'),
            difference: tiered2Mean - cdfMean,
            minDifference: Math.min(...keyDifferences),
            maxDifference: Math.max(...keyDifferences),
            levelCounts
        };
    });
}

function fixed(value, digits = 3, width = 7) {
    return value.toFixed(digits).padStart(width);
}

async function compareWinProbabilities() {
    const cdfArraysPath = path.resolve(REPO, argValue('--cdf-arrays') || 'data/cdf_arrays_netev.json');
    const outPath = path.resolve(REPO, argValue('--out') || 'data/tiered2_vs_cdf_win_probability.csv');
    await loadGameCode(cdfArraysPath);

    const csvRows = [['position', 'hand_type', 'hand_type_name', 'key_count', 'mass_share', 'tiered2_p', 'cdf_p_ties_half',
        'cdf_p_strict', 'difference_tiered2_minus_cdf', 'min_key_difference', 'max_key_difference', 'tiered2_match_levels', 'flagged']];
    console.log(`tiered2 (data/tiered2_win_probability.csv) vs cdf (${path.relative(REPO, cdfArraysPath)}), w0, mass-weighted with the w0 mix`);
    console.log(`Flag *: |tiered2 - cdf| > ${FLAG_DIFFERENCE} and mass share > ${100 * FLAG_MASS_SHARE}%`);
    for (const position of POSITIONS) {
        const { rows, unmappedKeys, suitSensitiveKeys, positionMass } = await keyRows(position);
        console.log(`\n${position}: ${rows.length} keys mapped, ${unmappedKeys.length} unmapped` +
            `${unmappedKeys.length ? ` (mass ${(100 * unmappedKeys.reduce((sum, key) => sum + key.weight, 0) / positionMass).toFixed(3)}%)` : ''}` +
            `, ${suitSensitiveKeys.length} where the bare key gives a different tiered2 p`);
        for (const unmappedKey of unmappedKeys.slice(0, 10)) console.log(`  unmapped: [${unmappedKey.rankKey.join(',')}] mass ${unmappedKey.weight.toExponential(2)}`);
        if (unmappedKeys.length > 10) console.log(`  ... ${unmappedKeys.length - 10} more unmapped`);
        for (const suitSensitiveKey of suitSensitiveKeys.slice(0, 5)) {
            console.log(`  suit-sensitive: [${suitSensitiveKey.rankKey.join(',')}] full tuple ${suitSensitiveKey.tiered2Win} bare key ${suitSensitiveKey.bareKeyWin}`);
        }
        console.log('  type                     keys    mass  tiered2  cdf(.5)  cdf(strict)  t2-cdf    min     max   tiered2 levels');
        for (const cell of typeCells(rows, positionMass)) {
            const isFlagged = Math.abs(cell.difference) > FLAG_DIFFERENCE && cell.massShare > FLAG_MASS_SHARE;
            const levelText = Object.entries(cell.levelCounts).map(([level, count]) => `${level} ${count}`).join(', ');
            console.log(`${isFlagged ? '* ' : '  '}${`${cell.handType} ${HAND_TYPE_LABELS[cell.handType]}`.padEnd(23)}${String(cell.keyCount).padStart(6)}` +
                ` ${fixed(100 * cell.massShare, 2, 6)}% ${fixed(cell.tiered2Mean)} ${fixed(cell.cdfMean, 3, 8)} ${fixed(cell.cdfStrictMean, 3, 12)}` +
                ` ${fixed(cell.difference, 3, 7)} ${fixed(cell.minDifference)} ${fixed(cell.maxDifference)}   ${levelText}`);
            csvRows.push([position, cell.handType, HAND_TYPE_LABELS[cell.handType], cell.keyCount, cell.massShare.toFixed(6), cell.tiered2Mean.toFixed(6),
                cell.cdfMean.toFixed(6), cell.cdfStrictMean.toFixed(6), cell.difference.toFixed(6), cell.minDifference.toFixed(6),
                cell.maxDifference.toFixed(6), `"${levelText}"`, isFlagged ? 1 : 0]);
        }
    }
    fs.writeFileSync(outPath, csvRows.map((csvRow) => csvRow.join(',')).join('\n') + '\n');
    console.log(`\nWrote ${path.relative(REPO, outPath)}`);
}

if (require.main === module) {
    compareWinProbabilities().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { compareWinProbabilities };
