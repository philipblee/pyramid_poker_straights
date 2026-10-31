// js/core/round-manager.js
// Round and tournament lifecycle management

PyramidPoker.prototype.startNewGame = async function() {
        // Add this when a new game starts
        resetGameTimer();


        // 🔧 FIX: Refresh ALL settings from current config (not stale constructor values)
        this.maxRounds = gameConfig.config.rounds;
        // Add any other cached settings here if we find them

        // Clear surrender decisions from previous round
        if (this.surrenderDecisions) {
            this.surrenderDecisions.clear();
        }

        // Clear automatic hands from previous game
        if (this.automaticHands) {
            this.automaticHands.clear();
        }

        hideDecisionButtons();

        // Set multiDeviceMode based on gameConfig
        this.multiDeviceMode = window.gameConfig?.config?.gameDeviceMode === 'multi-device';

        // Add this when a new game starts
        resetGameTimer();

        // Ensure we have players
        const playersAdded = this.playerManager.ensurePlayersExist();
        if (playersAdded) {
            updateDisplay(this);
        }

        try {
            this.playerManager.validateMinimumPlayers();
        } catch (error) {
            alert(error.message);
            return;
        }

        // NEW: Collect antes
        await this.collectAntes();

        // Add countdown
        const isSingleHuman = window.gameConfig?.config?.gameMode === 'single-human';

        if (isSingleHuman) {
            await this.handleCountdown();  // ADD THIS
        }


        // Configure players based on GameConfig
        if (window.gameConfig) {
            // Check if we're in multi-device mode
            const isMultiDevice = window.gameConfig.config.gameDeviceMode === 'multi-device';

            if (isMultiDevice) {
                // For multi-device, get actual player count from the game
                const humanPlayers = this.players.filter(p => !p.isAI).length;
                const aiPlayers = this.players.filter(p => p.isAI).length;
                const totalPlayers = this.players.length;

                console.log(`🎮 Multi-device configured for ${totalPlayers} players (${humanPlayers} human + ${aiPlayers} AI)`);
            } else {
                // For single-device, use the original logic
                const targetPlayerCount = 1 + window.gameConfig.config.computerPlayers; // 1 human + N AI
//                console.log(`🎮 Single-device configured for ${targetPlayerCount} players (1 human + ${window.gameConfig.config.computerPlayers} AI)`);
            }
        }

        // NEW: Initialize tournament
        this.currentRound = 1;
        this.roundHistory = [];
        this.tournamentScores.clear();
        this.tournamentNumber++;
        console.log(`Round ${this.currentRound} of ${this.maxRounds}`);

        // Initialize tournament scores for all players
        for (let player of this.playerManager.players) {
            this.tournamentScores.set(player.name, 0);
        }

        // This block is essential for single-player.  Without it, single-player breaks
        // Setup first round
        this.deckManager.createNewDeck();
        this.gameState = 'playing';
        this.tableState = TABLE_STATES.DEALING; // Add this - parallel tracking
        window.resetAutomaticButton()
        this.playerManager.currentPlayerIndex = 0;
        this.submittedHands.clear();

        await this.dealCardsToAllPlayers();

        // Only load hand immediately for owner/single-player
        // Non-owners will load after Firebase retrieval completes
        if (!this.multiDeviceMode || window.isOwner) {
            this.loadCurrentPlayerHand();
            updateDisplay(this);
        }

    };


