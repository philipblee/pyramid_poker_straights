// Update js/core/game-config.js - add game mode configuration

class GameConfig {
    constructor() {
        this.config = {
            // Connection/Device type settings
            gameConnectMode: 'offline',      //1 'offline', 'online' - how game connects/syncs
            gameDeviceMode: 'single-device', //2 'single-device', 'multi-device' - device setup
            gameMode: 'single-human',        //3 'single-human', 'multiple-humans' - how many humans
            gameVariant: 'no-surrender',     //4 'no surrender', 'kitty'
            computerPlayers: 5,              //5 Number of computer opponents (1-5)
            wildCardCount: 2,                //6 Number of wild cards (0-4)
            deckCount: 2,                    //7 Number of standard decks (1-3)
            autoArrangeAllowed: 'yes',       //8
            findAutoEnabled: 'yes',          //9
            winProbabilityMethod: 'tiered2 ', //10 'points', 'empirical', 'tiered', 'tiered2', "netEV"
            rounds: 3,                       //11 Number of rounds to play
            currentRound: 0,                 //12 Track current round

            // Table/Lobby settings
            maxPlayers: 6,                   //  Maximum players allowed at table (2-6)
            minPlayers: 2,                   // Minimum players to start game
            tableId: null,                   // For multiplayer table identification
            tableName: '',                   // Display name for table

            // UI/Display settings
            showAIThinking: true,            // Show AI thinking process
            animationSpeed: 'normal',        // 'slow', 'normal', 'fast'
            autoAdvance: false,              // Auto advance to next player

            // Advanced AI settings
            aiDifficulty: 'normal',          // 'easy', 'normal', 'hard'
            aiPersonality: 'balanced',       // 'aggressive', 'balanced', 'conservative'

            // stakes:
            stakesAnteAmount: 10,           // 0, 10, 20, etc.
            stakesMultiplierAmount: 2,      // 0, 1, 2, 3, etc.
            stakesSurrenderAmount: 0,      // 10, 20, etc.

            // countdown:
            countdownTime: 5,              // 10, 20, 30, etc.

            // automatics:
            automaticsAllowed: 'yes',       // 'yes' or 'no' - allow automatic hands
        };

//        this.loadFromStorage();
    }


    // Add methods to get/set specific settings
    getWinProbabilityMethod() {
        return this.config.winProbabilityMethod;
    }

    setWinProbabilityMethod(method) {
        this.config.winProbabilityMethod = method;
        this.saveToStorage();
    }

    getRounds() {
        return this.config.rounds;
    }

    setRounds(rounds) {
        this.config.rounds = rounds;
        this.saveToStorage();
    }

    // Add other getters/setters as needed...

    // Get current configuration
    getConfig() {
        return { ...this.config }; // Return a copy to prevent external modification
    }

    // Game mode settings
    setGameMode(mode) {
        const validModes = ['multiple-humans', 'single-human'];
        if (!validModes.includes(mode)) {
            throw new Error('Game mode must be: multiple-humans or single-human');
        }
        this.config.gameMode = mode;
        this.saveToStorage();
        console.log(`🎮 Game mode set to: ${mode}`);
    }

    getGameMode() {
        return this.config.gameMode;
    }

    setComputerPlayers(count) {
        if (count < 1 || count > 5) {
            throw new Error('Computer players must be between 1 and 5');
        }
        this.config.computerPlayers = count;
        this.saveToStorage();
        console.log(`🤖 Computer players set to: ${count}`);
    }

    getComputerPlayers() {
        return this.config.computerPlayers;
    }

    // Wild card settings
    setWildCardCount(count) {
        if (count < 0 || count > 4) {
            throw new Error('Wild card count must be between 0 and 4');
        }
        this.config.wildCardCount = count;
        this.saveToStorage();
        console.log(`🃏 Wild card count set to: ${count}`);
    }

    getWildCardCount() {
        return this.config.wildCardCount;
    }

    // Deck settings
    setDeckCount(count) {
        if (count < 1 || count > 3) {
            throw new Error('Deck count must be between 1 and 3');
        }
        this.config.deckCount = count;
        this.saveToStorage();
        console.log(`🎴 Deck count set to: ${count}`);
    }

    getDeckCount() {
        return this.config.deckCount;
    }

    // Automatics settings
    setAutomaticsAllowed(allowed) {
        if (allowed !== 'yes' && allowed !== 'no') {
            throw new Error('Automatics allowed must be "yes" or "no"');
        }
        this.config.automaticsAllowed = allowed;
        this.saveToStorage();
        console.log(`🎯 Automatics allowed set to: ${allowed}`);
    }

    getAutomaticsAllowed() {
        return this.config.automaticsAllowed;
    }

    // Reset to default settings
    resetToDefaults() {
        this.config = {
            gameMode: 'single-human',
            computerPlayers: 3,
            wildCardCount: 2,
            deckCount: 2
        };
        this.saveToStorage();
        console.log('🔄 Game configuration reset to defaults');
    }

    // Save configuration to localStorage
    saveToStorage() {
        try {
            localStorage.setItem('pyramidPokerConfig', JSON.stringify(this.config));
        } catch (error) {
            console.warn('Could not save configuration to localStorage:', error);
        }
    }

    // Load configuration from localStorage
    loadFromStorage() {
        try {
            const saved = localStorage.getItem('pyramidPokerConfig');
            if (saved) {
                const savedConfig = JSON.parse(saved);
                this.config = { ...this.config, ...savedConfig };
                console.log('⚙️ Loaded game configuration:', this.config);
            }
        } catch (error) {
            console.warn('Could not load configuration from localStorage:', error);
        }
    }

    // Get configuration summary for display
    getConfigSummary() {
        const summary = {
            'Game Mode': this.config.gameMode === 'single-human' ?
                `Single Player (vs ${this.config.computerPlayers} AI)` : 'Multiplayer',
            'Wild Cards': `${this.config.wildCardCount} cards`,
            'Decks': `${this.config.deckCount} ${this.config.deckCount === 1 ? 'deck' : 'decks'}`
        };

        return summary;
    }

    // Validate configuration
    isValid() {
        const { gameMode, computerPlayers, wildCardCount, deckCount } = this.config;

        if (!['multiple-humans', 'single-human'].includes(gameMode)) {
            return { valid: false, error: 'Game mode must be multiplayer or singleplayer' };
        }

        if (computerPlayers < 1 || computerPlayers > 5) {
            return { valid: false, error: 'Computer players must be between 1 and 5' };
        }

        if (wildCardCount < 0 || wildCardCount > 4) {
            return { valid: false, error: 'Wild card count must be between 0 and 4' };
        }

        if (deckCount < 1 || deckCount > 3) {
            return { valid: false, error: 'Deck count must be between 1 and 3' };
        }

        return { valid: true };
    }

    // Check if enough cards for the selected configuration
    canSupportGame() {
        const standardCardsPerDeck = 52;
        const totalStandardCards = this.config.deckCount * standardCardsPerDeck;
        const totalCards = totalStandardCards + this.config.wildCardCount;

        let playersNeeded;
        if (this.config.gameMode === 'single-human') {
            playersNeeded = 1 + this.config.computerPlayers; // Human + computers
        } else {
            playersNeeded = 4; // Default for multiplayer
        }

        const cardsNeeded = playersNeeded * 17;

        return {
            canSupport: totalCards >= cardsNeeded,
            totalCards,
            cardsNeeded,
            playersNeeded,
            shortage: Math.max(0, cardsNeeded - totalCards)
        };
    }
}


// Global configuration instance
window.gameConfig = new GameConfig();
