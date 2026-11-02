// Report on hands where the two methods of a match chose different arrangements.
// Usage: node scripts/summarize-match-differences.js data/matches/match_cdf_vs_tiered2_seed1_1000.csv [--top 15]
// Reads the per-hand CSV from scripts/deal-lookup-rounds.js --match and its sibling .json (method names).
// Paired difference = score when played by A minus score when played by B (A and B as in the file name,
// e.g. cdf minus tiered2). Hand types come from the game's evaluateHand / evaluateThreeCardHand.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { readMatchCsv } = require('./match-summary.js');

const REPO = path.resolve(__dirname, '..');
const POSITIONS = ['back', 'middle', 'front'];
const EVALUATOR_FILES = ['js/constants/hand-types.js', 'js/utils.js', 'js/utilities/analysis.js', 'js/hands/evaluate-hand.js'];
const SUIT_ORDER = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };

function loadEvaluator() {
    global.window = global;
    const evaluatorSource = EVALUATOR_FILES.map((relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8')).join('\n');
    vm.runInThisContext(evaluatorSource, { filename: 'summarize-match-differences-evaluator.js' });
}

// Same PRNG as scripts/deal-lookup-rounds.js seededRandomForRound: mulberry32 keyed by sha256("<seed>:<roundIndex>").
// Kept in step by dealtHandCards checking every arrangement's cards against the rebuilt hand.
function seededRandomForRound(seed, roundIndex) {
    let state = crypto.createHash('sha256').update(`${seed}:${roundIndex}`).digest().readUInt32LE(0);
    return function mulberry32() {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

// Rebuild the six dealt hands of a seeded round: the game's createDeck (two decks + 2 wilds, as the match runner
// sets wildCardCount = 2) shuffled with the round's PRNG, dealt 17 cards per seat from the top
function dealtHandsForRound(seed, roundIndex) {
    const browserShuffleDeck = global.shuffleDeck;
    const roundRandom = seededRandomForRound(seed, roundIndex);
    global.shuffleDeck = function seededShuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(roundRandom() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    };
    try {
        const shuffledDeck = createDeck();
        return Array.from({ length: 6 }, (_, seatIndex) => shuffledDeck.slice(17 * seatIndex, 17 * seatIndex + 17));
    } finally {
        global.shuffleDeck = browserShuffleDeck;
    }
}

// The hand's 17 dealt cards; throws if an arrangement's non-wild cards are not all among them or the wild count differs
function dealtHandCards(seed, handRow, arrangements) {
    const handCards = dealtHandsForRound(seed, handRow.round)[handRow.handIndex];
    const wildCount = handCards.filter((card) => card.isWild).length;
    for (const arrangement of arrangements) {
        const unmatchedCards = handCards.filter((card) => !card.isWild).map((card) => `${card.rank}${card.suit}`);
        for (const card of POSITIONS.flatMap((position) => arrangement[position].cards).filter((card) => !card.playedAsWild)) {
            const matchIndex = unmatchedCards.indexOf(`${card.rank}${card.suit}`);
            if (matchIndex === -1) throw new Error(`Round ${handRow.round} hand ${handRow.handIndex}: ${card.rank}${card.suit} is not in the rebuilt deal`);
            unmatchedCards.splice(matchIndex, 1);
        }
    }
    if (wildCount !== handRow.w) throw new Error(`Round ${handRow.round} hand ${handRow.handIndex}: rebuilt deal has ${wildCount} wilds, CSV says ${handRow.w}`);
    return handCards.map((card) => ({ ...card, playedAsWild: false }));
}

// "10♥*" -> card object; a trailing * marks a wild card played as that rank and suit
function cardFromToken(cardToken) {
    const playedAsWild = cardToken.endsWith('*');
    const rankAndSuit = playedAsWild ? cardToken.slice(0, -1) : cardToken;
    const suit = rankAndSuit.slice(-1);
    const rank = rankAndSuit.slice(0, -1);
    return { rank, suit, value: getCardValue(rank), id: cardToken, isWild: false, playedAsWild };
}

function sortCardsForDisplay(cards) {
    return [...cards].sort((cardA, cardB) => cardB.value - cardA.value || SUIT_ORDER[cardB.suit] - SUIT_ORDER[cardA.suit]);
}

// Signature "back cards / middle cards / front cards" -> per-position cards, hand type and name
function arrangementFromSignature(signature) {
    const positionTexts = signature.split(' / ');
    const arrangement = {};
    POSITIONS.forEach((position, positionIndex) => {
        const cards = positionTexts[positionIndex].split(' ').map(cardFromToken);
        const evaluated = position === 'front' && cards.length === 3 ? evaluateThreeCardHand(cards) : evaluateHand(cards);
        arrangement[position] = {
            cards: sortCardsForDisplay(cards),
            cardKey: positionTexts[positionIndex],
            handType: evaluated.handType,
            handName: `${evaluated.name}${cards.length > 5 || (position === 'front' && cards.length === 5) ? ` (${cards.length})` : ''}`
        };
    });
    return arrangement;
}

function describeCards(cards) {
    return cards.map((card) => `${card.rank}${card.suit}${card.playedAsWild ? '*' : ''}`).join(' ');
}

// Per changed position: direction of the hand-type change (A relative to B) and the type transition B -> A
function classifyDifference(arrangementA, arrangementB) {
    const changedPositions = POSITIONS.filter((position) => arrangementA[position].cardKey !== arrangementB[position].cardKey);
    const directionParts = changedPositions.map((position) => {
        const typeA = arrangementA[position].handType;
        const typeB = arrangementB[position].handType;
        const direction = typeA > typeB ? 'type up' : typeA < typeB ? 'type down' : 'same type (kickers/suits)';
        return `${position} ${direction}`;
    });
    const transitionParts = changedPositions.map((position) => {
        const nameA = arrangementA[position].handName;
        const nameB = arrangementB[position].handName;
        return nameA === nameB ? `${position}: ${nameA} (kickers/suits)` : `${position}: ${nameB} -> ${nameA}`;
    });
    return {
        positionsKey: changedPositions.length > 0 ? changedPositions.join('+') : 'none (same cards, signature order)',
        directionKey: directionParts.join(', ') || 'none',
        transitionKey: transitionParts.join('; ') || 'none'
    };
}

function groupStatistics(differenceRows, groupKeyOf) {
    const groups = new Map();
    for (const differenceRow of differenceRows) {
        const groupKey = groupKeyOf(differenceRow);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(differenceRow.pairedDifference);
    }
    return [...groups.entries()].map(([groupKey, pairedDifferences]) => {
        const count = pairedDifferences.length;
        const total = pairedDifferences.reduce((sum, pairedDifference) => sum + pairedDifference, 0);
        const mean = total / count;
        const variance = count > 1 ? pairedDifferences.reduce((sum, pairedDifference) => sum + (pairedDifference - mean) ** 2, 0) / (count - 1) : null;
        return {
            groupKey, count, total, mean,
            standardError: variance === null ? null : Math.sqrt(variance / count),
            gains: pairedDifferences.filter((pairedDifference) => pairedDifference > 0).length,
            losses: pairedDifferences.filter((pairedDifference) => pairedDifference < 0).length
        };
    }).sort((groupA, groupB) => groupB.count - groupA.count || groupB.total - groupA.total);
}

function printGroupTable(title, groups, maxGroups) {
    console.log(`\n${title}`);
    console.log('   count     mean       SE    total  gain/loss  group');
    groups.slice(0, maxGroups).forEach((group) => {
        const standardErrorText = group.standardError === null ? '      n/a' : group.standardError.toFixed(3).padStart(9);
        console.log(`${String(group.count).padStart(8)} ${group.mean.toFixed(3).padStart(8)} ${standardErrorText}` +
            ` ${String(group.total).padStart(8)} ${`${group.gains}/${group.losses}`.padStart(10)}  ${group.groupKey}`);
    });
    if (groups.length > maxGroups) {
        const remainingGroups = groups.slice(maxGroups);
        const remainingCount = remainingGroups.reduce((sum, group) => sum + group.count, 0);
        const remainingTotal = remainingGroups.reduce((sum, group) => sum + group.total, 0);
        console.log(`${String(remainingCount).padStart(8)} ${(remainingTotal / remainingCount).toFixed(3).padStart(8)}           ` +
            ` ${String(remainingTotal).padStart(8)}             (${remainingGroups.length} smaller groups)`);
    }
}

function printHandDetail(differenceRow, methodA, methodB, seed) {
    const { handRow, arrangementA, arrangementB } = differenceRow;
    const handCards = dealtHandCards(seed, handRow, [arrangementA, arrangementB]);
    const dealtCardsText = `${describeCards(sortCardsForDisplay(handCards.filter((card) => !card.isWild)))}${' 🃏'.repeat(handRow.w)}`;
    console.log(`\nround ${handRow.round} hand ${handRow.handIndex}, w=${handRow.w}, paired difference ${differenceRow.pairedDifference}` +
        ` (${methodA} ${handRow.scoreA} in ${handRow.orientationA}, ${methodB} ${handRow.scoreB} in ${handRow.orientationB})`);
    console.log(`  cards: ${dealtCardsText}`);
    for (const [methodName, arrangement] of [[methodA, arrangementA], [methodB, arrangementB]]) {
        const positionTexts = POSITIONS.map((position) => `${position} ${describeCards(arrangement[position].cards)} [${arrangement[position].handName}]`);
        console.log(`  ${methodName.padEnd(8)} ${positionTexts.join(' | ')}`);
    }
}

function summarizeMatchDifferences(csvPath, topCount) {
    const matchMetadata = JSON.parse(fs.readFileSync(csvPath.replace(/\.csv$/i, '.json'), 'utf8')).metadata;
    const { methodA, methodB } = matchMetadata;
    loadEvaluator();

    const handRows = readMatchCsv(csvPath);
    const differenceRows = handRows.filter((handRow) => !handRow.sameArrangement).map((handRow) => {
        const arrangementA = arrangementFromSignature(handRow.signatureA);
        const arrangementB = arrangementFromSignature(handRow.signatureB);
        return {
            handRow, arrangementA, arrangementB,
            pairedDifference: handRow.scoreA - handRow.scoreB,
            ...classifyDifference(arrangementA, arrangementB)
        };
    });
    const allDifferences = differenceRows.reduce((sum, differenceRow) => sum + differenceRow.pairedDifference, 0);

    console.log(`${path.basename(csvPath)}: ${methodA} (A) vs ${methodB} (B), seed ${matchMetadata.seed}, rounds ${matchMetadata.startRound}-${matchMetadata.endRound}`);
    console.log(`Hands ${handRows.length}, different arrangements ${differenceRows.length} (${(100 * differenceRows.length / handRows.length).toFixed(1)}%)`);
    console.log(`Paired difference = score played by ${methodA} - score played by ${methodB}, roundScore units; hands with the same arrangement contribute 0.`);
    console.log(`Total over differing hands ${allDifferences}, mean ${(allDifferences / differenceRows.length).toFixed(3)} per differing hand,` +
        ` ${(allDifferences / handRows.length).toFixed(4)} per hand overall.`);
    console.log(`Type up/down compares ${methodA}'s hand type with ${methodB}'s in that position; transitions read ${methodB} -> ${methodA}.`);

    printGroupTable('By wild count', groupStatistics(differenceRows, (differenceRow) => `w=${differenceRow.handRow.w}`), 10);
    printGroupTable('By positions changed', groupStatistics(differenceRows, (differenceRow) => differenceRow.positionsKey), 20);
    printGroupTable('By direction of change per position', groupStatistics(differenceRows, (differenceRow) => differenceRow.directionKey), 25);
    printGroupTable('By hand-type transition', groupStatistics(differenceRows, (differenceRow) => differenceRow.transitionKey), 40);

    const rankedRows = [...differenceRows].sort((rowA, rowB) => rowB.pairedDifference - rowA.pairedDifference ||
        rowA.handRow.round - rowB.handRow.round || rowA.handRow.handIndex - rowB.handRow.handIndex);
    console.log(`\n=== ${topCount} largest gains for ${methodA} ===`);
    rankedRows.slice(0, topCount).filter((differenceRow) => differenceRow.pairedDifference > 0)
        .forEach((differenceRow) => printHandDetail(differenceRow, methodA, methodB, matchMetadata.seed));
    console.log(`\n=== ${topCount} largest losses for ${methodA} ===`);
    rankedRows.slice(-topCount).reverse().filter((differenceRow) => differenceRow.pairedDifference < 0)
        .forEach((differenceRow) => printHandDetail(differenceRow, methodA, methodB, matchMetadata.seed));
}

if (require.main === module) {
    const csvArgument = process.argv[2];
    const topIndex = process.argv.indexOf('--top');
    const topCount = topIndex === -1 ? 15 : Number(process.argv[topIndex + 1]);
    if (!csvArgument || !Number.isSafeInteger(topCount) || topCount < 1) {
        console.error('Usage: node scripts/summarize-match-differences.js <match csv> [--top 15]');
        process.exit(1);
    }
    summarizeMatchDifferences(path.resolve(csvArgument), topCount);
}

module.exports = { summarizeMatchDifferences };
