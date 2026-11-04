// Pool match batches from scripts/deal-lookup-rounds.js --match into one summary.
// Usage: node scripts/pool-matches.js data/matches/match_cdf_vs_tiered2_seed1_1000.csv data/matches/match_..._start1000.csv ...
// Each CSV needs its sibling .json (metadata). Refuses files whose method pair, CDF arrays A/B, seed or table files/hashes differ,
// or whose rounds overlap. Warns when the game commit differs between batches.

const fs = require('fs');
const path = require('path');
const { matchSummary, formatMatchSummary, readMatchCsv } = require('./match-summary.js');

function batchMetadata(csvPath) {
    const jsonPath = csvPath.replace(/\.csv$/i, '.json');
    if (!fs.existsSync(jsonPath)) throw new Error(`No metadata ${jsonPath} for ${csvPath}`);
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')).metadata;
}

function poolMatches(csvPaths) {
    if (csvPaths.length === 0) throw new Error('Usage: node scripts/pool-matches.js <match csv> [<match csv> ...]');
    const batches = csvPaths.map((csvPath) => ({ csvPath, metadata: batchMetadata(csvPath), handRows: readMatchCsv(csvPath) }));
    const reference = batches[0].metadata;
    const tableIdentity = (metadata) => JSON.stringify(metadata.tableFiles);
    for (const batch of batches.slice(1)) {
        const { metadata } = batch;
        if (metadata.methodA !== reference.methodA || metadata.methodB !== reference.methodB) {
            throw new Error(`Refusing to pool: ${batch.csvPath} is ${metadata.methodA} vs ${metadata.methodB}, expected ${reference.methodA} vs ${reference.methodB}`);
        }
        // tableFiles is a sorted set, so it misses A/B swaps of the same two CDF tables (--cdf-arrays-b)
        if (metadata.cdfArraysA !== reference.cdfArraysA || metadata.cdfArraysB !== reference.cdfArraysB) {
            throw new Error(`Refusing to pool: ${batch.csvPath} has CDF arrays A ${metadata.cdfArraysA}, B ${metadata.cdfArraysB};` +
                ` expected A ${reference.cdfArraysA}, B ${reference.cdfArraysB}`);
        }
        if (metadata.seed !== reference.seed) {
            throw new Error(`Refusing to pool: ${batch.csvPath} has seed ${metadata.seed}, expected ${reference.seed}`);
        }
        if (tableIdentity(metadata) !== tableIdentity(reference)) {
            throw new Error(`Refusing to pool: ${batch.csvPath} table files differ: ${tableIdentity(metadata)} vs ${tableIdentity(reference)}`);
        }
        if (metadata.gitCommit !== reference.gitCommit || metadata.gitDirty || reference.gitDirty) {
            console.warn(`Warning: ${batch.csvPath} commit ${metadata.gitCommit}${metadata.gitDirty ? ' (dirty)' : ''},` +
                ` first batch ${reference.gitCommit}${reference.gitDirty ? ' (dirty)' : ''}`);
        }
    }

    const roundSource = new Map();
    for (const batch of batches) {
        for (const round of new Set(batch.handRows.map((handRow) => handRow.round))) {
            if (roundSource.has(round)) {
                throw new Error(`Refusing to pool: round ${round} is in both ${roundSource.get(round)} and ${batch.csvPath}`);
            }
            roundSource.set(round, batch.csvPath);
        }
    }

    const pooledRows = batches.flatMap((batch) => batch.handRows).sort((rowA, rowB) => rowA.round - rowB.round || rowA.handIndex - rowB.handIndex);
    const pooledSummary = matchSummary(pooledRows);
    const sortedRounds = [...roundSource.keys()].sort((roundA, roundB) => roundA - roundB);
    console.log(`Pooled ${batches.length} batches: ${reference.methodA} (A) vs ${reference.methodB} (B), seed ${reference.seed},` +
        ` rounds ${sortedRounds[0]}-${sortedRounds[sortedRounds.length - 1]} (${sortedRounds.length} deals)`);
    batches.forEach((batch) => console.log(`  ${path.basename(batch.csvPath)}: rounds ${batch.metadata.startRound}-${batch.metadata.endRound}, commit ${batch.metadata.gitCommit.slice(0, 7)}`));
    console.log(formatMatchSummary(pooledSummary));
    return pooledSummary;
}

if (require.main === module) {
    try {
        poolMatches(process.argv.slice(2).map((csvPath) => path.resolve(csvPath)));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = { poolMatches };
