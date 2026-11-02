// js/hands/auto-arrange.js
// Streamlined version using find-best-setup

class AutoArrange {
    constructor(game) {
        this.game = game;
        this.arrangementValidator = new ArrangementValidator(game);
    }

    /**
     * Main auto-arrange - uses find-best-setup
     */
    autoArrangeHand() {
        const playerData = this.getPlayerData();
        if (!playerData) return false;

        const allCards = this.getAllCards(playerData);
        if (!this.validateCardCount(allCards)) return false;

        console.log('🧠 Auto-Arrange using find-best-setup...');
        const result = findBestSetup(allCards);

        console.log('🎯 topArrangements:', result.topArrangements)

        delay()

        if (result?.success && result.arrangement) {
            console.log(`✨ Setup found! Score: ${result.score}`);
            console.log(`✨ Setup found! aiMethod: ${gameConfig.config.winProbabilityMethod}`);

            // Store top arrangements for scroller
            window.topArrangements = result.topArrangements || [];
            window.topArrangementIndex = 0;
            // Post-kicker score of the arrangement put on the board (the played pick, which can differ from topArrangements[0])
            window.topArrangementShownScore = result.arrangement.score;

            const arrangement = {
                back: result.arrangement.back.cards,
                middle: result.arrangement.middle.cards,
                front: result.arrangement.front.cards,
                staging: result.arrangement.stagingCards
            };
            return this.applyArrangement(playerData, arrangement);
        }

        console.log('❌ find-best-setup failed, using fallback');
        return this.fallbackAutoArrange(allCards, playerData);
    }

    /**
     * Apply arrangement to player data and update game state
     */
    applyArrangement(playerData, arrangement) {
        // Copies, so moving cards on the board never changes window.topArrangements[0]
        const copyCards = (cards) => Array.isArray(cards) ? cards.map((card) => ({ ...card })) : cards;
        playerData.back = copyCards(arrangement.back);
        playerData.middle = copyCards(arrangement.middle);
        playerData.front = copyCards(arrangement.front);
        playerData.cards = copyCards(arrangement.staging);
        this.game.loadCurrentPlayerHand();
        delay()
        delay()
        return true;
    }

    /**
     * Emergency fallback - Simple sort-based arrangement
     */
    fallbackAutoArrange(allCards, playerData) {
        console.log('🔄 Using fallback auto-arrange...');

        // Sort all cards and distribute optimally
        const sortedCards = CardUtilities.sortCardsByValue(allCards, true);

        const arrangement = {
            back: sortedCards.slice(0, 5),    // 5 best cards
            middle: sortedCards.slice(5, 10), // next 5 cards
            front: sortedCards.slice(10, 13), // next 3 cards
            staging: sortedCards.slice(13, 17) // 4 worst cards in staging
        };

        return this.applyArrangement(playerData, arrangement);
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    /**
     * Get current player's data safely
     */
    getPlayerData() {
        const currentPlayer = this.game.playerManager.getCurrentPlayer();
        return currentPlayer ? this.game.playerHands.get(currentPlayer.name) : null;
    }

    /**
     * Combine all cards from all positions
     */
    getAllCards(playerData) {
        return CardUtilities.combineCards(
            playerData.cards,
            playerData.back,
            playerData.middle,
            playerData.front
        );
    }

    /**
     * Validate we have exactly 17 cards
     */
    validateCardCount(allCards) {
        return CardUtilities.validateCardCount(allCards, 17);
    }

    /**
     * Log arrangement in a clean, readable format
     */
    logArrangement(arrangement) {
        CardUtilities.logCardList(arrangement.back, 'Back');
        CardUtilities.logCardList(arrangement.middle, 'Middle');
        CardUtilities.logCardList(arrangement.front, 'Front');
        CardUtilities.logCardList(arrangement.staging, 'Staging');
    }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
//  console.log("Before delay");
  await delay(1000);
}

// Add to your auto-arrange function (or wherever auto-arrange is triggered)
function showLoadingSpinner() {
    const loadingHtml = `
        <div id="auto-arrange-loading" style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            z-index: 1000;
            font-family: Arial, sans-serif;
        ">
            <div class="spinner" style="
                width: 40px;
                height: 40px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #4ecdc4;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 15px auto;
            "></div>
            <div style="font-size: 16px; font-weight: bold;">Auto-Arranging Cards...</div>
            <div style="font-size: 14px; color: #ccc; margin-top: 8px;">This may take a few seconds</div>
        </div>
    `;

    // Add CSS animation if not already present
    if (!document.querySelector('#spinner-style')) {
        const style = document.createElement('style');
        style.id = 'spinner-style';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.insertAdjacentHTML('beforeend', loadingHtml);
}

function hideLoadingSpinner() {
    const loading = document.getElementById('auto-arrange-loading');
    if (loading) {
        loading.remove();
    }
}

main();
