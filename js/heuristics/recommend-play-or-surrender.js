// js/heuristics/recommend-play-or-surrender.js
// Play or surrender recommendation from the 13 cards seen before the kitty, by table size.
// 6 seats: surrender rule D (pyramid_poker_analysis/scripts/pot_share_by_stayers.py rule_d_plays).
// 2-5 seats: self-consistent rules (pyramid_poker_analysis/scripts/self_consistent_rules.py): 2 seats play every hand,
// 3-5 seats look up the hand's cell in PLAY_SURRENDER_CELL_TABLE (js/heuristics/play-surrender-cell-table.js).
// Needs Analysis, CardUtilities and PLAY_SURRENDER_CELL_TABLE.

const TABLE_SIZE_WORDS = { 3: 'Three', 4: 'Four', 5: 'Five' };
const TRIP_RANK_GROUP_WORDS = ['', '2 to 6', '7 or 8', '9 to K', 'aces'];
const DRAW_WORDS = ['no straight-flush draw', 'an inside straight-flush draw', 'an open-ended straight-flush draw'];
const STRONG_PAIR_WORDS = ['no pair of 9 or higher', 'one pair of 9 or higher', 'two pairs of 9 or higher',
    'three or more pairs of 9 or higher'];
const LONGEST_SUIT_WORDS = ['longest suit 4 cards or fewer', 'longest suit 5 cards', 'longest suit 6 cards',
    'longest suit 7 or more cards'];
const CLOSE_CALL_REASON = 'Close call: the expected gain is within one standard error of zero';

// Straight-flush features of the natural cards. Within a suit each rank counts once and an ace is both 1 and 14.
// Open-ended: 4 consecutive ranks with both ends on the board (A234 and JQKA are inside draws).
// Inside: 4 of the 5 ranks of a window, with no open-ended draw in any suit. A made straight flush clears both draws.
function findStraightFlushFeatures(naturalCards) {
    let hasMadeStraightFlush = false;
    let hasOpenEndedRun = false;
    let hasFourOfFiveWindow = false;

    for (const suitCards of Object.values(CardUtilities.groupCardsBySuit(naturalCards))) {
        const suitedValues = new Set(suitCards.map(card => card.value));
        if (suitedValues.has(14)) suitedValues.add(1);

        for (let windowLow = 1; windowLow <= 10; windowLow++) {
            let windowHits = 0;
            for (let value = windowLow; value < windowLow + 5; value++) {
                if (suitedValues.has(value)) windowHits++;
            }
            if (windowHits === 5) hasMadeStraightFlush = true;
            if (windowHits === 4) hasFourOfFiveWindow = true;
        }

        for (let runLow = 2; runLow <= 10; runLow++) {
            if ([0, 1, 2, 3].every(offset => suitedValues.has(runLow + offset))) hasOpenEndedRun = true;
        }
    }

    return {
        hasMadeStraightFlush,
        hasOpenEndedDraw: hasOpenEndedRun && !hasMadeStraightFlush,
        hasInsideDraw: hasFourOfFiveWindow && !hasOpenEndedRun && !hasMadeStraightFlush
    };
}

// Base-cell key of a no-wild hand, matching seat_keys in self_consistent_rules.py
function findPlaySurrenderCellKey(naturalCards) {
    const handAnalysis = new Analysis(naturalCards);
    const rankCountEntries = Object.entries(handAnalysis.rankCounts);
    const tripValues = rankCountEntries
        .filter(([, rankCount]) => rankCount === 3)
        .map(([rank]) => Analysis.getRankValue(rank));
    const straightFlushFeatures = findStraightFlushFeatures(naturalCards);
    const hasQuadsOrMadeStraightFlush = rankCountEntries.some(([, rankCount]) => rankCount >= 4) ||
        straightFlushFeatures.hasMadeStraightFlush;

    const category = hasQuadsOrMadeStraightFlush ? 3 : Math.min(tripValues.length, 2);
    const highestTripValue = tripValues.length > 0 ? Math.max(...tripValues) : 0;
    const tripRankGroup = category === 1 || category === 2
        ? (highestTripValue <= 6 ? 1 : highestTripValue <= 8 ? 2 : highestTripValue <= 13 ? 3 : 4)
        : 0;
    const draw = straightFlushFeatures.hasOpenEndedDraw ? 2 : straightFlushFeatures.hasInsideDraw ? 1 : 0;
    const strongPairs = Math.min(rankCountEntries
        .filter(([pairRank, pairCount]) => pairCount === 2 && Analysis.getRankValue(pairRank) >= 9).length, 3);
    const longestSuitLength = Math.max(...Object.values(handAnalysis.suitCounts));
    const longestSuit = Math.min(Math.max(longestSuitLength - 4, 0), 3);

    return {
        category, tripRankGroup, draw, strongPairs, longestSuit,
        text: [category, tripRankGroup, draw, strongPairs, longestSuit].join('|')
    };
}

