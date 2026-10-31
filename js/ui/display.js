// js/ui/display.js
// UI display and update functions extracted from ui.js

const isTouchDevice = 'ontouchstart' in window;
let selectedCardEl = null;

// Create a visual card element
function createCardElement(card) {
    const cardEl = document.createElement('div');

    //    console.log(`🃏 Creating card element:`, {
    //        rank: card.rank,
    //        suit: card.suit,
    //        isWild: card.isWild,
    //        wasWild: card.wasWild
    //    });

    if (card.isWild) {
        cardEl.className = 'card wild wild-undefined';
        cardEl.innerHTML = `<div style="font-size: 13px; text-align: center;">Click to Set</div><div style="font-size: 28px;">🃏</div>`;
    } else {
        const wasWildClass = card.wasWild ? ' was-wild' : '';
        cardEl.className = `card ${['♥', '♦'].includes(card.suit) ? 'red' : 'black'}${wasWildClass}`;
        cardEl.innerHTML = `<div style="font-size: 20px;">${card.rank}</div><div style="font-size: 28px;">${card.suit}</div>`;

        // Add inline style for wasWild cards to override CSS conflicts
        if (card.wasWild) {
            cardEl.style.background = 'linear-gradient(135deg, #ffd700, #ffed4e)';
            cardEl.style.border = '2px solid #ff6b6b';
            cardEl.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.6)';
            // Don't override color - let the suit keep its red/black color
        }
    }

    cardEl.draggable = true;
    cardEl.dataset.card = JSON.stringify(card);
    cardEl.dataset.cardId = card.id;
    return cardEl;
}

// Display cards in a container
function displayCards(cards, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !cards || cards.length === 0) return;

    cards.forEach(card => {
        const cardElement = createCardElement(card);
        container.appendChild(cardElement);
    });
}

// Setup drag and drop functionality
function setupDragAndDrop(game) {
    const handAreas = document.querySelectorAll('.hand-area');

    document.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('card')) {
            e.target.classList.add('dragging');
            e.dataTransfer.setData('cardId', e.target.dataset.cardId);  // ← Just ID
            e.dataTransfer.setData('source', e.target.parentElement.id);
        }
    });

    document.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('card')) {
            e.target.classList.remove('dragging');
        }
    });

    // Click handler for wild cards
    document.addEventListener('click', (e) => {
        if (isTouchDevice) return;
        const cardElement = e.target.closest('.card');
        if (cardElement) {
            const cardData = JSON.parse(cardElement.dataset.card);
            console.log('🔍 Card data:', cardData);

            if (cardData.isWild || cardData.wasWild) {
                console.log('🔍 IS WILD! Opening modal...');
                const cardId = cardElement.dataset.cardId;

                const currentPlayer = game.playerManager.getCurrentPlayer();
                const playerData = game.playerHands.get(currentPlayer.name);

                if (!playerData) return;

                const allCards = [
                    ...playerData.cards,
                    ...playerData.back,
                    ...playerData.middle,
                    ...playerData.front
                ];

                const actualCard = allCards.find(c => c.id === cardId);
                if (actualCard && window.wildCardModal) {
                    window.wildCardModal.show(actualCard);
                }
            }
        }
    });

    handAreas.forEach(area => {
        area.addEventListener('dragover', (e) => {
            e.preventDefault();
            area.classList.add('drop-target');
        });

        area.addEventListener('dragleave', (e) => {
            if (!area.contains(e.relatedTarget)) {
                area.classList.remove('drop-target');
            }
        });

        area.addEventListener('drop', (e) => {
            e.preventDefault();
            area.classList.remove('drop-target');

            const cardId = e.dataTransfer.getData('cardId');  // ← Get ID directly
            const sourceId = e.dataTransfer.getData('source');
            const targetHand = area.dataset.hand;

            // Pass just the card ID, not the full stale JSON
            game.moveCard(cardId, sourceId, targetHand);
        });
    });
    if (isTouchDevice) setupTapToSelect(game);
}

