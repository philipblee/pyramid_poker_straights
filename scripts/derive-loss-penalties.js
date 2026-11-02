// Build the per (position, hand type) loss penalties for the 'netEV_derived' method and sanity-check them.
// Usage: node scripts/derive-loss-penalties.js [--cdf-arrays data/cdf_arrays_netev.json] [--out data/derived_loss_penalties.json]
//
// Penalty = cdf loss per lost comparison at w0 (scripts/compare-loss-penalties.js lossCells: mass-weighted mean
//   expected loss / mean loss probability, weights = the w0 mix of hands in that position).
// A cell is used directly when its type has at least MIN_DEALT_SHARE of the position's mass, is not a 6+ card type
//   (11-16) and is not back Two Pair; every other type 1-16 falls back to the nearest used type in the same position
//   (ties to the lower type). Every fallback is listed in the JSON and printed.
// Sanity check: for the six upgrades that drive arrangement choice, mass-weighted over the cdf keys of each type at
//   w0, the change in expected loss and in netEV under netEV_derived (the game's ScoringUtilities code, tiered2 p),
//   formula netEV (static lossPenalty, same p) and cdf.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { lossCells, HAND_TYPE_NAMES } = require('./compare-loss-penalties.js');

const REPO = path.resolve(__dirname, '..');
const POSITIONS = ['back', 'middle', 'front'];
const MIN_DEALT_SHARE = 0.005;
const EXCLUDED_CELLS = new Set(['back:3']);
const SANITY_UPGRADES = [
    ['back', 6, 7], ['middle', 3, 5], ['front', 2, 4], ['back', 7, 8], ['front', 4, 5], ['front', 5, 6]
];
const GAME_FILES = ['js/hands/hand-utilities.js', 'js/utilities/tiered2-win-probability.js', 'js/utilities/cdf-lookup.js',
    'js/utilities/derived-loss-penalties.js', 'js/hands/scoring-utilities.js'];

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
        return { ok: true, status: 200, statusText: 'OK', text: async () => fileText, json: async () => JSON.parse(fileText) };
    };
    const gameSource = GAME_FILES.map((relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8')).join('\n');
    vm.runInThisContext(gameSource, { filename: 'derive-loss-penalties-game.js' });
    const savedLog = console.log;
    console.log = () => {};
    const tiered2Loaded = await initializeTiered2WinProbability();
    console.log = savedLog;
    if (!tiered2Loaded) throw new Error('tiered2 table failed to load');
    cdfLookup.loadFromJson(JSON.parse(fs.readFileSync(cdfArraysPath, 'utf8')));
}

// Penalty table for types 1-16 per position, with fallbacks
function penaltyTable() {
    const penalties = {};
    const fallbacks = [];
    for (const position of POSITIONS) {
        const cells = lossCells(cdfLookup, position, 0);
        const usedCells = cells.filter((cell) => cell.dealtShare >= MIN_DEALT_SHARE && cell.handType <= 10 &&
            !EXCLUDED_CELLS.has(`${position}:${cell.handType}`) && Number.isFinite(cell.lossPerLoss));
        penalties[position] = {};
        for (let handType = 1; handType <= 16; handType++) {
            const ownCell = cells.find((cell) => cell.handType === handType);
            const usedCell = usedCells.find((cell) => cell.handType === handType);
            if (usedCell) {
                penalties[position][handType] = { penalty: Number(usedCell.lossPerLoss.toFixed(6)), sourceType: handType, dealtShare: Number(usedCell.dealtShare.toFixed(6)) };
                continue;
            }
            const nearestCell = [...usedCells].sort((cellA, cellB) =>
                Math.abs(cellA.handType - handType) - Math.abs(cellB.handType - handType) || cellA.handType - cellB.handType)[0];
            const reason = !ownCell ? 'no cdf keys'
                : handType >= 11 ? '6+ card hand'
                : EXCLUDED_CELLS.has(`${position}:${handType}`) ? 'excluded (low mass, noisy)'
                : `dealt share ${(100 * ownCell.dealtShare).toFixed(2)}% < ${100 * MIN_DEALT_SHARE}%`;
            penalties[position][handType] = { penalty: Number(nearestCell.lossPerLoss.toFixed(6)), sourceType: nearestCell.handType, fallback: reason,
                ownLossPerLoss: ownCell && Number.isFinite(ownCell.lossPerLoss) ? Number(ownCell.lossPerLoss.toFixed(6)) : null };
            fallbacks.push({ position, handType, sourceType: nearestCell.handType, reason, ownCell });
        }
    }
    return { penalties, fallbacks };
}

// Mass-weighted means over the cdf keys of one type at w0: expected loss and netEV under each method
function typeAverages(position, handType) {
    const { sortedKeys, massArrays } = cdfLookup.positionMassArrays(position, 0);
    const totals = { weight: 0, cdfLoss: 0, cdfNetEV: 0, derivedLoss: 0, derivedNetEV: 0, staticLoss: 0, staticNetEV: 0 };
    sortedKeys.forEach((rankKey, keyIndex) => {
        if (rankKey[0] !== handType) return;
        const weight = massArrays.equal[keyIndex];
        const hand = { hand_rank: rankKey, isIncomplete: false };
        const winRate = Number(ScoringUtilities.getWinProbabilityForMethod('tiered2', position, hand)) || 0;
        const cdfLookedUp = cdfLookup.lookup(position, 0, rankKey);
        const keyPoints = cdfLookup.handPoints(position, handType);
        totals.weight += weight;
        totals.cdfLoss += weight * (cdfLookedUp.winProb * keyPoints - cdfLookedUp.netEV);
        totals.cdfNetEV += weight * cdfLookedUp.netEV;
        totals.derivedLoss += weight * (1 - winRate) * derivedLossPenalties.penalty(position, handType);
        totals.derivedNetEV += weight * ScoringUtilities.netEVDerivedFromTiered2Rate(hand, position);
        totals.staticLoss += weight * (1 - winRate) * ScoringUtilities.lossPenalty(handType, position);
        totals.staticNetEV += weight * ScoringUtilities.netEVFromWinRate(position, handType, winRate);
    });
    return Object.fromEntries(Object.entries(totals).filter(([field]) => field !== 'weight').map(([field, total]) => [field, total / totals.weight]));
}

async function deriveLossPenalties() {
    const cdfArraysPath = path.resolve(REPO, argValue('--cdf-arrays') || 'data/cdf_arrays_netev.json');
    const outPath = path.resolve(REPO, argValue('--out') || 'data/derived_loss_penalties.json');
    await loadGameCode(cdfArraysPath);

    const { penalties, fallbacks } = penaltyTable();
    const penaltyJson = {
        meta: {
            description: 'netEV_derived loss penalty per (position, hand type): cdf expected loss per lost comparison at w0, mass-weighted with the w0 mix',
            cdfArrays: path.relative(REPO, cdfArraysPath).replace(/\\/g, '/'),
            cdfRun: cdfLookup.cdfJson.meta.run,
            cdfMode: cdfLookup.cdfJson.meta.mode,
            minDealtShare: MIN_DEALT_SHARE,
            fallbackRule: '6+ card types, back Two Pair, types without cdf keys and types under minDealtShare use the nearest used type in the same position (ties to the lower type)',
            generatedBy: 'scripts/derive-loss-penalties.js'
        },
        penalties
    };
    fs.writeFileSync(outPath, JSON.stringify(penaltyJson, null, 2) + '\n');
    derivedLossPenalties.loadFromJson(penaltyJson);

    console.log(`Wrote ${path.relative(REPO, outPath)} from ${penaltyJson.meta.cdfArrays}`);
    for (const position of POSITIONS) {
        const usedText = Object.entries(penalties[position]).filter(([, entry]) => !entry.fallback)
            .map(([handType, entry]) => `${HAND_TYPE_NAMES[handType]} ${entry.penalty.toFixed(2)}`).join(', ');
        console.log(`  ${position.padEnd(6)} ${usedText}`);
    }
    console.log(`\nFallbacks (${fallbacks.length}):`);
    for (const fallback of fallbacks) {
        const ownText = fallback.ownCell && Number.isFinite(fallback.ownCell.lossPerLoss) ? `, own value ${fallback.ownCell.lossPerLoss.toFixed(2)} not used` : '';
        console.log(`  ${fallback.position.padEnd(6)} ${String(fallback.handType).padStart(2)} ${HAND_TYPE_NAMES[fallback.handType].padEnd(22)} -> ${HAND_TYPE_NAMES[fallback.sourceType]}` +
            ` ${penalties[fallback.position][fallback.handType].penalty.toFixed(2)} (${fallback.reason}${ownText})`);
    }
    console.log('  middle w2 Five of a Kind -> 6-card Straight Flush: not used (the table uses w0 only)');

    console.log('\nSanity check, w0, mass-weighted over cdf keys; p = tiered2 win rate for netEV_derived and formula netEV');
    console.log('  upgrade                              loss delta: derived  formula      cdf   netEV delta: derived  formula      cdf   same sign');
    let allSameSign = true;
    for (const [position, fromType, toType] of SANITY_UPGRADES) {
        const fromAverages = typeAverages(position, fromType);
        const toAverages = typeAverages(position, toType);
        const delta = (field) => toAverages[field] - fromAverages[field];
        const sameSign = Math.sign(delta('derivedLoss')) === Math.sign(delta('cdfLoss')) && Math.sign(delta('derivedNetEV')) === Math.sign(delta('cdfNetEV'));
        allSameSign = allSameSign && sameSign;
        console.log(`  ${`${position} ${HAND_TYPE_NAMES[fromType]} -> ${HAND_TYPE_NAMES[toType]}`.padEnd(36)}` +
            ` ${delta('derivedLoss').toFixed(3).padStart(20)} ${delta('staticLoss').toFixed(3).padStart(8)} ${delta('cdfLoss').toFixed(3).padStart(8)}` +
            ` ${delta('derivedNetEV').toFixed(3).padStart(21)} ${delta('staticNetEV').toFixed(3).padStart(8)} ${delta('cdfNetEV').toFixed(3).padStart(8)}   ${sameSign ? 'yes' : 'NO'}`);
    }
    console.log(allSameSign ? '\nAll six upgrades: netEV_derived and cdf deltas have the same sign.' : '\nSIGN MISMATCH: check before running a match.');
}

if (require.main === module) {
    deriveLossPenalties().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { deriveLossPenalties };
