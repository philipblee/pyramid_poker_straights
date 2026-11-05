// Automatic ranking check for the straights fork: three straights must beat three flush.
// Usage: paste into the browser console on game.html (needs findAndArrangeBestAutomatic,
// validateAutomaticArrangement and window.game). Prints PASS or FAIL per check; changes no game state
// (window.game.automaticHands is restored after check 3).
(() => {
    const VALUES = { A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
    let cardCount = 0;
    const card = (rank, suit) => ({ rank, suit, value: VALUES[rank], isWild: false, wasWild: false, id: `check_${rank}${suit}_${cardCount++}` });
    const straightFlush = (ranks, suit) => ranks.map((rank) => card(rank, suit));
    const report = (name, pass, detail) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);

    // Three staggered straight flushes plus 5♣ 3♣: can make three straights and three flush,
    // but not three full houses (only two pairs besides the trips) or a dragon (9 ranks)
    const spades = straightFlush(['A', 'K', 'Q', 'J', '10'], '♠');
    const hearts = straightFlush(['K', 'Q', 'J', '10', '9'], '♥');
    const diamonds = straightFlush(['Q', 'J', '10', '9', '8'], '♦');
    const seventeen = [...spades, ...hearts, ...diamonds, card('5', '♣'), card('3', '♣')];

    // 1. FIND-AUTO picks the higher automatic when 17 cards can make both
    try {
        const best = findAndArrangeBestAutomatic(seventeen.map((c) => ({ ...c })));
        const type = best && best.type;
        report('findAndArrangeBestAutomatic', type === 'three-straight', `got ${type}, expected three-straight`);
    } catch (error) {
        report('findAndArrangeBestAutomatic', false, `threw ${error.message}`);
    }

    // 2. An arrangement that qualifies as both is labelled the higher automatic
    try {
        const automatic = validateAutomaticArrangement({ back: spades, middle: hearts, front: diamonds });
        const type = automatic && automatic.type;
        report('validateAutomaticArrangement', type === 'three-straight', `got ${type}, expected three-straight`);
    } catch (error) {
        report('validateAutomaticArrangement', false, `threw ${error.message}`);
    }

    // 3. Scoring: P1 three-flush, P2 three-straight, P3 normal. Correct: P1 0, P2 +6, P3 -6
    const game = window.game;
    const savedAutomatics = game.automaticHands;
    try {
        const roundScores = new Map([['P1', 0], ['P2', 0], ['P3', 0]]);
        game.automaticHands = new Map([['P1', { type: 'three-flush' }], ['P2', { type: 'three-straight' }]]);
        game.handleMultiAutomatics(['P1', 'P2'], roundScores, []);
        const scores = Object.fromEntries(roundScores);
        const pass = scores.P1 === 0 && scores.P2 === 6 && scores.P3 === -6;
        report('handleMultiAutomatics', pass, `got P1 ${scores.P1}, P2 ${scores.P2}, P3 ${scores.P3}; expected P1 0, P2 6, P3 -6`);
    } catch (error) {
        report('handleMultiAutomatics', false, `threw ${error.message}`);
    } finally {
        game.automaticHands = savedAutomatics;
    }
})();