function describeHandCell(cellKey) {
    const tripWords = TRIP_RANK_GROUP_WORDS[cellKey.tripRankGroup];
    const handKind = cellKey.category === 0 ? 'no trips'
        : cellKey.category === 1 ? `one trip of ${tripWords}`
        : cellKey.category === 2 ? `two or more trips, highest ${tripWords}`
        : 'four of a kind or a made straight flush';
    return [handKind, STRONG_PAIR_WORDS[cellKey.strongPairs], LONGEST_SUIT_WORDS[cellKey.longestSuit],
        DRAW_WORDS[cellKey.draw]].join(', ');
}

// Rule D on a no-wild hand, listing every condition that applies
function recommendByRuleD(thirteenCards) {
    const rankCountEntries = Object.entries(new Analysis(thirteenCards).rankCounts);
    const tripsCount = rankCountEntries.filter(([, rankCount]) => rankCount === 3).length;
    const hasFourOrMoreOfAKind = rankCountEntries.some(([, rankCount]) => rankCount >= 4);
    const strongPairCount = rankCountEntries
        .filter(([rank, rankCount]) => rankCount === 2 && Analysis.getRankValue(rank) >= 9).length;
    const hasThreeStrongPairs = strongPairCount >= 3;
    const straightFlushFeatures = findStraightFlushFeatures(thirteenCards);

    const playReasons = [];
    if (hasFourOrMoreOfAKind) playReasons.push('Four or more of a kind');
    if (straightFlushFeatures.hasMadeStraightFlush) playReasons.push('A made straight flush');
    if (tripsCount >= 2) playReasons.push('Two or more sets of trips');
    if (tripsCount === 1) {
        if (straightFlushFeatures.hasOpenEndedDraw) playReasons.push('One trip plus an open-ended straight-flush draw');
        if (straightFlushFeatures.hasInsideDraw) playReasons.push('One trip plus an inside straight-flush draw');
        if (hasThreeStrongPairs) playReasons.push('One trip plus three or more pairs of 9 or higher');
    }
    if (playReasons.length > 0) return { decision: 'play', reasons: playReasons };

    if (tripsCount === 1) {
        return {
            decision: 'surrender',
            reasons: ['One trip with no second trips, fewer than three pairs of 9 or higher and no straight-flush draw']
        };
    }

    const surrenderReasons = ['No trips or better'];
    if (straightFlushFeatures.hasOpenEndedDraw || straightFlushFeatures.hasInsideDraw) {
        surrenderReasons.push('A straight-flush draw without trips is not enough');
    }
    if (hasThreeStrongPairs) surrenderReasons.push('Three or more pairs of 9 or higher without trips are not enough');
    return { decision: 'surrender', reasons: surrenderReasons };
}

// Returns { decision: 'play' | 'surrender', reasons: [strings] } for a table of seatCount players (2 to 6)
function recommendPlayOrSurrender(thirteenCards, seatCount) {
    if (thirteenCards.length !== 13) {
        throw new Error(`recommendPlayOrSurrender needs 13 cards, got ${thirteenCards.length}`);
    }
    if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) {
        throw new Error(`recommendPlayOrSurrender needs a seat count from 2 to 6, got ${seatCount}`);
    }

    const wildCardCount = CardUtilities.countWildCards(thirteenCards);
    if (wildCardCount === 1) return { decision: 'play', reasons: ['One wild card in the 13'] };
    if (wildCardCount >= 2) return { decision: 'play', reasons: ['Two wild cards in the 13'] };

    if (seatCount === 6) return recommendByRuleD(thirteenCards);
    if (seatCount === 2) return { decision: 'play', reasons: ['At a 2-player table, playing every hand beats surrendering'] };

    const cellKey = findPlaySurrenderCellKey(thirteenCards);
    const cellIndex = PLAY_SURRENDER_CELL_TABLE.keyToCell[cellKey.text];
    if (cellIndex === undefined) throw new Error(`No play/surrender cell for key ${cellKey.text}`);
    const cell = PLAY_SURRENDER_CELL_TABLE.cells[cellIndex];
    const decision = cell.plays[seatCount] ? 'play' : 'surrender';
    const closeCallReasons = cell.nearLine[seatCount] ? [CLOSE_CALL_REASON] : [];
    const tableSizeWords = `${TABLE_SIZE_WORDS[seatCount]}-player table`;

    const ruleDRecommendation = recommendByRuleD(thirteenCards);
    if (decision === 'play' && ruleDRecommendation.decision === 'play') {
        return { decision, reasons: [...ruleDRecommendation.reasons, ...closeCallReasons] };
    }
    if (decision === 'play' && cellKey.category === 1 && seatCount <= 4) {
        return { decision, reasons: [`${tableSizeWords}: one trip plays`, ...closeCallReasons] };
    }
    const outcomeWords = decision === 'play' ? 'play' : 'surrender';
    return {
        decision,
        reasons: [`${tableSizeWords}: ${describeHandCell(cellKey)}. Hands like this ${outcomeWords}`, ...closeCallReasons]
    };
}
