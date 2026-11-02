// js/utilities/cdf-lookup.js
// Win probability / tie probability / netEV from the CDF opponent arrays
// (data/cdf_arrays_<run>[_noauto].json, written by the analysis repo's scripts/export_cdf_json.py).
// Port of the analysis repo's scripts/cdf_lookup.py; works for keys that were never dealt.
//
// Semantics, for a query key with points p (meta.points[position][type], default 1):
//   key present:  win = below + 0.5 * equal; tieProb = equal
//   key absent:   equal = 0; below = below of the next key up (running total below + equal past the end);
//                 pointsAbove = pointsAbove of the next key down (all points mass before the start)
//   netEV = win * p - (pointsAbove + 0.5 * equal * p)
// Equal-rank opponents count half: the game orders them by suit, which the key does not hold.

const CDF_ONE_SUIT_TYPES = new Set([5, 9, 11, 13, 15]);   // flush / straight flushes end with one suit code

/**
 * Suit-stripped key (type + every rank element) from a full hand_rank tuple
 * @param {Array<number>} handTuple - Full hand_rank tuple
 * @param {number} cardCount - Number of cards in the hand
 * @returns {Array<number>} - Rank key
 */
function rankKeyFromHandTuple(handTuple, cardCount) {
    const suitCodeCount = CDF_ONE_SUIT_TYPES.has(handTuple[0]) ? 1 : cardCount;
    return handTuple.slice(0, handTuple.length - suitCodeCount);
}

/**
 * True for an incomplete hand's tuple, which holds no suit codes: [1, v] (1 card), [2, r] (2 cards),
 * [3, a, b] (4 cards) from hand-detector.js. A complete tuple of a non-flush type holds the type,
 * at least one rank and cardCount suit codes; flush types are never incomplete.
 * @param {Array<number>} handTuple - hand_rank tuple
 * @param {number} cardCount - Number of cards the tuple was built from
 * @returns {boolean}
 */
function isTupleWithoutSuits(handTuple, cardCount) {
    return !CDF_ONE_SUIT_TYPES.has(handTuple[0]) && handTuple.length < cardCount + 2;
}

/**
 * Lexicographic order of integer keys; a shorter key sorts before a longer one sharing its prefix
 */
function compareRankKeys(leftKey, rightKey) {
    const sharedLength = Math.min(leftKey.length, rightKey.length);
    for (let index = 0; index < sharedLength; index++) {
        if (leftKey[index] !== rightKey[index]) {
            return leftKey[index] < rightKey[index] ? -1 : 1;
        }
    }
    return leftKey.length - rightKey.length;
}

class CdfLookupTable {
    constructor() {
        this.cdfJson = null;
        this.prefixSums = null;
        this.isLoaded = false;
        this.loadError = null;
        this.resetUsageCounts();
    }

    /**
     * Counters filled by ScoringUtilities' cdf method: computed lookups by w and by kind
     * (prefixFallback is a subset of incomplete), plus per-hand cache hits
     */
    resetUsageCounts() {
        this.usageCounts = { byW: { 0: 0, 1: 0, 2: 0 }, complete: 0, incomplete: 0, prefixFallback: 0, cacheHits: 0 };
    }

    /**
     * Load from parsed JSON
     * @param {Object} cdfJson - Parsed cdf_arrays JSON
     */
    loadFromJson(cdfJson) {
        for (const [position, positionArrays] of Object.entries(cdfJson.positions)) {
            for (let index = 1; index < positionArrays.keys.length; index++) {
                if (compareRankKeys(positionArrays.keys[index - 1], positionArrays.keys[index]) >= 0) {
                    throw new Error(`cdf keys for ${position} are not sorted at index ${index}`);
                }
            }
        }
        this.cdfJson = cdfJson;
        this.prefixSums = this.buildPrefixSums(cdfJson);
        this.isLoaded = true;
        this.loadError = null;
    }

