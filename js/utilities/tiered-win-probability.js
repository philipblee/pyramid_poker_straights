// js/utilities/Tiered-win-probability.js
// Step 1: CSV Parser for Tiered win probability data
// Parses data/hand_tuple_lookup.csv into usable lookup structure

class TieredWinProbability {
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
//            console.log('🔍 Loading Tiered Win Probability from CSV...');

            // Fetch the CSV file
            const response = await fetch('data/tiered_win_probability.csv');
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
    getTieredWinProbability(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️  Tiered Win probability data not loaded yet');
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
            console.warn('⚠️  Tiered Win probability not loaded yet');
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
const tieredWinProbability = new TieredWinProbability();

/**
 * Get tiered win probability with complete hand model
 * @param {string} position - Position (back/middle/front)
 * @param {Object} hand - Complete hand object with isIncomplete, hand_rank, etc.
 * @returns {number|null} - Win probability or null if no fallback found
 */
function lookupTieredWinProbability(position, hand) {
//    console.log('🔍 Lookup tiered probability:', { position, handRank: hand.hand_rank });

    // Extract hand_rank for compatibility
    const handRank = hand.hand_rank || hand;

    // SPECIAL HANDLING: Incomplete front hands
    if (position.toLowerCase() === 'front' && hand.isIncomplete) {
        const incompleteProbability = handleIncompleteFrontHand(handRank);
        if (incompleteProbability !== null) {
            return incompleteProbability;
        }
    }

    // SPECIAL HANDLING: Incomplete middle/back hands - use tiered data for middle
    if ((position.toLowerCase() === 'middle' || position.toLowerCase() === 'back') && hand.isIncomplete) {
        if (position.toLowerCase() === 'middle') {
            // Try tiered incomplete middle hand lookup
            const tieredProbability = handleIncompleteMiddleHand(hand.hand_rank);
            if (tieredProbability !== null) {
                return tieredProbability;
            }
        }

        // Fall back to low probability for back position or if middle lookup fails
        return 0.001;
    }

    // Full tuple first. Straights are stored whole; shorter prefixes cover flushes and pairs.
    for (let length = handRank.length; length >= 1; length--) {
        let truncatedTuple = handRank.slice(0, length);
        let probability = tieredWinProbability.getTieredWinProbability(position, truncatedTuple);

        if (probability !== null) {
            return probability;
        }
    }

    // Final fallback to hardcoded hand type probabilities
    if (handRank.length >= 2) {
        const handType = handRank[0];
        const primaryRank = handRank[1];

        // Use existing hardcoded fallback functions
        if (position.toLowerCase() === 'front') {
            const frontFallback = handleIncompleteFrontHand(handRank);
            if (frontFallback !== null) {
                console.log(`🎯 Front hardcoded fallback: ${frontFallback}`);
                return frontFallback;
            }
        } else if (position.toLowerCase() === 'middle') {
            const middleFallback = handleIncompleteMiddleHand(handRank);
            if (middleFallback !== null) {
                console.log(`🎯 Middle hardcoded fallback: ${middleFallback}`);
                return middleFallback;
            }
        }
    }

    console.log('❌ No match found at any level, returning null');
    return null; // Let ScoringUtilities handle the final fallback
}



/**
 * Initialize win probability data (call once at startup)
 * @returns {Promise<boolean>} - True if loaded successfully
 */
async function initializeTieredWinProbability() {
    return await tieredWinProbability.loadData();
}

/**
 * Get data loading status
 * @returns {Object} - Status information
 */
function TieredWinProbabilityDataStatus() {
    return {
        isLoaded: tieredWinProbability.isLoaded,
        error: tieredWinProbability.loadError,
        statistics: tieredWinProbability.getStatistics()
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TieredWinProbability,
        lookupTieredWinProbability,
        initializeTieredWinProbabilityData,
        getTieredWinProbabilityDataStatus
    };
}
