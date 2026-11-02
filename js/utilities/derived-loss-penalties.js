// js/utilities/derived-loss-penalties.js
// Per (position, hand type) loss penalties for the 'netEV_derived' method: cdf's expected loss per lost comparison,
// written to data/derived_loss_penalties.json by scripts/derive-loss-penalties.js.
// netEV_derived = p * points - (1 - p) * penalty, with p the tiered2 win rate as in formula netEV;
// only the penalty differs from ScoringUtilities.lossPenalty.

class DerivedLossPenalties {
    constructor() {
        this.penaltiesByPosition = null;
        this.penaltyJson = null;
        this.isLoaded = false;
        this.loadError = null;
    }

    /**
     * Load from the parsed penalty JSON ({ meta, penalties: { position: { handType: { penalty, ... } } } })
     * @param {Object} penaltyJson - Parsed data/derived_loss_penalties.json
     * @returns {boolean} - True when every position has hand types 1-16
     */
    loadFromJson(penaltyJson) {
        const penaltiesByPosition = {};
        for (const position of ['back', 'middle', 'front']) {
            const positionPenalties = penaltyJson.penalties && penaltyJson.penalties[position];
            if (!positionPenalties) throw new Error(`derived loss penalties: no ${position} table`);
            penaltiesByPosition[position] = {};
            for (let handType = 1; handType <= 16; handType++) {
                const handTypeEntry = positionPenalties[handType];
                if (!handTypeEntry || !Number.isFinite(handTypeEntry.penalty)) {
                    throw new Error(`derived loss penalties: ${position} type ${handType} missing`);
                }
                penaltiesByPosition[position][handType] = handTypeEntry.penalty;
            }
        }
        this.penaltiesByPosition = penaltiesByPosition;
        this.penaltyJson = penaltyJson;
        this.isLoaded = true;
        return true;
    }

    /**
     * Browser loader
     * @param {string} url - URL of the penalty JSON
     * @returns {Promise<boolean>}
     */
    async loadFromUrl(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            return this.loadFromJson(await response.json());
        } catch (error) {
            this.loadError = error.message;
            return false;
        }
    }

    /**
     * @param {string} position - back / middle / front
     * @param {number} handType - 1..16
     * @returns {number} - Points lost per lost comparison
     */
    penalty(position, handType) {
        if (!this.isLoaded) throw new Error('derived loss penalties are not loaded');
        const positionPenalties = this.penaltiesByPosition[String(position).toLowerCase()];
        if (!positionPenalties) throw new Error(`derived loss penalties: unknown position ${position}`);
        const handTypePenalty = positionPenalties[handType];
        if (handTypePenalty === undefined) throw new Error(`derived loss penalties: no ${position} type ${handType}`);
        return handTypePenalty;
    }
}

const derivedLossPenalties = new DerivedLossPenalties();

async function initializeDerivedLossPenalties(url = 'data/derived_loss_penalties.json') {
    return await derivedLossPenalties.loadFromUrl(url);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DerivedLossPenalties, derivedLossPenalties, initializeDerivedLossPenalties };
}