    /**
     * Per (position, w) running sums of equal_i, equal_i * winProb_i and equal_i * netEV_i
     * (index i holds the sum over keys before i), with winProb_i and netEV_i the present-key lookup
     * values; plus a running count of keys with positive mass
     */
    buildPrefixSums(cdfJson) {
        const prefixSumsByPosition = {};
        for (const [position, positionArrays] of Object.entries(cdfJson.positions)) {
            prefixSumsByPosition[position] = {};
            const keyCount = positionArrays.keys.length;
            for (const wLabel of Object.keys(positionArrays).filter(field => field !== 'keys')) {
                const massArrays = positionArrays[wLabel];
                const cumulativeEqual = new Float64Array(keyCount + 1);
                const cumulativeEqualWin = new Float64Array(keyCount + 1);
                const cumulativeEqualNetEV = new Float64Array(keyCount + 1);
                const cumulativePositiveKeys = new Int32Array(keyCount + 1);
                for (let index = 0; index < keyCount; index++) {
                    const equal = massArrays.equal[index];
                    const keyPoints = this.handPoints(position, positionArrays.keys[index][0]);
                    const keyWin = massArrays.below[index] + 0.5 * equal;
                    const keyNetEV = keyWin * keyPoints - (massArrays.pointsAbove[index] + 0.5 * equal * keyPoints);
                    cumulativeEqual[index + 1] = cumulativeEqual[index] + equal;
                    cumulativeEqualWin[index + 1] = cumulativeEqualWin[index] + equal * keyWin;
                    cumulativeEqualNetEV[index + 1] = cumulativeEqualNetEV[index] + equal * keyNetEV;
                    cumulativePositiveKeys[index + 1] = cumulativePositiveKeys[index] + (equal > 0 ? 1 : 0);
                }
                prefixSumsByPosition[position][wLabel] = {
                    cumulativeEqual, cumulativeEqualWin, cumulativeEqualNetEV, cumulativePositiveKeys
                };
            }
        }
        return prefixSumsByPosition;
    }

    /**
     * Mass-weighted average over all keys starting with prefix:
     * sum(equal_i * x_i) / sum(equal_i) for x = winProb, netEV (each key's own points).
     * With zero total mass, falls back to the absent-key lookup of the prefix itself.
     * @param {string} position - back / middle / front
     * @param {number} w - Focal player's wild count (0, 1, 2)
     * @param {Array<number>} prefix - Leading key elements, e.g. [2, 13]
     * @returns {{winProb: number, netEV: number, mass: number, usedFallback: boolean}}
     */
    lookupPrefixAverage(position, w, prefix) {
        const sortedKeys = this.positionMassArrays(position, w).sortedKeys;
        const prefixLength = prefix.length;
        const firstIndex = this.firstIndexWhere(sortedKeys, key => compareRankKeys(key, prefix) >= 0);
        const endIndex = this.firstIndexWhere(sortedKeys, key => compareRankKeys(key.slice(0, prefixLength), prefix) > 0);
        const sums = this.prefixSums[position][`w${w}`];
        const positiveKeys = sums.cumulativePositiveKeys[endIndex] - sums.cumulativePositiveKeys[firstIndex];
        if (positiveKeys === 0) {
            const absentLookup = this.lookup(position, w, prefix);
            return { winProb: absentLookup.winProb, netEV: absentLookup.netEV, mass: 0, usedFallback: true };
        }
        const mass = sums.cumulativeEqual[endIndex] - sums.cumulativeEqual[firstIndex];
        return {
            winProb: (sums.cumulativeEqualWin[endIndex] - sums.cumulativeEqualWin[firstIndex]) / mass,
            netEV: (sums.cumulativeEqualNetEV[endIndex] - sums.cumulativeEqualNetEV[firstIndex]) / mass,
            mass,
            usedFallback: false
        };
    }