PyramidPoker.prototype.startNewRound = async function() {

        // Show appropriate buttons based on state
        if (this.tableState === TABLE_STATES.DECIDE_PLAYING) {
            showDecisionButtons();
        } else {
            hideDecisionButtons();
        }

        // Must have existing players to start a new round
        if (this.playerManager.players.length < 2) {
            alert('Need at least 2 players to start a round. Click "New Game" to configure players.');
            return;
        }

        if (this.currentRound >= this.maxRounds) {
            // Single-player always shows summary directly
            const isSingleHuman = window.gameConfig?.config?.gameMode === 'single-human';

            if (isSingleHuman) {
                this.showTournamentSummary();  // Direct call for all single-player
            } else if (window.isOwner) {
                setTableState(TABLE_STATES.TOURNAMENT_COMPLETE);  // Multi-player uses state machine
            }
            return;
        }

        // Continue with new round
        if (window.isOwner) {
            setTableState(TABLE_STATES.DEALING);
        }

        // Advance to next round
        this.currentRound++;
        console.log(`🔄 Starting Round ${this.currentRound} of ${this.maxRounds}...`);


        // Clear surrender decisions from previous round
        if (this.surrenderDecisions) {
            this.surrenderDecisions.clear();
            console.log('🧹 Cleared local surrender decisions for new round');
        }

        // Clear Firebase decisions (for multi-player)
        if (window.isOwner && window.multiDeviceIntegration) {
            const tableId = window.multiDeviceIntegration.tableId;  // ← ADD THIS
            await firebase.database()
                .ref(`tables/${tableId}/surrenderDecisions`)
                .remove();

            console.log('🧹 Cleared Firebase surrender decisions for new round');

            // After clearing Firebase surrender decisions
            if (typeof window.cleanupDecisionListener === 'function') {
                window.cleanupDecisionListener();
            }
        }

        hideDecisionButtons();

        // Clear surrender notice from previous round
        const surrenderNotice = document.getElementById('surrenderNotice');
        if (surrenderNotice) surrenderNotice.style.display = 'none';

        // NEW: Collect antes
        await this.collectAntes();

        // 🆕 ADD COUNTDOWN HERE (before dealing cards)
        const config = window.gameConfig?.config;
        const isSingleHuman = config?.gameMode === 'single-human';

        if (isSingleHuman) {
            await this.handleCountdown();
        }

        // Setup new round (same as before but with round tracking)
        this.gameState = 'playing';
        this.playerManager.currentPlayerIndex = 0;
        this.submittedHands.clear();
        if (this.automaticHands) {
            this.automaticHands.clear();
        }
        window.topArrangements = [];
        window.topArrangementIndex = 0;

        await this.dealCardsToAllPlayers();
        resetAutomaticButton();
        hideAutomaticMessage();
        document.getElementById('prevArrangement').style.display = 'none';
        document.getElementById('nextArrangement').style.display = 'none';
        document.getElementById('arrangementCounter').style.display = 'none';

        // Only load hand immediately for owner/single-player AND not kitty variant
        // Multi-device kitty uses state machine, everything else loads immediately
        const skipLoad = this.multiDeviceMode && gameConfig.config.gameVariant === 'kitty';

        if (!skipLoad && (!this.multiDeviceMode || window.isOwner)) {
            this.loadCurrentPlayerHand();
        }

        updateDisplay(this);

        // Add at end of startNewRound()
        this.playerHands.forEach((hand, name) => {
//            console.log(`- ${name}: ${hand.cards.length} cards`);
        });

    };


PyramidPoker.prototype.dealCardsToAllPlayers = async function() {

        if (!this.multiDeviceMode || window.isOwner) {
            this.deckManager.createNewDeck();

            for (let player of this.playerManager.players) {
                const hand = this.deckManager.dealCards(17);
                this.playerHands.set(player.name, {
                    cards: hand,
                    originalCards: hand.map(card => ({...card})),
                    back: [],
                    middle: [],
                    front: []
                });
                player.ready = false;
            }

            // After dealing completes, set appropriate state
            if (!this.multiDeviceMode) {
                if (gameConfig.config.gameVariant === 'kitty') {
                    this.tableState = TABLE_STATES.DECIDE_PLAYING;
                } else {
                    this.tableState = TABLE_STATES.PLAYING;
                }
            }
            // Multi-device already handles tableState via Firebase

        if (this.multiDeviceMode && window.multiDeviceIntegration) {
            if (window.isOwner) {
                // Owner: Sync hands immediately, then signal ready
                await window.multiDeviceIntegration.storeAllHandsToFirebase();
                console.log('✅ Owner synced all hands to Firebase');
                await setTableState(TABLE_STATES.HANDS_DEALT);
            }
            // Non-owner: Do nothing - will wait for HANDS_DEALT state
        }

        // Table 6 Firebase sync
        if (window.table6FirebaseSync && gameConfig.config.gameConnectMode === 'online') {
            try {
                await window.table6FirebaseSync.storeAllHandsToFirebase();
                console.log('✅ Hands synced to Firebase for persistence');
            } catch (error) {
                console.error('❌ Firebase sync failed:', error);
            }
        }
        }
    };