function setupTapToSelect(game) {
    let touchStartX = 0;
    let touchStartY = 0;
    let longPressTimer = null;
    let longPressTriggered = false;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        longPressTriggered = false;

        const cardEl = e.target.closest('.card');
        if (!cardEl) return;

        const cardData = JSON.parse(cardEl.dataset.card);
        if (!cardData.isWild && !cardData.wasWild) return;

        // Start long press timer for wild cards
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            if (selectedCardEl) selectedCardEl.classList.remove('tap-selected');
            selectedCardEl = null;

            const cardId = cardEl.dataset.cardId;
            const currentPlayer = game.playerManager.getCurrentPlayer();
            const playerData = game.playerHands.get(currentPlayer.name);
            if (!playerData) return;

            const allCards = [...playerData.cards, ...playerData.back,
                              ...playerData.middle, ...playerData.front];
            const actualCard = allCards.find(c => c.id === cardId);
            if (actualCard && window.wildCardModal) {
                window.wildCardModal.show(actualCard);
            }
        }, 600);
    });

    document.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        if (longPressTriggered) {
            longPressTriggered = false;
            return;
        }

        const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        if (dx > 10 || dy > 10) return;

        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const cardEl = e.target.closest('.card');
        const zoneEl = target ? target.closest('.hand-area') : null;

        if (zoneEl && selectedCardEl) {
            const cardId = selectedCardEl.dataset.cardId;
            const sourceId = selectedCardEl.parentElement.id;
            const targetHand = zoneEl.dataset.hand;
            selectedCardEl.classList.remove('tap-selected');
            selectedCardEl = null;
            game.moveCard(cardId, sourceId, targetHand);

        } else if (cardEl) {
            if (selectedCardEl === cardEl) {
                cardEl.classList.remove('tap-selected');
                selectedCardEl = null;
            } else {
                if (selectedCardEl) selectedCardEl.classList.remove('tap-selected');
                selectedCardEl = cardEl;
                cardEl.classList.add('tap-selected');
            }
        }
    });
}

// Update game status display
function updateStatus(game) {
    const status = document.getElementById('status');
    const currentPlayer = game.playerManager.getCurrentPlayer();

    if (game.gameState === 'playing' && currentPlayer) {
        const roundNum = game.currentRound;
        const maxRounds = game.maxRounds;

        // Check if in decision phase (13 cards shown)
        const tableState = game.tableState || 'playing';
        const isDecisionPhase = (gameConfig.config.gameVariant === 'kitty' &&
                                 tableState === 'decide_playing');

        if (isDecisionPhase) {
            // Decision phase message
            status.innerHTML = `Round ${roundNum} of ${maxRounds}: ${getCompactName(currentPlayer.name)} - Choose PLAY or SURRENDER, then SUBMIT DECISION`;
        } else {
            // Normal playing message
            status.innerHTML = `Round ${roundNum} of ${maxRounds}: ${getCompactName(currentPlayer.name)}'s turn to arrange the cards!`;
        }
    }

    if (game.gameState === 'waiting') {
        status.textContent = `Players: ${game.playerManager.players.length} - Add players and click "New Game" to start!`;
    } else if (game.gameState === 'scoring') {
        status.textContent = `Round ${game.currentRound} of ${game.maxRounds} complete! Check the scores below.`;
    }
}

