// js/utilities/empirical-win-probability.js
// Step 1: CSV Parser for empirical win probability data
// Parses data/hand_tuple_lookup.csv into usable lookup structure

class EmpiricalWinProbability {
    constructor() {
        this.probabilityMap = new Map();
        this.isLoaded = false;
        this.loadError = null;
    }

    /**
     * Load and parse CSV data from file
     * @returns {Promise<boolean>} - True if loaded successfully
     */
    async loadData() {
        try {
//            console.log('🔍 Loading Empirical Win Probability from CSV...');

            // Fetch the CSV file
            const response = await fetch('data/empirical_win_probability.csv');
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
            }

            const csvText = await response.text();
            this.parseCSV(csvText);

//            console.log(`✅ Loaded ${this.probabilityMap.size} probability entries`);
            this.isLoaded = true;
            return true;

        } catch (error) {
            console.error('❌ Error loading win probability data:', error);
            this.loadError = error.message;
            return false;
        }
    }

    /**
     * Parse CSV text into probability map
     * @param {string} csvText - Raw CSV content
     */
    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');

        // Skip header row (assumes first line is headers)
        const dataLines = lines.slice(1);

        let parseCount = 0;
        let errorCount = 0;

        dataLines.forEach((line, index) => {
            try {
                // Parse CSV line (handle quoted fields)
                const fields = this.parseCSVLine(line);

                if (fields.length >= 5) {
                    const position = fields[0].trim();
                    const handRankStr = fields[1].trim();
                    const wins = parseInt(fields[2]);
                    const total = parseInt(fields[3]);
                    const probability = parseFloat(fields[4]);

                    // Convert hand rank string "(10, 10)" to array [10, 10]
                    const handRank = this.parseHandRank(handRankStr);

                    if (handRank && !isNaN(probability) && total > 0) {
                        // Create lookup key
                        const key = this.createLookupKey(position, handRank);

                        // Store in map
                        this.probabilityMap.set(key, {
                            position,
                            handRank,
                            wins,
                            total,
                            probability
                        });

                        parseCount++;
                    } else {
                        throw new Error(`Invalid data values`);
                    }
                } else {
                    throw new Error(`Expected 5 fields, got ${fields.length}`);
                }

            } catch (error) {
                console.warn(`⚠️  Line ${index + 2}: ${error.message} - "${line}"`);
                errorCount++;
            }
        });

//        console.log(`📊 CSV parsing complete: ${parseCount} entries parsed, ${errorCount} errors`);

        if (parseCount === 0) {
            throw new Error('No valid data entries found in CSV');
        }
    }

    /**
     * Parse a single CSV line, handling quoted fields
     * @param {string} line - CSV line
     * @returns {Array<string>} - Array of field values
     */
    parseCSVLine(line) {
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

        fields.push(current); // Add last field
        return fields;
    }

    /**
     * Parse hand rank string "(10, 10)" to array [10, 10]
     * @param {string} handRankStr - Hand rank as string
     * @returns {Array<number>|null} - Hand rank array or null if invalid
     */

    parseHandRank(handRankStr) {
        try {
            // Step 1: Remove double quotes only
            let cleaned = handRankStr;
            if (cleaned.startsWith('"')) {
                cleaned = cleaned.slice(1);
            }
            if (cleaned.endsWith('"')) {
                cleaned = cleaned.slice(0, -1);
            }

            // Step 2: Extract content between parentheses
            if (!cleaned.startsWith('(') || !cleaned.endsWith(')')) {
                return null;
            }
            const innerContent = cleaned.slice(1, -1); // Remove ( and )

            // Step 3: Parse numbers
            const values = innerContent.split(',').map(v => {
                const num = parseInt(v.trim());
                return isNaN(num) ? null : num;
            });

            // Return null if any value is invalid
            return values.includes(null) ? null : values;

        } catch (error) {
            return null;
        }
    }

    /**
     * Create lookup key for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {string} - Lookup key
     */
    createLookupKey(position, handRank) {
        return `${position.toLowerCase()}:${handRank.join(',')}`;
    }

    /**
     * Get win probability for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {number|null} - Win probability or null if not found
     */
    getEmpiricalWinProbability(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️  Empirical Win probability data not loaded yet');
            return null;
        }

        const key = this.createLookupKey(position, handRank);
        const entry = this.probabilityMap.get(key);

        return entry ? entry.probability : null;
    }

    /**
     * Get detailed data for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {Object|null} - Full entry or null if not found
     */
    getDetailedData(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️  Empirical Win probability not loaded yet');
            return null;
        }

        const key = this.createLookupKey(position, handRank);
        return this.probabilityMap.get(key) || null;
    }

    /**
     * Get statistics about loaded data
     * @returns {Object} - Data statistics
     */
    getStatistics() {
        if (!this.isLoaded) {
            return { loaded: false, error: this.loadError };
        }

        const positions = new Set();
        const handRanks = new Set();
        let totalWins = 0;
        let totalGames = 0;

        this.probabilityMap.forEach(entry => {
            positions.add(entry.position);
            handRanks.add(entry.handRank.join(','));
            totalWins += entry.wins;
            totalGames += entry.total;
        });

        return {
            loaded: true,
            totalEntries: this.probabilityMap.size,
            positions: Array.from(positions),
            uniqueHandRanks: handRanks.size,
            totalWins,
            totalGames,
            overallWinRate: totalGames > 0 ? (totalWins / totalGames) : 0
        };
    }

}

