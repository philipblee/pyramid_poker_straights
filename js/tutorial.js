// js/tutorial.js
// Tutorial system for Pyramid Poker Online

class Tutorial {
    constructor() {
        this.currentTab = 'wild-cards';
        this.init();
    }

    init() {
        // Create tutorial button in header
        this.createTutorialButton();

        // Create modal overlay
        this.createModal();

        // Set up event listeners
        this.setupEventListeners();
    }

    createTutorialButton() {
        const headerButtons = document.querySelector('.header-content'); // Changed from .header-buttons
        if (!headerButtons) {
            console.log('❌ .game-controls not found! Button not created.');
            return;
        }

        const tutorialBtn = document.createElement('button');
        tutorialBtn.id = 'tutorialBtn';
        tutorialBtn.className = 'btn btn-info';
        tutorialBtn.innerHTML = 'Tutorial';
        tutorialBtn.title = 'Game Tutorial';
        tutorialBtn.style.cssText = 'width: 120px; height: 42px; font-size: 16px;';
        tutorialBtn.onclick = () => this.show();

        // Insert before WEBSITE button
        const websiteBtn = document.getElementById('websiteBtn');
        if (websiteBtn) {
            headerButtons.insertBefore(tutorialBtn, websiteBtn);
        } else {
            headerButtons.appendChild(tutorialBtn);
        }
    }

