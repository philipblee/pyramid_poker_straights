// Deal rounds with PlayHandStats and write the August JSON shape.
// Usage:
//   node scripts/deal-lookup-rounds.js --method empirical --rounds 10000 --out <file.json>
//   node scripts/deal-lookup-rounds.js --write-netev <hand_tuple_lookup.csv> <netEV_lookup_table.csv>

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const REPO = path.resolve(__dirname, '..');

const SCRIPT_FILES = [
    'js/constants/hand-types.js',
    'js/utils.js',
    'js/utilities/analysis.js',
    'js/utilities/card-count.js',
    'js/utilities/empirical-win-probability.js',
    'js/utilities/tiered-win-probability.js',
    'js/utilities/tiered2-win-probability.js',
    'js/utilities/netEV-lookup-table.js',
    'js/utilities/convert-to-card-model.js',
    'js/hands/evaluate-hand.js',
    'js/hands/hand-utilities.js',
    'js/hands/scoring-utilities.js',
    'js/core/deck.js',
    'js/utils/card-sorter.js',
    'js/scoring/compare-hands.js',
    'js/utilities/card-parser.js',
    'js/utilities/count-valid-hands.js',
    'js/utilities/count-valid-hands-from-cards.js',
    'js/utilities/create-arrangement.js',
    'js/arrange/hand-sorter.js',
    'js/hands/hand-detector.js',
    'js/hands/card-utilities.js',
    'js/hands/arrangement-scorer.js',
    'js/hands/arrangement-validator.js',
    'js/arrange/two-wild-strategy-one.js',
    'js/arrange/two-wild-strategy-two.js',
    'js/core/game-config.js',
    'js/arrange/find-best-setup-no-wild.js',
    'js/arrange/one-wild-candidates.js',
    'js/arrange/find-best-setup-one-wild.js',
    'js/arrange/find-best-setup-two-wild.js',
    'js/arrange/find-best-setup.js',
    'js/stats/play-hand-stats.js'
];

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index + 1 >= process.argv.length) return null;
    return process.argv[index + 1];
}

