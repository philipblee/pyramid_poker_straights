// js/ui/show-play-recommendation.js
// Popup with the rule D play/surrender recommendation for the human's 13 cards (single-player kitty decision phase).
// Needs recommendPlayOrSurrender (js/heuristics/recommend-play-or-surrender.js). Does not change the player's decision.

const PLAY_RECOMMENDATION_FOOTNOTE = 'Based on analysis of 6-player tables where all players follow the same rule. Advice is a guide, not a guarantee.';

function createPlayRecommendationPopup() {
    if (document.getElementById('playRecommendationModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
        <div id="playRecommendationModal" class="play-recommendation-modal" style="display: none;">
            <div class="play-recommendation-content">
                <div class="play-recommendation-header">
                    <h2 id="playRecommendationDecision"></h2>
                    <button class="play-recommendation-close" id="playRecommendationX">×</button>
                </div>
                <div class="play-recommendation-body">
                    <ul id="playRecommendationReasons" class="play-recommendation-reasons"></ul>
                    <p class="play-recommendation-footnote">${PLAY_RECOMMENDATION_FOOTNOTE}</p>
                </div>
                <div class="play-recommendation-footer">
                    <button id="playRecommendationClose" class="btn btn-secondary">Close</button>
                </div>
            </div>
        </div>
    `);

    document.head.insertAdjacentHTML('beforeend', `
        <style id="playRecommendationStyles">
            .play-recommendation-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .play-recommendation-content {
                background: linear-gradient(135deg, #2c3e50, #34495e);
                border-radius: 15px;
                border: 2px solid #4ecdc4;
                max-width: 480px;
                width: 90%;
                color: white;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }

            .play-recommendation-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            }

            .play-recommendation-header h2 {
                margin: 0;
                color: #ffd700;
                font-size: 24px;
            }

            .play-recommendation-close {
                background: none;
                border: none;
                color: #ff6b6b;
                font-size: 28px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                line-height: 1;
            }

            .play-recommendation-body {
                padding: 20px;
                line-height: 1.6;
            }

            .play-recommendation-reasons {
                margin: 0 0 15px 0;
                padding-left: 22px;
                color: #ecf0f1;
            }

            .play-recommendation-footnote {
                margin: 0;
                font-size: 12px;
                font-style: italic;
                color: rgba(255, 255, 255, 0.6);
            }

            .play-recommendation-footer {
                padding: 15px 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.2);
                text-align: center;
            }
        </style>
    `);

    const recommendationModal = document.getElementById('playRecommendationModal');
    document.getElementById('playRecommendationX').addEventListener('click', closePlayRecommendation);
    document.getElementById('playRecommendationClose').addEventListener('click', closePlayRecommendation);
    recommendationModal.addEventListener('click', (clickEvent) => {
        if (clickEvent.target === recommendationModal) closePlayRecommendation();
    });
    document.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Escape' && recommendationModal.style.display !== 'none') closePlayRecommendation();
    });
}

function closePlayRecommendation() {
    const recommendationModal = document.getElementById('playRecommendationModal');
    if (recommendationModal) recommendationModal.style.display = 'none';
}

function showPlayRecommendation() {
    const humanPlayer = window.game.playerManager.players.find(player => player.type === 'human');
    const humanHand = humanPlayer && window.game.playerHands.get(humanPlayer.name);
    if (!humanHand) {
        console.error('AI recommendation: no human hand found');
        return;
    }

    let recommendation;
    try {
        recommendation = recommendPlayOrSurrender(humanHand.originalCards.slice(0, 13));
    } catch (recommendationError) {
        console.error('AI recommendation:', recommendationError.message);
        return;
    }

    createPlayRecommendationPopup();
    document.getElementById('playRecommendationDecision').textContent =
        recommendation.decision === 'play' ? 'Play' : 'Surrender';

    const reasonList = document.getElementById('playRecommendationReasons');
    reasonList.innerHTML = '';
    recommendation.reasons.forEach(reason => {
        const reasonItem = document.createElement('li');
        reasonItem.textContent = reason;
        reasonList.appendChild(reasonItem);
    });

    document.getElementById('playRecommendationModal').style.display = 'flex';
}
