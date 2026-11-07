// js/heuristics/recommend-play-or-surrender.js
// Play or surrender recommendation from the 13 cards seen before the kitty, using surrender rule D
// (pyramid_poker_analysis/scripts/pot_share_by_stayers.py rule_d_plays). Needs Analysis and CardUtilities.

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

// Returns { decision: 'play' | 'surrender', reasons: [strings] }, listing every condition that applies
function recommendPlayOrSurrender(thirteenCards) {
    if (thirteenCards.length !== 13) {
        throw new Error(`recommendPlayOrSurrender needs 13 cards, got ${thirteenCards.length}`);
    }

    const wildCardCount = CardUtilities.countWildCards(thirteenCards);
    if (wildCardCount === 1) return { decision: 'play', reasons: ['One wild card in the 13'] };
    if (wildCardCount >= 2) return { decision: 'play', reasons: ['Two wild cards in the 13'] };

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
