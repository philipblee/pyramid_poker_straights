// CDF Lookup Parity Test
// Checks js/utilities/cdf-lookup.js against the Python reference (analysis repo scripts/cdf_lookup.py),
// using data/cdf_parity_cases_<run>[_noauto].json from scripts/make_cdf_parity_cases.py.
// Run from the project root: node js/tests/test-cdf-lookup.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CdfLookupTable, rankKeyFromHandTuple } = require('../utilities/cdf-lookup.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TOLERANCE = 1e-9;
const CDF_FILE_SUFFIXES = ['august', 'august_noauto', 'netev', 'netev_noauto'];

// hand-utilities.js declares handUtilities() as a browser global
vm.runInThisContext(fs.readFileSync(path.join(PROJECT_ROOT, 'js', 'hands', 'hand-utilities.js'), 'utf8'));

function testPointsMatchGame(cdfTable) {
    const gamePoints = handUtilities();
    const pointMismatches = [];
    for (const [position, pointsByType] of Object.entries(cdfTable.cdfJson.meta.points)) {
        for (const [handType, tablePoints] of Object.entries(pointsByType)) {
            const gamePointValue = gamePoints.getPointValue(Number(handType), position);
            if (gamePointValue !== tablePoints) {
                pointMismatches.push(`${position} type ${handType}: table ${tablePoints}, game ${gamePointValue}`);
            }
        }
    }
    return pointMismatches;
}

function testLookupParity(cdfTable, lookupCases) {
    const maxDifference = { winProb: 0, tieProb: 0, netEV: 0 };
    const failedCases = [];
    for (const lookupCase of lookupCases) {
        const lookedUp = cdfTable.lookup(lookupCase.position, lookupCase.w, lookupCase.key);
        let caseFailed = false;
        for (const field of Object.keys(maxDifference)) {
            const difference = Math.abs(lookedUp[field] - lookupCase[field]);
            maxDifference[field] = Math.max(maxDifference[field], difference);
            if (!(difference <= TOLERANCE)) {
                caseFailed = true;
            }
        }
        if (caseFailed) {
            failedCases.push({ lookupCase, lookedUp });
        }
    }
    return { maxDifference, failedCases };
}

function testRankKeys(rankKeyCases) {
    const keyMismatches = [];
    for (const rankKeyCase of rankKeyCases) {
        const strippedKey = rankKeyFromHandTuple(rankKeyCase.handRank, rankKeyCase.cardCount);
        if (JSON.stringify(strippedKey) !== JSON.stringify(rankKeyCase.expectedKey)) {
            keyMismatches.push(`[${rankKeyCase.handRank}] x${rankKeyCase.cardCount}: got [${strippedKey}], expected [${rankKeyCase.expectedKey}]`);
        }
    }
    return keyMismatches;
}

function testCdfLookup() {
    console.log('\n🧪 Testing CDF lookup parity with Python...');
    let allPassed = true;

    for (const fileSuffix of CDF_FILE_SUFFIXES) {
        const cdfPath = path.join(PROJECT_ROOT, 'data', `cdf_arrays_${fileSuffix}.json`);
        const casesPath = path.join(PROJECT_ROOT, 'data', `cdf_parity_cases_${fileSuffix}.json`);
        const cdfTable = new CdfLookupTable();
        cdfTable.loadFromFile(cdfPath);
        const parityCases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

        const pointMismatches = testPointsMatchGame(cdfTable);
        const { maxDifference, failedCases } = testLookupParity(cdfTable, parityCases.lookupCases);
        const keyMismatches = testRankKeys(parityCases.rankKeyCases);
        const filePassed = pointMismatches.length === 0 && failedCases.length === 0 && keyMismatches.length === 0;
        allPassed = allPassed && filePassed;

        console.log(`${filePassed ? '✅' : '❌'} cdf_arrays_${fileSuffix}.json:` +
            ` ${parityCases.lookupCases.length - failedCases.length}/${parityCases.lookupCases.length} lookups within ${TOLERANCE}` +
            ` (max |diff| win ${maxDifference.winProb.toExponential(2)}, tie ${maxDifference.tieProb.toExponential(2)},` +
            ` netEV ${maxDifference.netEV.toExponential(2)});` +
            ` rank keys ${parityCases.rankKeyCases.length - keyMismatches.length}/${parityCases.rankKeyCases.length};` +
            ` points mismatches ${pointMismatches.length}`);
        failedCases.slice(0, 5).forEach(({ lookupCase, lookedUp }) =>
            console.log(`   ❌ ${lookupCase.kind} ${lookupCase.position} w${lookupCase.w} [${lookupCase.key}]:`,
                lookedUp, 'expected', { winProb: lookupCase.winProb, tieProb: lookupCase.tieProb, netEV: lookupCase.netEV }));
        keyMismatches.slice(0, 5).forEach(mismatch => console.log(`   ❌ rank key ${mismatch}`));
        pointMismatches.forEach(mismatch => console.log(`   ❌ points ${mismatch}`));
    }

    console.log(allPassed ? '\n✅ CDF lookup: all checks PASSED' : '\n❌ CDF lookup: some checks FAILED');
    return allPassed;
}

if (require.main === module) {
    process.exitCode = testCdfLookup() ? 0 : 1;
}

module.exports = { testCdfLookup };
