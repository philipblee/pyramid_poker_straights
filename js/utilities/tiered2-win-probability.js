// js/utilities/Tiered2-win-probability.js
// Step 1: CSV Parser for Tiered2 win probability data
// Parses data/hand_tuple_lookup.csv into usable lookup structure

window.tiered2LookupCount = 0;

class Tiered2WinProbability {
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
//            console.log('🔍 Loading Tiered2 Win Probability from CSV...');

            // Fetch the CSV file
            const response = await fetch('data/tiered2_win_probability.csv');
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
            }

            const csvText = await response.text();
            this.parseCSV(csvText);

//            console.log(`✅ Loaded ${this.probabilityMap.size} probability entries`);
            this.isLoaded = true;
            return true;

        } catch (error) {
            console.error('❌ Error loading tiered2 win probability data:', error);
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
            throw new Error('No valid data entries found in tiered2 CSV file');
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
     getTiered2WinProbability(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️  Tiered2 Win probability data not loaded yet');
            return null;
        }

        // Try exact match first
        const key = this.createLookupKey(position, handRank);
        let entry = this.probabilityMap.get(key);

        if (entry) {
            return entry.probability;
        }

        // If no exact match, try prefix matching
        const prefix = key.replace(']', ','); // "back,[6,8]" → "back,[6,8,"

        for (const [mapKey, mapValue] of this.probabilityMap) {
            if (mapKey.startsWith(prefix)) {
                // console.log(`🎯 Prefix match: ${key} → ${mapKey} = ${mapValue.probability}`);
                return mapValue.probability;
            }
        }

        return null;
    }
    /**
     * Get detailed data for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {Object|null} - Full entry or null if not found
     */
    getDetailedData(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️  Tiered2 Win probability not loaded yet');
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
const tiered2WinProbability = new Tiered2WinProbability();

/**
 * Get tiered2 win probability with complete hand model
 * @param {string} position - Position (back/middle/front)
 * @param {Object} hand - Complete hand object with isIncomplete, hand_rank, etc.
 * @returns {number|null} - Win probability or null if no fallback found
 */
function lookupTiered2WinProbability(position, hand) {
    window.tiered2LookupCount++;
//     console.log('🔍 Lookup tiered2 probability:', { position, handRank: hand.hand_rank });
    const handRank = hand.hand_rank || hand;

    // SPECIAL HANDLING: Incomplete front hands
    if (position.toLowerCase() === 'front' && hand.isIncomplete) {
        const incompleteProbability = handleIncompleteFrontHand(handRank);
        if (incompleteProbability !== null) {
            return incompleteProbability;
        }
    }

    // SPECIAL HANDLING: Incomplete middle/back hands - use tiered2 data for middle
    if ((position.toLowerCase() === 'middle' || position.toLowerCase() === 'back') && hand.isIncomplete) {
        if (position.toLowerCase() === 'middle') {
            // Try tiered2 incomplete middle hand lookup
            const tiered2Probability = handleIncompleteMiddleHand(hand.hand_rank);
            if (tiered2Probability !== null) {
                return tiered2Probability;
            }
        }

        // Fall back to low probability for back position or if middle lookup fails
        return 0.001;
    }

    // Exact full tuple before the 3-number prefix scan. Straights are stored whole.
    if (Array.isArray(handRank) && handRank.length > 3 && tiered2WinProbability.isLoaded) {
        const exactKey = tiered2WinProbability.createLookupKey(position, handRank);
        const exactEntry = tiered2WinProbability.probabilityMap.get(exactKey);
        if (exactEntry) {
            return exactEntry.probability;
        }
    }

    // Try hierarchical fallback - 3 elements, then 2 elements only
    for (let length = Math.min(handRank.length, 3); length >= 2; length--) {
        let truncatedTuple = handRank.slice(0, length);
        let probability = tiered2WinProbability.getTiered2WinProbability(position, truncatedTuple);

        if (probability !== null) {
//            console.log(`🎯 Hierarchical match: level ${length}/${handRank.length} for ${position} [${handRank.join(',')}] → [${truncatedTuple.join(',')}] = ${probability}`);
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

    return null;
}


/**
 * Initialize win probability data (call once at startup)
 * @returns {Promise<boolean>} - True if loaded successfully
 */
async function initializeTiered2WinProbability() {
    return await tiered2WinProbability.loadData();
}

/**
 * Get data loading status
 * @returns {Object} - Status information
 */
function Tiered2WinProbabilityDataStatus() {
    return {
        isLoaded: tiered2WinProbability.isLoaded,
        error: tiered2WinProbability.loadError,
        statistics: tiered2WinProbability.getStatistics()
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Tiered2WinProbability,
        lookupTiered2WinProbability,
        initializeTiered2WinProbability,
        getTiered2WinProbabilityDataStatus
    };
}