// Add this section after the class definition and before the lookup functions:

// Create singleton instance
const empiricalWinProbability = new EmpiricalWinProbability();

// =============================================================================
// INCOMPLETE FRONT HAND HANDLING
// =============================================================================

// Hardcoded win probabilities for incomplete front pairs (from empirical data)
const FRONT_PAIR_WIN_PROBABILITIES = {
    2: 0.06835,   // Pair of 2s (extrapolated)
    3: 0.07355,   // Pair of 3s
    4: 0.07875,   // Pair of 4s
    5: 0.08542,   // Pair of 5s
    6: 0.09197,   // Pair of 6s
    7: 0.12046,   // Pair of 7s
    8: 0.12847,   // Pair of 8s
    9: 0.15077,   // Pair of 9s
    10: 0.17756,  // Pair of 10s
    11: 0.21210,  // Pair of Jacks
    12: 0.27089,  // Pair of Queens
    13: 0.33715,  // Pair of Kings
    14: 0.42356   // Pair of Aces
};

// Middle hand lookup tables for incomplete hands (from empirical data)

// High card probabilities for middle position
const MIDDLE_HIGH_CARD_WIN_PROBABILITIES = {
    // Based on middle,"(0, 0)",3,1970,0.0015228426395939086
    'default': 0.0015  // Very low chance for any high card in middle
};

// Pair probabilities for middle position (adjusted for small sample sizes)
const MIDDLE_PAIR_WIN_PROBABILITIES = {
    // PLACEHOLDER: ascending fill so a higher pair never scores lower. No measured data (tiered2/empirical rows are empty or too thin). Replace after a real deal run (scripts/deal-lookup-rounds.js).
    2: 0.0160,
    3: 0.01628,   // middle,"(2, 3)",35,2150,0.01627906976744186
    4: 0.01638,
    5: 0.01648,
    6: 0.01658,
    7: 0.01668,
    8: 0.01678,
    9: 0.01688,
    10: 0.01698,
    11: 0.017,    // Adjusted from 0.0 (small sample)
    12: 0.018,    // Adjusted from 0.01429 to maintain order
    13: 0.019,    // Adjusted from 0.0 (small sample)
    14: 0.020     // Adjusted from 0.0 (small sample)
};