// Update player list display
function updatePlayerList(game) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';

    // 0. FIRST: Session totals (if session has started)
    if (window.sessionTotals && Object.keys(window.sessionTotals).length > 0) {
        const sessionSection = document.createElement('div');
        sessionSection.className = 'session-totals';
        sessionSection.innerHTML = `
            <h4 style="color: #ffd700; margin: 0 0 10px 0; font-size: 14px;">📊 Session Totals</h4>
        `;

        const sorted = Object.entries(window.sessionTotals)
            .sort((a, b) => b[1] - a[1]);

        sorted.forEach(([playerName, total]) => {
            const color = total < 0 ? '#ff6b6b' : '#4ecdc4';
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex; justify-content: space-between;
                padding: 8px 12px; margin: 3px 0;
                background: rgba(78, 205, 196, 0.1); border-radius: 6px;
                border: 1px solid rgba(78, 205, 196, 0.3);
                font-size: 14px; font-weight: bold;
            `;
            row.innerHTML = `
                <span style="color: #ccc;">${getCompactName(playerName)}</span>
                <span style="color: ${color};">${total > 0 ? '+' : ''}${total}</span>
            `;
            sessionSection.appendChild(row);
        });

        playerList.appendChild(sessionSection);
    }

    // 1. SECOND: Tournament standings (if tournament is active)

    if (game.currentRound > 0) {
        const standingsSection = document.createElement('div');
        standingsSection.className = 'tournament-standings';
        standingsSection.innerHTML = `
            <h4 style="color: #ffd700; margin: 0 0 10px 0; font-size: 14px;">🏆 Chips Summary</h4>
        `;

        // Calculate cumulative chip changes from all completed rounds
        const chipTotals = new Map();
        game.playerManager.players.forEach(player => {
            chipTotals.set(player.name, 0);
        });

        // Sum chip changes from all completed rounds
        game.roundHistory.forEach(roundData => {
            if (roundData.chipChanges) {
                roundData.chipChanges.forEach((chipChange, playerName) => {
                    const current = chipTotals.get(playerName) || 0;
                    chipTotals.set(playerName, current + chipChange);
                });
            }
        });

        // Sort players by tournament total scores
        const standings = [...chipTotals.entries()]
            .sort((a, b) => b[1] - a[1]);

        standings.forEach(([playerName, totalChipChange], index) => {
            const position = index + 1;
            const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}.`;

            // Color logic for tournament scores
            const scoreColor = totalChipChange < 0 ? '#ff6b6b' : '#4ecdc4';

            const standingDiv = document.createElement('div');
            standingDiv.style.cssText = `
                display: flex; justify-content: space-between;
                padding: 8px 12px; margin: 3px 0;
                background: rgba(255, 215, 0, 0.1); border-radius: 6px;
                border: 1px solid rgba(255, 215, 0, 0.3);
                font-size: 14px; font-weight: bold;
            `;
            standingDiv.innerHTML = `
                <span style="color: #ffd700;">${medal} ${getCompactName(playerName)}</span>
                <span style="color: ${scoreColor};">${totalChipChange > 0 ? '+' : ''}${totalChipChange}</span>
            `;
            standingsSection.appendChild(standingDiv);
        });

        playerList.appendChild(standingsSection);
    }

    // 2. SECOND: All completed rounds + current round (stacked vertically)
    if (game.currentRound > 0) {

        // In display.js where tournament standings are built
//        console.log(`📺 Tournament Display: currentRound=${game.currentRound}, roundHistory.length=${game.roundHistory.length}`);
//        console.log(`📺 Will loop from roundNum=1 to roundNum=${game.currentRound}`);

        // Show all rounds from 1 to current round
        for (let roundNum = 1; roundNum <= game.currentRound; roundNum++) {
            const roundSection = document.createElement('div');
            roundSection.className = 'round-section';

            // Get scores for this specific round
            let roundScores = new Map();
            if (roundNum === game.currentRound && game.gameState === 'playing') {
                // Current round in progress - show current scores
                game.playerManager.players.forEach(player => {
                    const score = game.playerManager.getPlayerScore(player.name);
                    roundScores.set(player.name, score);
                });
            } else {
                // Completed round - get from history
                const historicalRound = game.roundHistory.find(round => round.roundNumber === roundNum);
                if (historicalRound) {
                    roundScores = historicalRound.roundScores;
                }
            }

            // Create clickable round header
            const roundHeader = document.createElement('div');
            roundHeader.style.cssText = `
                color: #4ecdc4; font-size: 14px; font-weight: bold;
                margin: 15px 0 5px 0; cursor: pointer;
                padding: 5px 8px; border-radius: 4px;
                background: rgba(78, 205, 196, 0.1);
                border: 1px solid rgba(78, 205, 196, 0.3);
                transition: background 0.2s ease;
            `;
            roundHeader.innerHTML = `📋 Round ${roundNum}`;

            // Disable all round buttons (buggy - fix later)
            roundHeader.style.cursor = 'default';
            roundHeader.style.opacity = '0.7';
            // Remove click handlers and hover effects

            roundSection.appendChild(roundHeader);

            // Show players for this round with smaller fonts
            game.playerManager.players.forEach((player, index) => {
                const playerDiv = document.createElement('div');
                playerDiv.className = 'round-player-item';
                playerDiv.style.cssText = `
                    display: flex; justify-content: space-between;
                    padding: 3px 12px; margin: 1px 0;
                    font-size: 14px; color: #ecf0f1;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 3px;
                `;

                // Add current player indicator for active round
                if (roundNum === game.currentRound && game.gameState === 'playing' && index === game.playerManager.currentPlayerIndex) {
                    playerDiv.style.background = 'rgba(78, 205, 196, 0.2)';
                    playerDiv.style.border = '1px solid #4ecdc4';
                }

                // Add ready indicator for active round
                let readyIndicator = '';
                if (roundNum === game.currentRound && game.gameState === 'playing' && player.ready) {
                    readyIndicator = '✓ ';
                }


                // Check if this round has been completed
                const roundCompleted = game.roundHistory.find(round => round.roundNumber === roundNum);

                let scoreDisplay, scoreColor;

                if (roundCompleted) {
                    // Round completed - show chip change instead of points
                    const chipChange = roundCompleted.chipChanges?.get(player.name) || 0;
                    scoreColor = chipChange < 0 ? '#ff6b6b' : '#4ecdc4';
                    scoreDisplay = `${chipChange > 0 ? '+' : ''}${chipChange}`;  // Remove "pts"
                } else {
                // Round not played yet - show dash
                scoreColor = '#ffffff'; // White for maximum visibility
                scoreDisplay = '-';
                }

                playerDiv.innerHTML = `
                    <span>${readyIndicator}${getCompactName(player.name)}</span>
                    <span style="color: ${scoreColor};">${scoreDisplay}</span>
                `;


                roundSection.appendChild(playerDiv);
            });

            playerList.appendChild(roundSection);
        }
    } else {
        // No tournament started - show basic player list
        const playersSection = document.createElement('div');
        playersSection.innerHTML = `
            <h4 style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 14px;">👥 Players</h4>
        `;

        game.playerManager.players.forEach((player, index) => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            playerDiv.innerHTML = `<span>${player.name}</span>`;
            playersSection.appendChild(playerDiv);
        });

        playerList.appendChild(playersSection);
    }
}

