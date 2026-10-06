// js/utilities/net-ev-lookup.js
// Net EV Lookup with hierarchical fallback (adapted from empirical-win-netev.js)
window.lookupCount = 0;

class NetEVLookup {
    constructor() {
        this.evMap = new Map();
        this.isLoaded = false;
        this.loadError = null;
    }

    /**
     * Load and parse Net EV CSV data from file
     * @returns {Promise<boolean>} - True if loaded successfully
     */
    async loadData() {
        try {
//            console.log('🎯 Loading Net EV Lookup from CSV...');

            // Fetch the CSV file
            const response = await fetch('data/netEV_lookup_table.csv');
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
            }

            const csvText = await response.text();
            this.parseCSV(csvText);

//            console.log(`✅ Loaded ${this.evMap.size} Net EV entries`);
            this.isLoaded = true;
            return true;

        } catch (error) {
            console.error('❌ Error loading Net EV data:', error);
            this.loadError = error.message;
            return false;
        }
    }

    /**
     * Parse CSV text into EV map
     * @param {string} csvText - Raw CSV content
     */
    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');

        // Skip header row
        const dataLines = lines.slice(1);

        let parseCount = 0;
        let errorCount = 0;

        dataLines.forEach((line, index) => {
            try {
                // Parse CSV line (handle quoted fields)
                const fields = this.parseCSVLine(line);
//                console.log(`${fields[0]}, ${fields[1]}, ${fields[2]}, ${fields[3]}, ${fields[4]}`)

//                console.log(`Raw line: "${line}"`);
////                const fields = this.parseCSVLine(line);
//                console.log(`Parsed fields:`, fields);
//                console.log(`Field 4: "${fields[4]}" (exists: ${fields[4] !== undefined})`);

                if (fields.length >= 5) {
                    const position = fields[0].trim();
                    const handRankStr = fields[1].trim();
                    const wins = parseInt(fields[2]);
                    const total = parseInt(fields[3]);
                    const netev = parseFloat(fields[4]);

                    // Convert hand rank string "(10, 10)" to array [10, 10]
                    const handRank = this.parseHandRank(handRankStr);

                    if (handRank && !isNaN(netev) && total > 0) {
                        // Create lookup key
                        const key = this.createLookupKey(position, handRank);

                        // Store in map
                        this.evMap.set(key, {
                            position,
                            handRank,
                            wins,
                            total,
                            netev
                        });

                        // Verify what we just stored
                        const storedData = this.evMap.get(key);
//                        console.log(`✅ Stored for key "${key}":`, storedData);
//                        console.log(`✅ netev field: ${storedData.netev} (type: ${typeof storedData.netev})`);

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
            // Remove double quotes
            let cleaned = handRankStr;
            if (cleaned.startsWith('"')) {
                cleaned = cleaned.slice(1);
            }
            if (cleaned.endsWith('"')) {
                cleaned = cleaned.slice(0, -1);
            }

            // Extract content between parentheses
            if (!cleaned.startsWith('(') || !cleaned.endsWith(')')) {
                return null;
            }
            const innerContent = cleaned.slice(1, -1);

            // Parse numbers
            const values = innerContent.split(',').map(v => {
                const num = parseInt(v.trim());
                return isNaN(num) ? null : num;
            });

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
     * Get Net EV for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {number|null} - Net EV or null if not found
     */
    getNetEV(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️ Net EV data not loaded yet');
            return null;
        }

        const key = this.createLookupKey(position, handRank);
        const entry = this.evMap.get(key);

        // ✅ LIGHT DEBUG: Only log failures and first few successes
        if (!entry) {
//            console.log(`❌ Missing: ${key}`);
        } else if (Math.random() < 0.01) {  // Only log 1% of successes
//            console.log(`✅ Found: ${key} = ${entry.netev}`);
        }

        if (entry) {
            return entry.netev;
        }

        return entry ? entry.finalEV : null;
    }

    /**
     * Get detailed EV data for position and hand rank
     * @param {string} position - Position (back/middle/front)
     * @param {Array<number>} handRank - Hand rank array
     * @returns {Object|null} - Full EV entry or null if not found
     */
    getDetailedEVData(position, handRank) {
        if (!this.isLoaded) {
            console.warn('⚠️ Net EV data not loaded yet');
            return null;
        }

        const key = this.createLookupKey(position, handRank);
        return this.evMap.get(key) || null;
    }

    /**
     * Get statistics about loaded EV data
     * @returns {Object} - Data statistics
     */
    getStatistics() {
        if (!this.isLoaded) {
            return { loaded: false, error: this.loadError };
        }

        const positions = new Set();
        let totalNetEV = 0;
        let totalWins = 0;
        let totalGames = 0;

        this.evMap.forEach(entry => {
            positions.add(entry.position);
            totalNetEV += entry.netev;
            totalWins += entry.wins;
            totalGames += entry.total;
        });

        return {
            loaded: true,
            totalEntries: this.evMap.size,
            positions: Array.from(positions),
            avgNetEV: this.evMap.size > 0 ? (totalNetEV / this.evMap.size) : 0,
            totalWins,
            totalGames,
            overallWinRate: totalGames > 0 ? (totalWins / totalGames) : 0
        };
    }

    // Add this method to your NetEV lookup class
    getNetEVByPrefix(position, partialTuple) {
        // Build search string once
        const searchPrefix = `${position.toLowerCase()}:${partialTuple.join(',')}`;

        // Simple string match - just like tiered2!
        for (const [key, entry] of this.evMap.entries()) {
            if (key.startsWith(searchPrefix)) {
                return entry.netev;
            }
        }

        return null;
    }

}

// Create singleton instance
const netEVLookup = new NetEVLookup();

/**
 * Get Net EV with hierarchical fallback (mirrors tiered logic)
 * @param {string} position - Position (back/middle/front)
 * @param {Object} hand - Complete hand object with hand_rank, isIncomplete, etc.
 * @returns {number|null} - Net EV or null if no fallback found
 */

function lookupNetEV(position, hand) {

    window.lookupCount++;

    if (hand.preCalculatedScore && hand.preCalculatedScore[position] !== null && hand.preCalculatedScore[position] !== undefined) {
        return hand.preCalculatedScore[position];
    }

    const handRank = hand.hand_rank || hand;
    const truncatedHandRank = handRank.slice(0, 3);

//    console.log(`🔍 Original: [${handRank.join(',')}] → Truncated: [${truncatedHandRank.join(',')}]`);

    // Step 1: Try exact match first
    let netEV = netEVLookup.getNetEV(position, truncatedHandRank);
    if (netEV !== null) {
//        console.log(`🎯 Exact match: ${position} [${truncatedHandRank.join(',')}] = ${netEV}`);
        return netEV;
    }

    // Step 2: Try prefix matching fallback
    // ✅ NEW:
    for (let length = Math.min(truncatedHandRank.length, 2); length >= 2; length--) {
        let prefixTuple = truncatedHandRank.slice(0, length);
//        console.log(`🔍 Trying prefix match: ${position} [${prefixTuple.join(',')}] (length=${length})`);

        netEV = netEVLookup.getNetEVByPrefix(position, prefixTuple);

        if (netEV !== null) {
//            console.log(`🎯 Prefix match: ${position} level ${length}/${truncatedHandRank.length} [${truncatedHandRank.join(',')}] → [${prefixTuple.join(',')}] = ${netEV}`);
            return netEV;
        }
    }

    // Step 3: Final hardcoded fallback (using truncated hand rank)
    if (truncatedHandRank.length >= 2) {
        if (position.toLowerCase() === 'front') {
            const frontFallback = handleIncompleteFrontHand(truncatedHandRank);
            if (frontFallback !== null) {
                console.log(`🎯 Front hardcoded fallback: ${position} [${truncatedHandRank.join(',')}] = ${frontFallback}`);
                return frontFallback;
            }
        } else if (position.toLowerCase() === 'middle') {
            const middleFallback = handleIncompleteMiddleHand(truncatedHandRank);
            if (middleFallback !== null) {
                console.log(`🎯 Middle hardcoded fallback: ${position} [${truncatedHandRank.join(',')}] = ${middleFallback}`);
                return middleFallback;
            }
        } else if (position.toLowerCase() === 'back') {
            const backFallback = handleIncompleteBackHand(truncatedHandRank);
            if (backFallback !== null) {
                console.log(`🎯 Back hardcoded fallback: ${position} [${truncatedHandRank.join(',')}] = ${backFallback}`);
                return backFallback;
            }
        }
    }

    console.log(`❌ Complete lookup failure: ${position} [${truncatedHandRank.join(',')}]`);
    return null;
}


function handleIncompleteBackHand(handRank) {
    const handType = handRank[0];
    const primaryRank = handRank[1];

    console.log(`🎯 Back fallback called for handType ${handType}, primaryRank ${primaryRank}`);

    // ✅ FIXED: NetEV values (can be negative, risk-adjusted)
    switch(handType) {
        case 6: // Straights (fork: handType 6 = Straight)
            if (primaryRank >= 14) return 2.20;  // Ace-high
            if (primaryRank >= 13) return 2.15;  // King-high
            if (primaryRank >= 10) return 2.05;  // Medium straights
            return 1.95;  // Low straights
        case 8: // Four of a kind - very strong
            return primaryRank >= 12 ? 5.70 : 5.50;
        case 7: // Full house - strong
            return primaryRank >= 12 ? 3.85 : 3.65;
        case 5: // Flush (fork: handType 5 = Flush) - decent
            return primaryRank >= 12 ? 1.45 : 1.25;
        case 4: // Trips (Three of a Kind) - okay in back
            return primaryRank >= 12 ? 0.85 : 0.65;
        case 3: // Two Pair - weak in back
            return primaryRank >= 12 ? -0.25 : -0.65;
        case 2: // Pairs - RISKY in back position
            return primaryRank >= 12 ? -0.85 : -1.25;  // ✅ NEGATIVE
        case 1: // High card - TERRIBLE in back
            return -2.50;  // ✅ VERY NEGATIVE
        default:
            return null;
    }
}

/**
 * Initialize Net EV data (call once at startup)
 * @returns {Promise<boolean>} - True if loaded successfully
 */
async function initializeNetEVLookup() {
    return await netEVLookup.loadData();
}

/**
 * Get Net EV data loading status
 * @returns {Object} - Status information
 */
function getNetEVDataStatus() {
    return {
        isLoaded: netEVLookup.isLoaded,
        error: netEVLookup.loadError,
        statistics: netEVLookup.getStatistics()
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        NetEVLookup,
        lookupNetEV,
        initializeNetEVLookup,
        getNetEVDataStatus
    };
}