// Two Pair probabilities for middle position (handType = 3)
const MIDDLE_TWO_PAIR_WIN_PROBABILITIES = {
    // Key format: "higherPair,lowerPair" - adjusted to ensure proper ordering
    "3,2": 0.022,    // Must exceed best pair (Ace pair = 0.020)
    "4,2": 0.023,    // Scale up from 3,2
    "4,3": 0.024,    // Better than 4,2
    "5,2": 0.025,    // Better than 4,3
    "5,3": 0.026,    // Better than 5,2
    "5,4": 0.027,    // Better than 5,3
    "6,2": 0.028,    // Better than 5,4
    "6,3": 0.029,    // Better than 6,2
    "6,4": 0.030,    // Better than 6,3 - now use empirical data where reliable
    "6,5": 0.032,  // middle,"(3, 6, 5)",116,3640,0.031868131868131866
    "7,2": 0.056,  // middle,"(3, 7, 2)",11,195,0.05641025641025641
    "7,3": 0.057,    // Must be higher than 7,2
    "7,4": 0.058,    // Must be higher than 7,3 (was 0.05397 - too low)
    "7,5": 0.059,    // Must be higher than 7,4 (was 0.02105 - too low)
    "7,6": 0.0595,  // middle,"(3, 7, 6)",11,185,0.05945945945945946
    "8,2": 0.060,    // Must be higher than 7,6
    "8,3": 0.0605,    // Must be higher than 8,2
    "8,4": 0.061,    // Must be higher than 8,3
    "8,5": 0.0615,    // Must be higher than 8,4
    "8,6": 0.062,    // Must be higher than 8,5
    "8,7": 0.0625,    // Must be higher than 8,6
    "9,2": 0.063,     // middle,"(3, 9, 2)",24,300,0.08
    "9,3": 0.0635,    // Must be higher than 9,2
    "9,4": 0.064,    // Must be higher than 9,3
    "9,5": 0.0645,    // Must be higher than 9,4
    "9,6": 0.065,    // Must be higher than 9,5
    "9,7": 0.0655,    // Must be higher than 9,6
    "9,8": 0.066,    // Must be higher than 9,7
    "10,2": 0.0665, // middle,"(3, 10, 2)",5,135,0.037037037037037035
    "10,3": 0.067,  // middle,"(3, 10, 3)",5,80,0.0625
    "10,4": 0.0675, // middle,"(3, 10, 4)",6,140,0.04285714285714286
    "10,5": 0.068, // middle,"(3, 10, 5)",24,355,0.0676056338028169
    "10,6": 0.0685, // middle,"(3, 10, 6)",14,225,0.06222222222222222
    "10,7": 0.069, // middle,"(3, 10, 7)",8,215,0.037209302325581395
    "10,8": 0.0695,    // middle,"(3, 10, 8)",36,720,0.05
    "10,9": 0.070, // middle,"(3, 10, 9)",7,180,0.03888888888888889
    "11,2": 0.0705, // middle,"(3, 11, 2)",38,510,0.07450980392156863
    "11,3": 0.071, // middle,"(3, 11, 3)",5,90,0.05555555555555555
    "11,4": 0.0715, // middle,"(3, 11, 4)",27,570,0.04736842105263158
    "11,5": 0.072, // middle,"(3, 11, 5)",17,280,0.060714285714285714
    "11,6": 0.0735, // middle,"(3, 11, 6)",23,275,0.08363636363636363
    "11,7": 0.073,    // middle,"(3, 11, 7)",68,850,0.08
    "11,8": 0.0735, // middle,"(3, 11, 8)",8,130,0.06153846153846154
    "11,9": 0.074, // middle,"(3, 11, 9)",5,70,0.07142857142857142
    "11,10": 0.0745, // middle,"(3, 11, 10)",3,85,0.03529411764705882
    "12,2": 0.075, // middle,"(3, 12, 2)",39,550,0.07090909090909091
    "12,3": 0.0755, // middle,"(3, 12, 3)",17,210,0.08095238095238096
    "12,4": 0.076,   // middle,"(3, 12, 4)",18,250,0.072
    "12,5": 0.0765, // middle,"(3, 12, 5)",7,105,0.06666666666666667
    "12,6": 0.077, // middle,"(3, 12, 6)",10,75,0.13333333333333333
    "12,7": 0.0775, // middle,"(3, 12, 7)",25,330,0.07575757575757576
    "12,8": 0.078,  // middle,"(3, 12, 8)",4,105,0.0380952380952381
    "12,9": 0.0785, // middle,"(3, 12, 9)",37,455,0.08131868131868132
    "12,10": 0.079, // middle,"(3, 12, 10)",4,60,0.06666666666666667
    "12,11": 0.0795, // middle,"(3, 12, 11)",72,730,0.09863013698630137
    "13,2": 0.08, // middle,"(3, 13, 2)",7,75,0.09333333333333334
    "13,3": 0.0805,    // Adjusted from 0.0 (small sample)
    "13,4": 0.081, // middle,"(3, 13, 4)",7,130,0.05384615384615385
    "13,5": 0.0812, // middle,"(3, 13, 5)",5,70,0.07142857142857142
    "13,6": 0.0814, // middle,"(3, 13, 6)",5,95,0.05263157894736842
    "13,7": 0.0816, // middle,"(3, 13, 7)",8,85,0.09411764705882353
    "13,8": 0.0818, // middle,"(3, 13, 8)",6,55,0.10909090909090909
    "13,9": 0.082, // middle,"(3, 13, 9)",45,490,0.09183673469387756
    "13,10": 0.0822, // middle,"(3, 13, 10)",17,225,0.07555555555555556
    "13,11": 0.0824, // middle,"(3, 13, 11)",20,195,0.10256410256410256
    "13,12": 0.0826,
    "14,2": 0.0828, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,3": 0.083, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,4": 0.0832, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,5": 0.0834, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,6": 0.0836, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,7": 0.0838, // middle,"(3, 14, 6)",7,45,0.15555555555555556
    "14,8": 0.084,     // middle,"(3, 14, 9)",2,20,0.1
    "14,9": 0.085,     // middle,"(3, 14, 9)",2,20,0.1
    "14,10": 0.086,     // middle,"(3, 14, 9)",2,20,0.1
    "14,11": 0.087,     // middle,"(3, 14, 9)",2,20,0.1
    "14,12": 0.088,     // middle,"(3, 14, 9)",2,20,0.1
    "14,13": 0.089 // middle,"(3, 14, 13)",30,350,0.08571428571428572
};