function installHost() {
    global.window = global;
    global.performance = performance;
    global.localStorage = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    global.document = {
        getElementById() {
            return { innerHTML: '', style: {}, appendChild() {}, addEventListener() {} };
        },
        createElement() {
            return { className: '', style: {}, appendChild() {}, addEventListener() {} };
        },
        addEventListener() {},
        body: { appendChild() {} }
    };
    global.fetch = async function fetchLocal(url) {
        const relative = String(url).replace(/^\//, '');
        const filePath = path.resolve(REPO, relative);
        if (!fs.existsSync(filePath)) {
            return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        }
        const text = fs.readFileSync(filePath, 'utf8');
        return { ok: true, status: 200, statusText: 'OK', text: async () => text };
    };
}

function loadGameScripts() {
    const source = SCRIPT_FILES.map((relativePath) => {
        const filePath = path.join(REPO, relativePath);
        return fs.readFileSync(filePath, 'utf8') + '\n';
    }).join('\n');
    vm.runInThisContext(source, { filename: 'lookup-rebuild-scripts.js' });
}

function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

function parseHandRank(handRankStr) {
    let cleaned = handRankStr.trim();
    if (cleaned.startsWith('"')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('"')) cleaned = cleaned.slice(0, -1);
    if (!cleaned.startsWith('(') || !cleaned.endsWith(')')) return null;
    const values = cleaned.slice(1, -1).split(',').map((part) => parseInt(part.trim(), 10));
    if (values.some((value) => Number.isNaN(value))) return null;
    return values;
}

function assertEmpiricalAugustFile() {
    const straight = lookupEmpiricalWinProbability('front', {
        hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
        isIncomplete: false
    });
    const flush = lookupEmpiricalWinProbability('front', {
        hand_rank: [5, 14, 14],
        isIncomplete: false
    });
    if (straight == null || flush == null) {
        throw new Error(`August lookup miss. straight=${straight} flush=${flush}`);
    }
    if (!(straight > flush)) {
        throw new Error(`Front straight ${straight} does not beat front flush ${flush}`);
    }
    const loaded = empiricalWinProbability.probabilityMap.size;
    if (loaded !== 21032) {
        throw new Error(`Expected 21032 empirical rows, loaded ${loaded}`);
    }
    console.log(`Empirical check: front straight ${straight} > front flush ${flush} (${loaded} rows)`);
}

async function loadMethodTable(method) {
    if (method === 'empirical') {
        const ok = await initializeEmpiricalWinProbability();
        if (!ok) throw new Error('Empirical table failed to load');
        assertEmpiricalAugustFile();
        return;
    }
    if (method === 'tiered') {
        const ok = await initializeTieredWinProbability();
        if (!ok) throw new Error('Tiered table failed to load');
        const straight = lookupTieredWinProbability('front', {
            hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
            isIncomplete: false
        });
        const flush = lookupTieredWinProbability('front', {
            hand_rank: [5, 14, 13],
            isIncomplete: false
        });
        console.log(`Tiered loaded ${tieredWinProbability.probabilityMap.size} rows. Sample straight=${straight} flush=${flush}`);
        if (straight == null || flush == null) {
            throw new Error('Tiered lookup missed a known front straight or flush');
        }
        if (!(straight > flush)) {
            throw new Error(`Front straight ${straight} does not beat front flush ${flush}`);
        }
        return;
    }
    if (method === 'netEV') {
        const ok = await initializeTiered2WinProbability();
        if (!ok) throw new Error('Tiered2 table failed to load');
        window.NETEV_USE_TIERED2_FORMULA = true;
        const straight = lookupTiered2WinProbability('front', {
            hand_rank: [6, 14, 13, 1, 1, 1, 1, 4],
            isIncomplete: false
        });
        const flush = lookupTiered2WinProbability('front', {
            hand_rank: [5, 14, 14],
            isIncomplete: false
        });
        console.log(`Tiered2 loaded ${tiered2WinProbability.probabilityMap.size} rows. Sample straight=${straight} flush=${flush}`);
        if (straight == null || flush == null) {
            throw new Error('Tiered2 lookup missed a known front straight or flush');
        }
        const straightScore = ScoringUtilities.netEVFromWinRate('front', 6, straight);
        const flushScore = ScoringUtilities.netEVFromWinRate('front', 5, flush);
        console.log(`Formula sample: straight netEV ${straightScore} flush netEV ${flushScore}`);
        if (!(straightScore > flushScore)) {
            throw new Error('Formula did not rank the sample straight above the sample flush');
        }
        return;
    }
    throw new Error(`Unknown method ${method}`);
}

function writeChunk(stream, text) {
    if (stream.write(text)) return Promise.resolve();
    return new Promise((resolve) => stream.once('drain', resolve));
}

async function dealRounds(method, rounds, outPath) {
    if (gameConfig.config.winProbabilityMethod !== method) {
        throw new Error(`winProbabilityMethod is "${gameConfig.config.winProbabilityMethod}", expected "${method}"`);
    }
    if (method !== 'empirical' && method !== 'tiered' && method !== 'netEV') {
        throw new Error(`Refusing method "${method}"`);
    }
    gameConfig.config.wildCardCount = 2;
    window.NETEV_USE_TIERED2_FORMULA = method === 'netEV';

    await loadMethodTable(method);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const stream = fs.createWriteStream(outPath);
    await writeChunk(stream, '[\n');

    const stats = new PlayHandStats();
    const started = Date.now();
    let written = 0;
    let failures = 0;

    while (written < rounds) {
        const result = stats.playHandStats(6, 2);
        if (!result || result.error || !result.players || !result.scoringMatrix) {
            failures += 1;
            console.error(`Round failed (${failures}): ${result && result.error}`);
            if (failures > 50) throw new Error('Too many failed rounds');
            continue;
        }
        if (written > 0) await writeChunk(stream, ',\n');
        await writeChunk(stream, JSON.stringify(result));
        written += 1;
        if (written % 100 === 0 || written === 1) {
            const elapsed = (Date.now() - started) / 1000;
            const perRound = elapsed / written;
            console.log(`Progress ${written}/${rounds} in ${elapsed.toFixed(0)}s (${perRound.toFixed(2)}s/round), failures ${failures}`);
        }
    }

    await writeChunk(stream, '\n]\n');
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    console.log(`Wrote ${written} rounds to ${outPath}`);
}

async function writeNetEV(winRatePath, outPath) {
    window.NETEV_USE_TIERED2_FORMULA = true;
    const text = fs.readFileSync(winRatePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.trim().split(/\r?\n/);
    const header = parseCsvLine(lines[0]).map((field) => field.trim());
    const positionIndex = header.indexOf('position');
    const tupleIndex = header.indexOf('hand_rank_tuple');
    const winsIndex = header.indexOf('wins');
    const totalIndex = header.indexOf('total_matchups');
    const rateIndex = header.indexOf('win_rate');
    if (positionIndex < 0 || tupleIndex < 0 || winsIndex < 0 || totalIndex < 0 || rateIndex < 0) {
        throw new Error(`Unexpected win-rate header: ${header.join(',')}`);
    }

    const output = ['position,hand_rank_tuple,wins,total_matchups,netev'];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const fields = parseCsvLine(lines[i]);
        const position = fields[positionIndex].trim();
        const handRank = parseHandRank(fields[tupleIndex]);
        const wins = fields[winsIndex].trim();
        const total = fields[totalIndex].trim();
        const winRate = parseFloat(fields[rateIndex]);
        if (!handRank) throw new Error(`Bad tuple on line ${i + 1}: ${fields[tupleIndex]}`);
        const netev = ScoringUtilities.netEVFromWinRate(position, handRank[0], winRate);
        const tupleText = fields[tupleIndex].trim();
        output.push(`${position},"${tupleText.replace(/"/g, '')}",${wins},${total},${netev.toFixed(6)}`);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output.join('\n') + '\n');
    console.log(`Wrote ${output.length - 1} netEV rows to ${outPath}`);
}

async function main() {
    installHost();
    loadGameScripts();

    if (process.argv.includes('--test-all')) {
        for (const relativePath of [
            'js/tests/test-cases.js',
            'js/tests/create-from-cards-test-case.js',
            'js/tests/test-all-methods.js'
        ]) {
            vm.runInThisContext(fs.readFileSync(path.join(REPO, relativePath), 'utf8') + '\n', { filename: relativePath });
        }
        if (!await initializeEmpiricalWinProbability()) throw new Error('Empirical table failed to load');
        if (!await initializeTieredWinProbability()) throw new Error('Tiered table failed to load');
        if (!await initializeTiered2WinProbability()) throw new Error('Tiered2 table failed to load');
        if (!await initializeNetEVLookup()) throw new Error('NetEV table failed to load');
        console.log(`Loaded empirical ${empiricalWinProbability.probabilityMap.size}, tiered ${tieredWinProbability.probabilityMap.size}, tiered2 ${tiered2WinProbability.probabilityMap.size}, netEV ${netEVLookup.evMap.size}`);
        testAllMethods();
        return;
    }

    const writeIndex = process.argv.indexOf('--write-netev');
    if (writeIndex !== -1) {
        const winRatePath = process.argv[writeIndex + 1];
        const outPath = process.argv[writeIndex + 2];
        if (!winRatePath || !outPath) throw new Error('--write-netev needs a win-rate csv and an output csv');
        await writeNetEV(path.resolve(winRatePath), path.resolve(outPath));
        return;
    }

    const method = argValue('--method');
    const rounds = parseInt(argValue('--rounds') || '10000', 10);
    const outPath = argValue('--out');
    if (!method || !outPath || !Number.isFinite(rounds) || rounds < 1) {
        throw new Error('Need --method empirical|tiered|netEV --rounds N --out file.json');
    }
    gameConfig.config.winProbabilityMethod = method;
    if (gameConfig.config.winProbabilityMethod !== method) {
        throw new Error('Failed to set winProbabilityMethod exactly');
    }
    await dealRounds(method, rounds, path.resolve(outPath));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