// Update scoring
function updateScoring(game) {
    const scoring = document.getElementById('scoring');

    // Always hide the redundant current scores section
    // We show tournament standings in the player list now
    if (scoring) {
        scoring.style.display = 'none';
    }
}

// Update button states based on game state
function updateButtonStates(game) {
    const newGameBtn = document.getElementById('newGame');
    const newRoundBtn = document.getElementById('newRound');
    const autoBtn = document.getElementById('autoArrange');
    const rankBtn = document.getElementById('sortByRank');
    const suitBtn = document.getElementById('sortBySuit');
    const submitBtn = document.getElementById('submitHand');
    const automaticBtn = document.getElementById('playAutomatic');
    const findAutoBtn = document.getElementById('detectAutomatics');  // ← Must be declared here

    // Control FIND-AUTO visibility based on config
    if (findAutoBtn) {
        const inDecisionPhase = gameConfig.config.gameVariant === 'kitty' &&
            (game.tableState === 'decide_playing' ||
             game.tableState === 'hands_dealt' ||
             game.tableState === 'dealing');
        if (!inDecisionPhase) {
            findAutoBtn.style.display =
                (gameConfig.config.findAutoEnabled === 'yes') ? 'inline-block' : 'none';
        }
    }

    const autoArrangeBtn = document.getElementById('autoArrange');
    const bestAlgoSelect = document.getElementById('bestAlgoSelect');

    console.log('🔍 display.js button visibility check running, autoArrangeAllowed:', gameConfig.config.autoArrangeAllowed);

    if (autoArrangeBtn) {
        autoArrangeBtn.style.display =
            (gameConfig.config.autoArrangeAllowed === 'yes') ? 'inline-block' : 'none';
    }
    if (bestAlgoSelect) {
        bestAlgoSelect.style.display =
            (gameConfig.config.autoArrangeAllowed === 'yes') ? 'inline-block' : 'none';
    }


    if (game.gameState === 'waiting') {
//        addPlayerBtn.disabled = false;
//        newGameBtn.disabled = game.playerManager.players.length < 2;
//        newRoundBtn.disabled = false; // No tournament started
        autoBtn.disabled = true;
        rankBtn.disabled = true;
        suitBtn.disabled = true;
        submitBtn.disabled = true;
        if (automaticBtn) automaticBtn.disabled = true;
    } else if (game.gameState === 'playing') {

        // Don't change buttons during kitty variant decision phases
        if (gameConfig.config.gameVariant === 'kitty' &&
            (game.tableState === 'hands_dealt' ||
             game.tableState === 'dealing' ||
             game.tableState === 'decide_playing')) {
            return; // Exit early, keep decision buttons
        }

        // NEW LOGIC: Check if any players have started playing (moved cards around)
        const gameInProgress = game.playerManager.getReadyCount() > 0 ||
                              Array.from(game.playerHands.values()).some(hand =>
                                  hand.back.length > 0 || hand.middle.length > 0 || hand.front.length > 0
                              );

        autoBtn.disabled = false;
        rankBtn.disabled = false;
        suitBtn.disabled = false;

    } else if (game.gameState === 'scoring') {
//        addPlayerBtn.disabled = false;
//        newGameBtn.disabled = false;
//        newRoundBtn.disabled = game.currentRound >= game.maxRounds; // Enable for next round
        autoBtn.disabled = true;
        rankBtn.disabled = true;
        suitBtn.disabled = true;
        submitBtn.disabled = true;
        if (automaticBtn) automaticBtn.disabled = true;

    // Log what decisions are being made:
    if (game.gameState === 'playing') {
        const currentPlayer = game.playerManager.getCurrentPlayer();
        const isAITurn = currentPlayer && (currentPlayer.type === 'ai' || currentPlayer.isAI);
        console.log(`🎮 Button decision: gameState=${game.gameState}, currentPlayer=${currentPlayer?.name}, isAI=${isAITurn}`);
    }

    }
}