/**
 * Handle incomplete middle hands with empirical data
 * @param {Array<number>} handRank - Hand rank array
 * @returns {number|null} - Win probability or null if not found
 */
function handleIncompleteMiddleHand(handRank) {
    if (handRank.length >= 2) {
        const handType = handRank[0];
        const primaryRank = handRank[1];

        // Handle incomplete high cards in middle position
        if (handType === 1) {
            return MIDDLE_HIGH_CARD_WIN_PROBABILITIES['default'];
        }

        // Handle incomplete pairs in middle position
        if (handType === 2) {
            return MIDDLE_PAIR_WIN_PROBABILITIES[primaryRank] || 0.01;
        }

        // Handle incomplete two pairs in middle position
        if (handType === 3 && handRank.length >= 3) {
            const secondaryRank = handRank[2];
            const key = `${primaryRank},${secondaryRank}`;
            return MIDDLE_TWO_PAIR_WIN_PROBABILITIES[key] || 0.01;
        }
    }

    return null; // Not an incomplete middle hand we can handle
}


/**
 * Handle incomplete front hands with special logic
 * @param {Array<number>} handRank - Hand rank array
 * @returns {number|null} - Win probability or null if not incomplete front hand
 */
function handleIncompleteFrontHand(handRank) {
    if (handRank.length >= 2) {
        const handType = handRank[0];
        const primaryRank = handRank[1];

        // Handle incomplete pairs in front position
        if (handType === 2) {
            return FRONT_PAIR_WIN_PROBABILITIES[primaryRank] || 0.05;
        }

        // Handle incomplete high cards in front position
        if (handType === 1) {
            const baseProb = 0.02; // Lower than worst pair
            const rankBonus = (primaryRank - 2) * 0.002; // Small rank scaling
            return baseProb + rankBonus;
        }
    }

    return null; // Not an incomplete front hand
}

/**
 * Get empirical win probability with complete hand model
 * @param {string} position - Position (back/middle/front)
 * @param {Object} hand - Complete hand object with isIncomplete, hand_rank, etc.
 * @returns {number|null} - Win probability or null if no fallback found
 */
function lookupEmpiricalWinProbability(position, hand) {
    // Extract hand_rank for compatibility
    const handRank = hand.hand_rank || hand.handStrength.handStrength;

    // SPECIAL HANDLING: Incomplete front hands
    if (position.toLowerCase() === 'front' && hand.isIncomplete) {
        const incompleteProbability = handleIncompleteFrontHand(handRank);
        if (incompleteProbability !== null) {
            return incompleteProbability;
        }
    }

    // SPECIAL HANDLING: Incomplete middle/back hands - use empirical data for middle
    if ((position.toLowerCase() === 'middle' || position.toLowerCase() === 'back') && hand.isIncomplete) {
        if (position.toLowerCase() === 'middle') {
            // Try empirical incomplete middle hand lookup
            const empiricalProbability = handleIncompleteMiddleHand(hand.hand_rank);
            if (empiricalProbability !== null) {
                return empiricalProbability;
            }
        }

        // Fall back to low probability for back position or if middle lookup fails
        return 0.01;
    }

    // Try hierarchical fallback - progressively truncate tuple
    for (let length = handRank.length; length >= 1; length--) {
        let truncatedTuple = handRank.slice(0, length);
        let probability = empiricalWinProbability.getEmpiricalWinProbability(position, truncatedTuple);

        if (probability !== null) {
            // Optional: Log fallback level for debugging (comment out to reduce noise)
            // if (length < handRank.length) {
            //     console.log(`🎯 Hierarchical match: level ${length}/${handRank.length} for ${position} [${handRank.join(',')}] → [${truncatedTuple.join(',')}]`);
            // }

            return probability;
        }
    }

    // No match found at any level (comment out to reduce noise)
    // console.warn('🚨 No hierarchical match found for:', position, handRank);
    return null; // Let ScoringUtilities handle the final fallback
}

/**
 * Initialize win probability data (call once at startup)
 * @returns {Promise<boolean>} - True if loaded successfully
 */
async function initializeEmpiricalWinProbability() {
    return await empiricalWinProbability.loadData();
}

/**
 * Get data loading status
 * @returns {Object} - Status information
 */
function getEmpiricalWinProbabilityDataStatus() {
    return {
        isLoaded: empiricalWinProbabilityData.isLoaded,
        error: empiricalWinProbabilityData.loadError,
        statistics: empiricalWinProbabilityData.getStatistics()
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EmpiricalWinProbability,
        lookupEmpiricalWinProbability,
        initializeEmpiricalWinProbabilityData,
        getEmpiricalWinProbabilityDataStatus
    };
}
