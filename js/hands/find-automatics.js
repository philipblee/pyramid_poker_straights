// js/hands/find-automatics.js
// Exact automatic finder. For any set of cards (natural cards plus unassigned wilds) it decides whether each automatic
// can be made and builds the strongest arrangement for it:
//   three full houses, three straights, three flushes: three 5-card rows, strongest row in the back (evaluateHand order)
//   dragon: the standard setup only, back A K Q J 10, middle 9 8 7 6 5, front 4 3 2, wilds as the missing ranks
//     (none if the middle can only be a straight flush and the back cannot, since the rows would be out of order)
// The cards passed in are never changed: rows hold copies, and a wild placed in a row is a copy with its rank and suit set
// (isWild false, wasWild true), listed in wildAssignments. Cards not used are returned in discards.
// Usage: findAutomatics(cards) -> { best, automatics: { 'three-full-houses', dragon, 'three-straight', 'three-flush' } }
//   best is the highest automatic present (three full houses > dragon > three straight > three flush) or null;
//   each automatic is null or { back, middle, front, discards, wildAssignments }; a three flush with a wild to spare also
//   has variants, every distinct three-flush arrangement strongest first (variants[0] is the arrangement itself).

(function attachFindAutomatics() {
    const AUTOMATIC_PRECEDENCE_ORDER = ['three-full-houses', 'dragon', 'three-straight', 'three-flush'];
    const SUITS = ['♠', '♥', '♦', '♣'];
    const RANK_TEXT = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
    const DRAGON_ROWS = [[14, 13, 12, 11, 10], [9, 8, 7, 6, 5], [4, 3, 2]];
    const MAX_FLUSH_VARIANTS = 6;

    // Full-house rows strongest first: [trips value, pair value], as evaluateHand ranks them
    const FULL_HOUSE_ROWS = [];
    for (let tripsValue = 14; tripsValue >= 2; tripsValue--) {
        for (let pairValue = 14; pairValue >= 2; pairValue--) {
            if (pairValue !== tripsValue) FULL_HOUSE_ROWS.push([tripsValue, pairValue]);
        }
    }

    // Straight windows strongest first, as evaluateHand ranks them: A-high, then the wheel (A with 5), then K-high down to 6-high
    const STRAIGHT_WINDOWS = [{ values: [14, 13, 12, 11, 10], strength: [14, 13] }, { values: [14, 5, 4, 3, 2], strength: [14, 5] }];
    for (let highValue = 13; highValue >= 6; highValue--) {
        STRAIGHT_WINDOWS.push({
            values: [highValue, highValue - 1, highValue - 2, highValue - 3, highValue - 4],
            strength: [highValue, highValue - 1]
        });
    }

    function compareStrengths(firstStrength, secondStrength) {
        const sharedLength = Math.min(firstStrength.length, secondStrength.length);
        for (let index = 0; index < sharedLength; index++) {
            if (firstStrength[index] !== secondStrength[index]) return firstStrength[index] > secondStrength[index] ? 1 : -1;
        }
        return firstStrength.length - secondStrength.length;
    }

    // Three row strengths compared strongest row first
    function compareRowStrengthSets(firstRowStrengths, secondRowStrengths) {
        const firstSorted = [...firstRowStrengths].sort((a, b) => compareStrengths(b, a));
        const secondSorted = [...secondRowStrengths].sort((a, b) => compareStrengths(b, a));
        for (let index = 0; index < firstSorted.length; index++) {
            const rowComparison = compareStrengths(firstSorted[index], secondSorted[index]);
            if (rowComparison !== 0) return rowComparison;
        }
        return 0;
    }

    function countCards(cards) {
        const naturalCountByValue = new Array(15).fill(0);
        const naturalCountByValueAndSuit = new Array(15 * 4).fill(0);
        const naturalValuesBySuit = [[], [], [], []];
        let wildCount = 0;
        cards.forEach((card) => {
            if (card.isWild) {
                wildCount++;
                return;
            }
            const suitIndex = SUITS.indexOf(card.suit);
            naturalCountByValue[card.value]++;
            naturalCountByValueAndSuit[card.value * 4 + suitIndex]++;
            naturalValuesBySuit[suitIndex].push(card.value);
        });
        naturalValuesBySuit.forEach((suitValues) => suitValues.sort((a, b) => b - a));
        return { naturalCountByValue, naturalCountByValueAndSuit, naturalValuesBySuit, wildCount };
    }

    // ---------- building rows from real cards ----------

    function createCardPool(cards) {
        return {
            naturalCards: cards.filter((card) => !card.isWild).map((card) => ({ ...card })),
            wildCards: cards.filter((card) => card.isWild).map((card) => ({ ...card })),
            wildAssignments: []
        };
    }

    function takeNaturalCard(cardPool, value, suit) {
        const cardIndex = cardPool.naturalCards.findIndex((card) => card.value === value && (!suit || card.suit === suit));
        return cardIndex < 0 ? null : cardPool.naturalCards.splice(cardIndex, 1)[0];
    }

    function takeWildAs(cardPool, value, suit) {
        const wildCard = cardPool.wildCards.shift();
        const rankText = RANK_TEXT[value] || String(value);
        cardPool.wildAssignments.push({ id: wildCard.id, rank: rankText, suit });
        return { ...wildCard, rank: rankText, suit, value, number: value, isWild: false, wasWild: true };
    }

    // A natural card of this value (and suit, if given), otherwise a wild set to it
    function takeCard(cardPool, value, suit, wildSuit) {
        return takeNaturalCard(cardPool, value, suit) || takeWildAs(cardPool, value, suit || wildSuit);
    }

    function finishArrangement(cardPool, rows) {
        return {
            back: rows[0],
            middle: rows[1],
            front: rows[2],
            discards: [...cardPool.naturalCards, ...cardPool.wildCards],
            wildAssignments: cardPool.wildAssignments
        };
    }

    // Three 5-card rows in back, middle, front order by the game's own evaluateHand
    function finishFiveCardRows(cardPool, rows) {
        const orderedRows = rows
            .map((rowCards) => ({ rowCards, handStrength: evaluateHand(rowCards).handStrength }))
            .sort((first, second) => compareTuples(second.handStrength, first.handStrength))
            .map((evaluatedRow) => evaluatedRow.rowCards);
        return finishArrangement(cardPool, orderedRows);
    }

    // ---------- three full houses ----------

    // Depth-first over rows strongest first, each row no stronger than the one before: the first three found are the
    // strongest set. Natural cards are used before wilds, so the wilds used equal the exact shortfall.
    function findThreeFullHouseRows(cardCounts) {
        const remainingByValue = [...cardCounts.naturalCountByValue];
        let wildsLeft = cardCounts.wildCount;
        let naturalsLeft = remainingByValue.reduce((total, count) => total + count, 0);
        const chosenRows = [];

        function chooseRow(firstRowIndex) {
            if (chosenRows.length === 3) return true;
            if (naturalsLeft + wildsLeft < 5 * (3 - chosenRows.length)) return false;
            for (let rowIndex = firstRowIndex; rowIndex < FULL_HOUSE_ROWS.length; rowIndex++) {
                const [tripsValue, pairValue] = FULL_HOUSE_ROWS[rowIndex];
                if (remainingByValue[tripsValue] + wildsLeft < 3 || remainingByValue[pairValue] + wildsLeft < 2) continue;
                const tripsNaturals = Math.min(3, remainingByValue[tripsValue]);
                const pairNaturals = Math.min(2, remainingByValue[pairValue]);
                const wildsNeeded = 5 - tripsNaturals - pairNaturals;
                if (wildsNeeded > wildsLeft) continue;
                remainingByValue[tripsValue] -= tripsNaturals;
                remainingByValue[pairValue] -= pairNaturals;
                naturalsLeft -= tripsNaturals + pairNaturals;
                wildsLeft -= wildsNeeded;
                chosenRows.push(FULL_HOUSE_ROWS[rowIndex]);
                if (chooseRow(rowIndex)) return true;
                chosenRows.pop();
                remainingByValue[tripsValue] += tripsNaturals;
                remainingByValue[pairValue] += pairNaturals;
                naturalsLeft += tripsNaturals + pairNaturals;
                wildsLeft += wildsNeeded;
            }
            return false;
        }

        return chooseRow(0) ? chosenRows : null;
    }

    function arrangeThreeFullHouses(cards, cardCounts) {
        const fullHouseRows = findThreeFullHouseRows(cardCounts);
        if (!fullHouseRows) return null;
        const cardPool = createCardPool(cards);
        const rows = fullHouseRows.map(([tripsValue, pairValue]) => [
            takeCard(cardPool, tripsValue, null, '♠'), takeCard(cardPool, tripsValue, null, '♠'), takeCard(cardPool, tripsValue, null, '♠'),
            takeCard(cardPool, pairValue, null, '♠'), takeCard(cardPool, pairValue, null, '♠')
        ]);
        return finishFiveCardRows(cardPool, rows);
    }

    // ---------- three straights ----------

    // Every set of three windows the cards can fill, ignoring suits
    function findStraightWindowSets(cardCounts) {
        const remainingByValue = [...cardCounts.naturalCountByValue];
        let wildsLeft = cardCounts.wildCount;
        const chosenWindows = [];
        const windowSets = [];

        function chooseWindow(firstWindowIndex) {
            if (chosenWindows.length === 3) {
                windowSets.push([...chosenWindows]);
                return;
            }
            for (let windowIndex = firstWindowIndex; windowIndex < STRAIGHT_WINDOWS.length; windowIndex++) {
                const windowValues = STRAIGHT_WINDOWS[windowIndex].values;
                const missingValues = windowValues.filter((value) => remainingByValue[value] === 0);
                if (missingValues.length > wildsLeft) continue;
                windowValues.forEach((value) => { if (remainingByValue[value] > 0) remainingByValue[value]--; });
                wildsLeft -= missingValues.length;
                chosenWindows.push(windowIndex);
                chooseWindow(windowIndex);
                chosenWindows.pop();
                wildsLeft += missingValues.length;
                windowValues.forEach((value) => { if (!missingValues.includes(value)) remainingByValue[value]++; });
            }
        }

        chooseWindow(0);
        return windowSets;
    }

    // Wilds needed for three straight rows where some rows are straight flushes (suit index) and others any suits (-1).
    // Each straight flush takes its exact cards first; plain rows then take any card of the value left over.
    function wildsNeededForStraightRows(cardCounts, windowSet, rowSuits) {
        const exactNeed = new Map();
        const plainNeed = new Array(15).fill(0);
        windowSet.forEach((windowIndex, rowIndex) => {
            STRAIGHT_WINDOWS[windowIndex].values.forEach((value) => {
                if (rowSuits[rowIndex] < 0) plainNeed[value]++;
                else {
                    const cardKey = value * 4 + rowSuits[rowIndex];
                    exactNeed.set(cardKey, (exactNeed.get(cardKey) || 0) + 1);
                }
            });
        });
        const leftoverByValue = [...cardCounts.naturalCountByValue];
        let wildsNeeded = 0;
        exactNeed.forEach((neededCount, cardKey) => {
            const naturalsUsed = Math.min(neededCount, cardCounts.naturalCountByValueAndSuit[cardKey]);
            wildsNeeded += neededCount - naturalsUsed;
            leftoverByValue[Math.floor(cardKey / 4)] -= naturalsUsed;
        });
        plainNeed.forEach((neededCount, value) => { wildsNeeded += Math.max(0, neededCount - leftoverByValue[value]); });
        return wildsNeeded;
    }

    function arrangeThreeStraights(cards, cardCounts) {
        const windowSets = findStraightWindowSets(cardCounts);
        if (windowSets.length === 0) return null;

        // Suits each window could be a straight flush in, counting that row alone
        const straightFlushSuitsByWindow = STRAIGHT_WINDOWS.map((straightWindow) => [0, 1, 2, 3].filter((suitIndex) =>
            straightWindow.values.filter((value) => cardCounts.naturalCountByValueAndSuit[value * 4 + suitIndex] === 0).length <= cardCounts.wildCount));

        let bestPlan = null;
        windowSets.forEach((windowSet) => {
            const suitOptionsByRow = windowSet.map((windowIndex) => [-1, ...straightFlushSuitsByWindow[windowIndex]]);
            suitOptionsByRow[0].forEach((backSuit) => suitOptionsByRow[1].forEach((middleSuit) => suitOptionsByRow[2].forEach((frontSuit) => {
                const rowSuits = [backSuit, middleSuit, frontSuit];
                if (wildsNeededForStraightRows(cardCounts, windowSet, rowSuits) > cardCounts.wildCount) return;
                const rowStrengths = windowSet.map((windowIndex, rowIndex) => [rowSuits[rowIndex] < 0 ? 6 : 9, ...STRAIGHT_WINDOWS[windowIndex].strength]);
                if (!bestPlan || compareRowStrengthSets(rowStrengths, bestPlan.rowStrengths) > 0) {
                    bestPlan = { windowSet, rowSuits, rowStrengths };
                }
            })));
        });

        const cardPool = createCardPool(cards);
        const rows = [[], [], []];
        const rowIndexesStraightFlushFirst = [0, 1, 2].sort((first, second) => (bestPlan.rowSuits[second] >= 0) - (bestPlan.rowSuits[first] >= 0));
        rowIndexesStraightFlushFirst.forEach((rowIndex) => {
            const rowSuit = bestPlan.rowSuits[rowIndex] < 0 ? null : SUITS[bestPlan.rowSuits[rowIndex]];
            STRAIGHT_WINDOWS[bestPlan.windowSet[rowIndex]].values.forEach((value) => {
                rows[rowIndex].push(takeCard(cardPool, value, rowSuit, '♠'));
            });
        });
        return finishFiveCardRows(cardPool, rows);
    }

    // ---------- three flushes ----------

    // Strongest single row from one suit's natural values (highest first) and up to wildsAvailable wilds of that suit:
    // a straight flush if possible, otherwise the best flush, with wilds as the highest values not already in the row
    function chooseBestFlushRow(suitValues, wildsAvailable) {
        for (const straightWindow of STRAIGHT_WINDOWS) {
            const missingValues = straightWindow.values.filter((value) => !suitValues.includes(value));
            if (missingValues.length <= wildsAvailable) {
                return {
                    naturalValues: straightWindow.values.filter((value) => suitValues.includes(value)),
                    wildValues: missingValues,
                    rowStrength: [9, ...straightWindow.strength]
                };
            }
        }
        let bestRow = null;
        for (let wildsUsed = 0; wildsUsed <= Math.min(wildsAvailable, 5); wildsUsed++) {
            if (suitValues.length < 5 - wildsUsed) continue;
            const naturalValues = suitValues.slice(0, 5 - wildsUsed);
            const wildValues = [];
            for (let value = 14; value >= 2 && wildValues.length < wildsUsed; value--) {
                if (!naturalValues.includes(value)) wildValues.push(value);
            }
            const rowStrength = [5, ...[...naturalValues, ...wildValues].sort((a, b) => b - a)];
            if (!bestRow || compareStrengths(rowStrength, bestRow.rowStrength) > 0) bestRow = { naturalValues, wildValues, rowStrength };
        }
        return bestRow;
    }

    // Rows for one suit triple with a given number of wilds per suit; rows of the same suit are built strongest first
    function planFlushRows(cardCounts, rowsBySuit, wildsBySuit) {
        const rowPlans = [];
        for (let suitIndex = 0; suitIndex < 4; suitIndex++) {
            const suitValues = [...cardCounts.naturalValuesBySuit[suitIndex]];
            let wildsAvailable = wildsBySuit[suitIndex];
            for (let rowNumber = 0; rowNumber < rowsBySuit[suitIndex]; rowNumber++) {
                const rowPlan = chooseBestFlushRow(suitValues, wildsAvailable);
                rowPlan.naturalValues.forEach((value) => suitValues.splice(suitValues.indexOf(value), 1));
                wildsAvailable -= rowPlan.wildValues.length;
                rowPlans.push({ suitIndex, ...rowPlan });
            }
        }
        return rowPlans;
    }

    // Every way to give the spare wilds to the suits in use
    function spreadSpareWilds(spareWilds, suitIndexes) {
        if (suitIndexes.length === 1) return [[spareWilds]];
        const spreads = [];
        for (let firstSuitWilds = 0; firstSuitWilds <= spareWilds; firstSuitWilds++) {
            spreadSpareWilds(spareWilds - firstSuitWilds, suitIndexes.slice(1)).forEach((restSpread) => spreads.push([firstSuitWilds, ...restSpread]));
        }
        return spreads;
    }

    function buildFlushArrangement(cards, rowPlans) {
        const cardPool = createCardPool(cards);
        const rows = rowPlans.map((rowPlan) => {
            const suit = SUITS[rowPlan.suitIndex];
            return [
                ...rowPlan.naturalValues.map((value) => takeNaturalCard(cardPool, value, suit)),
                ...rowPlan.wildValues.map((value) => takeWildAs(cardPool, value, suit))
            ];
        });
        return finishFiveCardRows(cardPool, rows);
    }

    function arrangeThreeFlushes(cards, cardCounts) {
        const flushPlans = [];
        let hasSpareWild = false;
        for (let first = 0; first < 4; first++) for (let second = first; second < 4; second++) for (let third = second; third < 4; third++) {
            const rowsBySuit = [0, 0, 0, 0];
            [first, second, third].forEach((suitIndex) => { rowsBySuit[suitIndex]++; });
            const shortfallBySuit = rowsBySuit.map((rowCount, suitIndex) =>
                Math.max(0, 5 * rowCount - cardCounts.naturalValuesBySuit[suitIndex].length));
            const spareWilds = cardCounts.wildCount - shortfallBySuit.reduce((total, shortfall) => total + shortfall, 0);
            if (spareWilds < 0) continue;
            if (spareWilds > 0) hasSpareWild = true;
            const suitsInUse = [0, 1, 2, 3].filter((suitIndex) => rowsBySuit[suitIndex] > 0);
            spreadSpareWilds(spareWilds, suitsInUse).forEach((spareSpread) => {
                const wildsBySuit = [...shortfallBySuit];
                suitsInUse.forEach((suitIndex, spreadIndex) => { wildsBySuit[suitIndex] += spareSpread[spreadIndex]; });
                const rowPlans = planFlushRows(cardCounts, rowsBySuit, wildsBySuit);
                const signature = rowPlans
                    .map((rowPlan) => `${rowPlan.suitIndex}:${rowPlan.naturalValues.join(',')}/${rowPlan.wildValues.join(',')}`)
                    .sort().join(' ');
                if (flushPlans.some((flushPlan) => flushPlan.signature === signature)) return;
                flushPlans.push({ rowPlans, signature, rowStrengths: rowPlans.map((rowPlan) => rowPlan.rowStrength) });
            });
        }
        if (flushPlans.length === 0) return null;

        flushPlans.sort((first, second) => compareRowStrengthSets(second.rowStrengths, first.rowStrengths));
        const bestArrangement = buildFlushArrangement(cards, flushPlans[0].rowPlans);
        if (hasSpareWild && flushPlans.length > 1) {
            bestArrangement.variants = [bestArrangement, ...flushPlans.slice(1, MAX_FLUSH_VARIANTS)
                .map((flushPlan) => buildFlushArrangement(cards, flushPlan.rowPlans))];
        }
        return bestArrangement;
    }

    // ---------- dragon ----------

    function isOneSuit(rowCards) {
        return rowCards.every((card) => card.suit === rowCards[0].suit);
    }

    // Standard setup only. The middle 9-8-7-6-5 is a straight flush if all one suit, which would beat a plain A-K-Q-J-10
    // back; then change the middle's suit by re-suiting its wild, swapping in another natural card, or using a spare wild.
    function arrangeDragon(cards, cardCounts) {
        const missingValues = DRAGON_ROWS.flat().filter((value) => cardCounts.naturalCountByValue[value] === 0);
        if (missingValues.length > cardCounts.wildCount) return null;

        const cardPool = createCardPool(cards);
        const rows = DRAGON_ROWS.map((rowValues) => rowValues.map((value) => takeCard(cardPool, value, null, '♠')));
        const [backRow, middleRow] = rows;

        if (isOneSuit(middleRow) && !isOneSuit(backRow)) {
            const middleSuit = middleRow[0].suit;
            const otherSuit = SUITS.find((suit) => suit !== middleSuit);
            const wildIndex = middleRow.findIndex((card) => cardPool.wildAssignments.some((assignment) => assignment.id === card.id));
            const swapIndex = middleRow.findIndex((card) => cardPool.naturalCards.some((spare) => spare.value === card.value && spare.suit !== middleSuit));
            if (wildIndex >= 0) {
                const wildCard = middleRow[wildIndex];
                wildCard.suit = otherSuit;
                cardPool.wildAssignments.find((assignment) => assignment.id === wildCard.id).suit = otherSuit;
            } else if (swapIndex >= 0) {
                const replacedCard = middleRow[swapIndex];
                const spareIndex = cardPool.naturalCards.findIndex((spare) => spare.value === replacedCard.value && spare.suit !== middleSuit);
                middleRow[swapIndex] = cardPool.naturalCards.splice(spareIndex, 1, replacedCard)[0];
            } else if (cardPool.wildCards.length > 0) {
                const replacedCard = middleRow[0];
                middleRow[0] = takeWildAs(cardPool, replacedCard.value, otherSuit);
                cardPool.naturalCards.push(replacedCard);
            } else {
                // The middle must be a straight flush: the back has to be one too, or the standard setup is out of order
                const backSuitIndex = [0, 1, 2, 3].find((suitIndex) => DRAGON_ROWS[0].every((value) =>
                    cardCounts.naturalCountByValue[value] === 0 || cardCounts.naturalCountByValueAndSuit[value * 4 + suitIndex] > 0));
                if (backSuitIndex === undefined) return null;
                const backSuit = SUITS[backSuitIndex];
                backRow.forEach((card, cardIndex) => {
                    if (card.suit === backSuit) return;
                    const wildAssignment = cardPool.wildAssignments.find((assignment) => assignment.id === card.id);
                    if (wildAssignment) {
                        card.suit = backSuit;
                        wildAssignment.suit = backSuit;
                        return;
                    }
                    const spareIndex = cardPool.naturalCards.findIndex((spare) => spare.value === card.value && spare.suit === backSuit);
                    backRow[cardIndex] = cardPool.naturalCards.splice(spareIndex, 1, card)[0];
                });
            }
        }
        return finishArrangement(cardPool, rows);
    }

    // ---------- entry point ----------

    function findAutomatics(cards) {
        const cardCounts = countCards(cards);
        const automatics = {
            'three-full-houses': arrangeThreeFullHouses(cards, cardCounts),
            dragon: arrangeDragon(cards, cardCounts),
            'three-straight': arrangeThreeStraights(cards, cardCounts),
            'three-flush': arrangeThreeFlushes(cards, cardCounts)
        };
        const best = AUTOMATIC_PRECEDENCE_ORDER.find((automaticType) => automatics[automaticType]) || null;
        return { best, automatics };
    }

    window.findAutomatics = findAutomatics;
})();