    /**
     * Lowest index whose key satisfies isAtOrPast (monotone over sortedKeys), or sortedKeys.length
     */
    firstIndexWhere(sortedKeys, isAtOrPast) {
        let lowIndex = 0;
        let highIndex = sortedKeys.length;
        while (lowIndex < highIndex) {
            const middleIndex = (lowIndex + highIndex) >> 1;
            if (isAtOrPast(sortedKeys[middleIndex])) {
                highIndex = middleIndex;
            } else {
                lowIndex = middleIndex + 1;
            }
        }
        return lowIndex;
    }

    /**
     * Sorted keys and mass arrays for (position, w), with the same errors as lookup
     */
    positionMassArrays(position, w) {
        if (!this.isLoaded) {
            throw new Error('CDF data not loaded');
        }
        const positionArrays = this.cdfJson.positions[position];
        if (!positionArrays) {
            throw new Error(`unknown position ${position}; expected one of ${Object.keys(this.cdfJson.positions)}`);
        }
        const massArrays = positionArrays[`w${w}`];
        if (!massArrays) {
            throw new Error(`unknown w ${w} for position ${position}`);
        }
        return { sortedKeys: positionArrays.keys, massArrays };
    }

    /**
     * Load from a JSON file path (node only)
     * @param {string} jsonPath - Path to cdf_arrays JSON
     */
    loadFromFile(jsonPath) {
        const fs = require('fs');
        this.loadFromJson(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    }

    /**
     * Fetch and load from a URL (browser)
     * @param {string} url - URL of cdf_arrays JSON
     * @returns {Promise<boolean>} - True if loaded successfully
     */
    async loadFromUrl(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            }
            this.loadFromJson(await response.json());
            return true;
        } catch (error) {
            console.error('❌ Error loading CDF data:', error);
            this.loadError = error.message;
            return false;
        }
    }

    handPoints(position, handType) {
        return this.cdfJson.meta.points[position][handType] || 1;
    }

    /**
     * Win probability, tie probability and netEV per opponent for a rank key
     * @param {string} position - back / middle / front
     * @param {number} w - Focal player's wild count (0, 1, 2)
     * @param {Array<number>} key - Rank key from rankKeyFromHandTuple
     * @returns {{winProb: number, tieProb: number, netEV: number}}
     */
    lookup(position, w, key) {
        const { sortedKeys, massArrays } = this.positionMassArrays(position, w);
        const keyPoints = this.handPoints(position, key[0]);

        const insertion = this.firstIndexWhere(sortedKeys, sortedKey => compareRankKeys(sortedKey, key) >= 0);   // bisect_left
        const lastIndex = sortedKeys.length - 1;

        let equal;
        let below;
        let pointsAbove;
        if (insertion < sortedKeys.length && compareRankKeys(sortedKeys[insertion], key) === 0) {
            equal = massArrays.equal[insertion];
            below = massArrays.below[insertion];
            pointsAbove = massArrays.pointsAbove[insertion];
        } else {
            equal = 0;
            // past the end: the running total (1 up to rounding), so win stays monotone
            below = insertion < sortedKeys.length
                ? massArrays.below[insertion]
                : massArrays.below[lastIndex] + massArrays.equal[lastIndex];
            pointsAbove = insertion > 0
                ? massArrays.pointsAbove[insertion - 1]
                : massArrays.pointsAbove[0] + massArrays.equal[0] * this.handPoints(position, sortedKeys[0][0]);
        }
        const winProb = below + 0.5 * equal;
        const netEV = winProb * keyPoints - (pointsAbove + 0.5 * equal * keyPoints);
        return { winProb, tieProb: equal, netEV };
    }
}

// Create singleton instance
const cdfLookup = new CdfLookupTable();

/**
 * Initialize CDF data (call once at startup, browser)
 * @param {string} url - URL of cdf_arrays JSON
 * @returns {Promise<boolean>} - True if loaded successfully
 */
async function initializeCdfLookup(url = 'data/cdf_arrays_netev.json') {
    return await cdfLookup.loadFromUrl(url);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CdfLookupTable,
        cdfLookup,
        initializeCdfLookup,
        rankKeyFromHandTuple,
        isTupleWithoutSuits,
        compareRankKeys
    };
}