// Toggle sidebar visibility
function toggleSidebar(game) {
    game.sidebarVisible = !game.sidebarVisible;

    const sidebar = document.getElementById('sidebar');
    const gameArea = document.getElementById('gameArea');
    const toggleIcon = document.getElementById('toggleIcon');
    const toggleText = document.getElementById('toggleText');

    if (game.sidebarVisible) {
        if (sidebar) {
            sidebar.classList.remove('hidden');
            sidebar.style.display = 'block';
        }
        if (gameArea) {
            gameArea.classList.remove('sidebar-hidden');
            gameArea.style.gridTemplateColumns = '1fr 320px';
        }
        if (toggleIcon) toggleIcon.textContent = '◀';
        if (toggleText) toggleText.textContent = 'Hide';
    } else {
        if (sidebar) {
            sidebar.classList.add('hidden');
            sidebar.style.display = 'none';
        }
        if (gameArea) {
            gameArea.classList.add('sidebar-hidden');
            gameArea.style.gridTemplateColumns = '1fr';
        }
        if (toggleIcon) toggleIcon.textContent = '▶';
        if (toggleText) toggleText.textContent = 'Show';
    }
}

// Update all display elements
function updateDisplay(game) {
//    console.log('🔍 updateDisplay() called from:', new Error().stack.split('\n')[2].trim());
    updateStatus(game);
    updatePlayerList(game);
    updateScoring(game);
    updateButtonStates(game);
}

// Show historical round results
async function showHistoricalRound(game, roundNumber) {
    console.log(`📋 Showing historical Round ${roundNumber} results...`);

    const roundData = game.roundHistory.find(round => round.roundNumber === roundNumber);
    if (!roundData) {
        console.error(`Round ${roundNumber} data not found`);
        return;
    }

    // For now, just show the scoring popup with historical data
    // We'll enhance this in Phase 3B to have round selector tabs
    await showScoringPopup(game, roundData.detailedResults, roundData.roundScores, new Map(), roundNumber);
}