PyramidPoker.prototype.startNewTournament = async function() {
        console.log('🏆 Starting completely new tournament...');

        if (gameConfig.config.gameDeviceMode === 'multi-device'){
            setTableState(TABLE_STATES.NEW_TOURNAMENT)
            return;
        }

        // Clear all tournament-level data - not needed after
        this.currentRound = 0;  // or 1, depending on your preference
        this.roundHistory = [];
        this.roundRobinResults = [];  // <-- This is the key line for your bug
        this.tournamentScores.clear();

        // Reset game state
        this.gameState = 'waiting';

        // 🆕 ADD COUNTDOWN HERE (before dealing cards)
        const config = window.gameConfig?.config;
        const isSingleHuman = config?.gameMode === 'single-human';

        if (isSingleHuman) {
            await this.handleCountdown();
        }

        // Call the regular game start logic
        this.startNewGame();
    };


PyramidPoker.prototype.initializeTournament = function() {
        console.log('🏆 from window.game.initializeTournament: Starting new tournament...');
        // Clear decisions from previous tournament
        if (this.surrenderDecisions) {
            this.surrenderDecisions.clear();
        }

        // Clear Firebase decisions (owner only)
        if (this.multiDeviceMode && window.isOwner && this.currentTableId) {
            firebase.database().ref(`tables/${this.currentTableId}/surrenderDecisions`).remove();
        }

        this.currentRound = 1;
        this.roundHistory = [];
        this.tournamentScores.clear();

        // Initialize tournament scores for all players
        for (let player of this.playerManager.players) {
            this.tournamentScores.set(player.name, 0);
        }
    };


PyramidPoker.prototype.collectAntes = async function() {
        const anteAmount = window.gameConfig?.config?.stakesAnteAmount || 0;

        if (anteAmount === 0) return;

        const tableId = window.game?.currentTableId;

        if (!tableId) {
            console.warn('No tableId for ante collection');
            return;
        }

        // Only owner collects all antes
        if (this.multiDeviceMode && !window.isOwner) return;

        const players = this.playerManager.players;
        const totalPot = players.length * anteAmount;

        // Deduct from each player
        for (const player of players) {
            let playerKey;
            if (player.type === 'ai') {
                playerKey = player.name;
            } else {
                // Human - encode email
                playerKey = player.name.replace(/\./g, ',').replace(/@/g, '_at_');
            }

            const result = await firebase.database().ref(`players/${playerKey}/chips`)
                .transaction(currentChips => (currentChips || 0) - anteAmount);

            // Also update lastKnownChips
            await firebase.database().ref(`players/${playerKey}/lastKnownChips`).set(result.snapshot.val());

        }

        // Set pot (not transaction - owner controls it)
        await firebase.database().ref(`tables/${tableId}/pot`).set(totalPot);

        console.log(`✅ Collected ${anteAmount} ante from ${players.length} players. Pot: ${totalPot}`);
    };


PyramidPoker.prototype.handleCountdown = async function() {
        const config = window.gameConfig?.config;

        const countdownTime = config.countdownTime || 0;

        if (countdownTime > 0) {
            showCountdownModal(countdownTime);

            for (let i = countdownTime; i > 0; i--) {
                updateCountdownNumber(i);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            hideCountdownModal();
        }
    };