    createModal() {
        const overlay = document.createElement('div');
        overlay.id = 'tutorial-overlay';
        overlay.className = 'tutorial-overlay';
        overlay.innerHTML = `
            <div class="tutorial-modal">
                <div class="tutorial-header">
                    <h2>🎓 Pyramid Poker Tutorial</h2>
                    <button class="tutorial-close" onclick="tutorial.hide()">×</button>
                </div>

                <div class="tutorial-tabs">
                    <button class="tutorial-tab active" data-tab="wild-cards">Wild Cards</button>
                    <button class="tutorial-tab" data-tab="buttons">Buttons</button>
                    <button class="tutorial-tab" data-tab="automatics">Automatics</button>
                    <button class="tutorial-tab" data-tab="scoring">Scoring</button>
                </div>

                <div class="tutorial-content">
                    ${this.getWildCardsContent()}
                    ${this.getButtonsContent()}
                    ${this.getAutomaticsContent()}
                    ${this.getScoringContent()}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hide();
        });
    }

    setupEventListeners() {
        const tabs = document.querySelectorAll('.tutorial-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!document.getElementById('tutorial-overlay').classList.contains('active')) return;

            if (e.key === 'Escape') this.hide();
            if (e.key === 'ArrowLeft') this.previousTab();
            if (e.key === 'ArrowRight') this.nextTab();
        });
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.tutorial-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update content sections
        document.querySelectorAll('.tutorial-section').forEach(section => {
            section.classList.toggle('active', section.id === `section-${tabName}`);
        });
    }

    previousTab() {
        const tabs = ['wild-cards', 'buttons', 'automatics', 'scoring'];
        const currentIndex = tabs.indexOf(this.currentTab);
        const newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        this.switchTab(tabs[newIndex]);
    }

    nextTab() {
        const tabs = ['wild-cards', 'buttons', 'automatics', 'scoring'];
        const currentIndex = tabs.indexOf(this.currentTab);
        const newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        this.switchTab(tabs[newIndex]);
    }

    show() {
        document.getElementById('tutorial-overlay').classList.add('active');
    }

    hide() {
        document.getElementById('tutorial-overlay').classList.remove('active');
    }

    getWildCardsContent() {
    return `
        <div id="section-wild-cards" class="tutorial-section active">
            <h3>🃏 Wild Cards</h3>

            <p>Wild cards can represent any card you choose. They are <strong>dealt randomly</strong> at the start of each round.</p>

            <h4>Important: Wild Cards must be set to a specific card</h4>
            <div class="tutorial-example">
                <ul>

                    <li><strong>To set a wild card</strong> you must click the wild card to open the Wild Card Modal</li>
                    <li><strong>Select the specific card</strong> you want it to become (rank and suit)</li>
                    <li>The wild becomes that card unless you change it</li>
                    <li>You can <strong>change it again</strong> by clicking the wild again</li>
                </ul>
            </div>

            <h4>Example: Using a Wild Card</h4>
            <div class="tutorial-example">
                <p><strong>Your hand includes:</strong></p>
                <div class="tutorial-card-display">
                    <div class="tutorial-mini-card red">K♥</div>
                    <div class="tutorial-mini-card red">Q♥</div>
                    <div class="tutorial-mini-card red">J♥</div>
                    <div class="tutorial-mini-card red">10♥</div>
                    <div class="tutorial-mini-card wild">WILD</div>
                </div>
                <p>→ Click the WILD, set it to <strong>9♥</strong></p>
                <p>→ Result: <strong>Straight Flush!</strong> (K-Q-J-10-9 of hearts)</p>
            </div>
        </div>
    `;
}

    getButtonsContent() {
        return `
            <div id="section-buttons" class="tutorial-section">
                <h3>🎮 Game Buttons</h3>

                <h4>Buttons</h4>

                <div class="tutorial-example">
                <ul>
                    <li><strong>BEST</strong> - Automatically arranges cards into best valid hands</li>
                    <li><strong>RANK</strong> - Sorts staging area cards by rank (A-2)</li>
                    <li><strong>SUIT</strong> - Sorts staging area cards by suit ( ♠ ♥ ♦ ♣ )</li>
                    <li><strong>SUBMIT</strong> -   Disabled until there is a valid arrangement</li>
                    <li><strong>FIND-AUTO</strong> - Abbreviation for Find AUTOMATIC</li>
                    <li><strong>PLAY-AUTO</strong> - Abbreviation for Play AUTOMATIC. Disabled until there is a valid AUTOMATIC</li>
                </ul>
                </div>

            <h4>PLAY-AUTO - Play AUTOMATIC</h4>

                <div class="tutorial-example">
                    <ul>
                        <li><strong>Enabled when:</strong> Valid Automatic is detected</li>
                        <li>One of four automatics detected:
                            <ul style="margin-top: 8px;">
                                <li>Three-Full-Houses (all three hands are full houses)</li>
                                <li>Dragon (13 cards in sequence)</li>
                                <li>Three-Flush (all three hands are flushes)</li>
                                <li>Three-Straight (all three hands are straights)</li>

                            </ul>
                        </li>
                        <li><strong>Click PLAY A</strong> to play the AUTOMATIC</li>
                    </ul>
                </div>

                <h4>FIND-AUTO - Detect AUTOMATIC</h4>

                <div class="tutorial-example">

                <ul>
                    <li><strong>FIND-AUTO</strong> - Searches staging area for automatics and arranges if found</li>
                    <li>Automatically fills Back/Middle/Front if automatic pattern exists</li>
                    <li>Once arranged, PLAY-A button is enabled</li>
                </ul>
                </div>

            </div>
        `;
    }

    getAutomaticsContent() {
        return `
            <div id="section-automatics" class="tutorial-section">
                <h3>✨ Automatic Hands</h3>

                <div class="automatic-type">
                    <h4>🏠 Three-Full-Houses</h4>
                    <p>All three hands are <strong>full houses</strong> (3 of a kind + pair)</p>
                    <div class="hand-row">
                        <span class="hand-label">Back:</span> Full House
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Middle:</span> Full House
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Front:</span> Full House
                    </div>
                    <div class="tutorial-example" style="margin-top: 15px;">
                        <p><strong>Example:</strong></p>
                        <div class="hand-row">Back: K♠ K♥ K♦ 9♣ 9♠ (Kings full of Nines)</div>
                        <div class="hand-row">Middle: 7♦ 7♠ 7♥ 4♣ 4♦ (Sevens full of Fours)</div>
                        <div class="hand-row">Front: A♠ A♥ A♦ 2♣ 2♠ (Aces full of Twos)</div>
                    </div>
                   
                </div>


                <div class="automatic-type">
                    <h4>🐉 Dragon</h4>
                    <p>One card of every rank: A-K-Q-J-10 in the back, 9-8-7-6-5 in the middle, 4-3-2 in the front, any suits</p>
                    <div class="hand-row">
                        <span class="hand-label">Back:</span> A-K-Q-J-10
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Middle:</span> 9-8-7-6-5
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Front:</span> 4-3-2
                    </div>
                
                </div>

                <div class="automatic-type">
                    <h4>📈 Three-Straight</h4>
                    <p>All three hands are <strong>straights</strong> (5 consecutive cards)</p>
                    <div class="hand-row">
                        <span class="hand-label">Back:</span> Straight or Straight Flush
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Middle:</span> Straight or Straight Flush
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Front:</span> Straight or Straight Flush
                    </div>
                    <div class="tutorial-example" style="margin-top: 15px;">
                        <p><strong>Example:</strong></p>
                        <div class="hand-row">Back: 9♠ 8♥ 7♦ 6♣ 5♠ (Straight)</div>
                        <div class="hand-row">Middle: K♦ Q♠ J♥ 10♣ 9♦ (Straight)</div>
                        <div class="hand-row">Front: 5♥ 4♠ 3♦ 2♣ A♠ (Straight)</div>
                    </div>

                </div>

                <div class="automatic-type">
                    <h4>💧 Three-Flush</h4>
                    <p>All three hands are <strong>flushes</strong> (5 cards same suit)</p>
                    <div class="hand-row">
                        <span class="hand-label">Back:</span> Flush or Straight Flush
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Middle:</span> Flush or Straight Flush
                    </div>
                    <div class="hand-row">
                        <span class="hand-label">Front:</span> Flush or Straight Flush
                    </div>
                    <div class="tutorial-example" style="margin-top: 15px;">
                        <p><strong>Example:</strong></p>
                        <div class="hand-row">Back: K♠ Q♠ J♠ 10♠ 9♠ (Straight Flush)</div>
                        <div class="hand-row">Middle: A♥ J♥ 9♥ 7♥ 5♥ (Flush)</div>
                        <div class="hand-row">Front: K♦ Q♦ 10♦ 8♦ 6♦ (Flush)</div>
                    </div>

                </div>


                <h4 style="margin-top: 30px;">🎯 Key Points</h4>
                <ul>
                    <li><strong>Automatic wins</strong> against any regular arrangement</li>
                    <li>Higher automatic wins (Three Full House > Dragon > Three-Straight > Three-Flush)</li>
                    <li>Use <strong>FIND-AUTO</strong> button to automatically find automatics</li>
                    <li><strong>Wild cards</strong> can help complete automatics</li>
                </ul>
            </div>
        `;
    }

    getScoringContent() {
        return `
            <div id="section-scoring" class="tutorial-section">
                <h3>📊 Scoring System</h3>

                <h4>Hand Values (Regular Play)</h4>
                <p>Each hand has a point value based on its type and whether it's in back, middle, or front hand position:</p>

                <div class="tutorial-example">
                    <h4 style="color: #ffd700; margin-top: 0;">Back Hand (5-8 cards)</h4>
                    <ul>
                        <li>Eight of a Kind: 18 points</li>                        
                        <li>Eight-Card Straight Flush: 14 points</li> 
                        <li>Seven of a Kind: 14 points</li>                        
                        <li>Seven-Card Straight Flush: 11 points</li>  
                        <li>Six of a Kind: 10 points</li>                        
                        <li>Six-Card Straight Flush: 8 points</li>                        
                        <li>Five of a Kind: 6 points</li>
                        <li>Straight Flush: 5 points</li>
                        <li>Four of a Kind: 4 points</li>
                        <li>Full House: 1 points</li>
                        <li>Flush: 1 points</li>
                        <li>Straight: 1 point</li>
                    </ul>
                </div>

                <div class="tutorial-example">
                    <h4 style="color: #ffd700; margin-top: 0;">Middle Hand (5-7 cards)</h4>
                    <ul>
                        <li>Seven of a Kind: 28 points</li>                        
                        <li>Seven-Card Straight Flush: 22 points</li>  
                        <li>Six of a Kind: 20 points</li>                        
                        <li>Six-Card Straight Flush: 16 points</li>         
                        <li>Straight Flush: 10 points</li>
                        <li>Four of a Kind: 8 points</li>
                        <li>Full House: 2 point</li>
                    </ul>
                </div>

                <div class="tutorial-example">
                    <h4 style="color: #ffd700; margin-top: 0;">Front Hand (3-5 cards)</h4>
                    <ul>
                        <li>Straight Flush: 15 points</li>
                        <li>Four of a Kind: 12 points</li>
                        <li>Full House: 5 points</li>
                        <li>Flush: 4 points</li>
                        <li>Straight: 4 point</li>
                        <li>Three of a Kind: 3 points</li>
                    </ul>
                </div>

            <h4>How Scoring Works</h4>
            <div class="tutorial-example">
                <ul>
                    <li><strong>Compare hands:</strong> Back vs Back, Middle vs Middle, Front vs Front</li>
                    <li><strong>For each hand:</strong> you either win or lose that number of points from each opponent</li>
                    <li><strong>If you win x points and multiplier is y, you win x*y chips</strong></li>
                    <li><strong>Conversely, the opponent loses x*y chips.  It's always zero sum.'</strong></li>
                </ul>
            </div>

                <div class="tutorial-example">
                    <h4 style="margin-top: 0;">Example Round</h4>
                    <p><strong>You vs Opponent:</strong></p>
                    <ul>
                        <li>Back: You win with Four of a Kind (+4 points)</li>
                        <li>Middle: Opponent wins with Full House (-2 points)</li>
                        <li>Front: You win with Straight (+4 points)</li>
                        <li>Net Points: You win 6 net points</li>
                    </ul>
                    <p><strong>Multipier is 2</p>
                    <p><strong>Chips are 6 * 2 or 12</p>
                    <p><strong>Round Result:</strong> You win 12 chips, the opponent loses 12 chips</p>
                </div>

                <h4>Automatic Hands Scoring</h4>
                <ul>
                    <li>Automatic <strong>automatically wins</strong> +3 points</li>
                    <li>If multiple Automatics are played <strong>Stronger Automatic Wins</strong> +3 points</li>
                    <li>Automatic Ranking: Three Full House > Dragon > Three Straight > Three Flush</li>
                    <li>If both players play the same Automatic Type, then the three hands are scored like normal</li>
                </ul>

                <div class="tutorial-example">
                    <h4 style="margin-top: 0;">Automatic Example</h4>
                    <p>You have Three-Flush vs opponent's normal arrangement:</p>
                    <ul>
                        <li>Win all three hands: +3 chips</li>
                        <li>Three-Flush bonus: +10 points</li>
                    </ul>
                    <p><strong>Total:</strong> You +13 chips</p>
                </div>

                <h4>Strategy Tips</h4>
                <ul>
                    <li>Balance hand strength vs hand bonuses</li>
                    <li>Strong back hand is crucial (highest potential bonus)</li>
                    <li>Don't forget the scoop bonus for winning all three!</li>
                    <li>Automatics are powerful but require specific cards</li>
                </ul>
            </div>
        `;
    }
}

// Initialize tutorial when DOM is ready
let tutorial;
document.addEventListener('DOMContentLoaded', () => {
    tutorial = new Tutorial();
});
