// js/hands/detect-automatics.js
// Encapsulates UI handling for detecting and playing automatic hands

(function attachAutomaticHandlers() {

    function detectAutomatics() {

        console.log('🎯 detectAutomatics CALLED');
        console.log('🎯 window.currentAutomatic:', window.currentAutomatic);

        // GUARD: If automatic already detected, do nothing
        if (window.currentAutomatic) {
            console.log('⚠️ Automatic already detected, ignoring duplicate call');
            return;
        }

        // Pool all cards back to staging regardless of current arrangement
        const currentPlayer = window.game.playerManager.getCurrentPlayer();
        const playerData = window.game.playerHands.get(currentPlayer.name);
        if (playerData) {
        playerData.cards = [
            ...playerData.cards,
            ...playerData.back,
            ...playerData.middle,
            ...playerData.front
        ].map(c => (c.isWild || c.wasWild) ?
            { ...c, rank: '', suit: '', value: 0, isWild: true, wasWild: false } : c);
            playerData.back = [];
            playerData.middle = [];
            playerData.front = [];
            window.game.loadCurrentPlayerHand();

            const wildCheck = playerData.cards.find(c => c.isWild);
            console.log('🃏 Wild after reset:', JSON.stringify(wildCheck));
        }

        window.game.autoArrangeUsed = false;
        document.getElementById('autoArrange').textContent = 'BEST';
        document.getElementById('prevArrangement').style.display = 'none';
        document.getElementById('nextArrangement').style.display = 'none';
        document.getElementById('arrangementCounter').style.display = 'none';
        window.topArrangements = [];
        window.topArrangementIndex = 0;

        const stagingArea = document.getElementById('playerHand');

        if (!stagingArea) {
            console.error('❌ playerHand element not found');
            showAutomaticMessage('❌ Error: Staging area not found');
            return;
        }

        const cardElements = stagingArea.querySelectorAll('.card');
        if (cardElements.length === 0) {
            showAutomaticMessage('❌ No cards in staging area');
            return;
        }

        const allCards = Array.from(cardElements).map(cardEl => JSON.parse(cardEl.dataset.card));

        console.log('🔍 Searching for automatics with', allCards.length, 'cards...');
        const automaticsFound = findAutomatics(allCards);
        const automaticType = automaticsFound.best;

        if (automaticType) {
            const automaticName = automaticType.replace(/-/g, ' ').toUpperCase();
            showAutomaticMessage(`✨ Automatic Found: ${automaticName}`);

            // A three flush with a wild to spare comes with variants, strongest first, for the arrangement scroller
            const automaticArrangement = automaticsFound.automatics[automaticType];
            const arrangementChoices = automaticArrangement.variants || [automaticArrangement];
            if (arrangementChoices.length > 1) {
                window.topArrangements = arrangementChoices.map(choice => ({
                    arrangement: {
                        back: { cards: choice.back },
                        middle: { cards: choice.middle },
                        front: { cards: choice.front },
                        stagingCards: choice.discards
                    }
                }));
                window.topArrangementIndex = 0;
                document.getElementById('prevArrangement').style.display = 'inline-block';
                document.getElementById('nextArrangement').style.display = 'inline-block';
                document.getElementById('arrangementCounter').style.display = 'inline-block';
                document.getElementById('arrangementCounter').textContent = `1/${arrangementChoices.length}`;
            }

            // Copies, so moving cards on the board never changes the stored arrangements
            const firstChoice = arrangementChoices[0];
            if (playerData) {
                playerData.back = firstChoice.back.map(card => ({ ...card }));
                playerData.middle = firstChoice.middle.map(card => ({ ...card }));
                playerData.front = firstChoice.front.map(card => ({ ...card }));
                playerData.cards = firstChoice.discards.map(card => ({ ...card }));
            }
            window.game.loadCurrentPlayerHand();

            window.currentAutomatic = automaticType;
            window.game.validateHands();
            console.log(`✅ Arranged ${automaticType}${arrangementChoices.length > 1 ? ` with ${arrangementChoices.length} variants` : ''}`);

        } else {
            showAutomaticMessage('❌ No automatic in this hand');

            // Do not move any cards; just reset state/button
            window.currentAutomatic = null;

            const autoButton = document.getElementById('detectAutomatics');
            if (autoButton) {
                autoButton.textContent = 'FIND-AUTO';
                autoButton.title = '';
            }

        }
    }

    function showAutomaticMessage(message) {
        const messageDiv = document.getElementById('automaticMessage');
        if (messageDiv) {
            messageDiv.textContent = message;
            messageDiv.style.display = 'block';
        } else {
            console.log(message);
        }
    }

    function hideAutomaticMessage() {
        const messageDiv = document.getElementById('automaticMessage');
        if (messageDiv) {
            messageDiv.style.display = 'none';
            messageDiv.textContent = '';
        }
    }
    window.hideAutomaticMessage = hideAutomaticMessage;

    function playAutomatic() {
        if (!window.currentAutomatic) return;

        // Clear flag
        window.currentAutomatic = null;

        // Submit using existing method
        window.game.playAutomatic();

        console.log(`🎯 Submitted automatic`);
    }

    function resetAutomaticButton() {
        const autoButton = document.getElementById('detectAutomatics');
        if (autoButton) {
            autoButton.textContent = 'FIND AUTO';
            autoButton.title = '';
            autoButton.disabled = false;
        }

        const playAutoBtn = document.getElementById('playAutomatic');
        if (playAutoBtn) {
            playAutoBtn.textContent = 'PLAY AUTO';
            // Don't change disabled state - that's controlled by automatic detection
        }

        window.currentAutomatic = null;
    }

    // Expose to global scope
    window.showAutomaticMessage = showAutomaticMessage;
    window.detectAutomatics = detectAutomatics;
    window.playAutomatic = playAutomatic;
    window.resetAutomaticButton = resetAutomaticButton;
})();
