// js/core/tournament-summary.js
// Tournament summary display and post-tournament navigation

PyramidPoker.prototype.showTournamentSummary = async function(skipRoundByRound = false) {
        console.log('🏆 Showing tournament summary...');

        let standings = [];
        let payoutTransactions = [];
        let payoutMessage = null;
        if (!skipRoundByRound) {
            this.roundHistory.forEach((round, idx) => {
                console.log(`  - Round ${idx + 1}: roundNumber=${round.roundNumber}, hasChipChanges=${!!round.chipChanges}`);
            });

            // Calculate cumulative chip changes from all completed rounds
            const chipTotals = new Map();
            this.playerManager.players.forEach(player => {
                chipTotals.set(player.name, 0);
            });

            this.roundHistory.forEach(roundData => {
                if (roundData.chipChanges) {
                    roundData.chipChanges.forEach((chipChange, playerName) => {
                        const current = chipTotals.get(playerName) || 0;
                        chipTotals.set(playerName, current + chipChange);
                    });
                }
            });

            // Create sorted tournament standings by chip changes
            standings = [...chipTotals.entries()]
                .sort((a, b) => b[1] - a[1])
                .map((entry, index) => ({
                    position: index + 1,
                    playerName: entry[0],
                    totalChipChange: entry[1]
                }));

        }

        // Firestore write (owner) + session totals fetch (all players) — multi-device only
        let playerTotals = null;
        let sessionPlayers = null;
        let sessionTournaments = null;
        let sessionTournamentNumbers = null;
        if (gameConfig.config.gameDeviceMode === 'multi-device') {
            const db = firebase.firestore();

            if (window.isOwner && !skipRoundByRound) {
                const sessionScores = {};
                standings.forEach(s => {
                    sessionScores[s.playerName] = s.totalChipChange;
                });

                const tournamentEntry = {
                    scores: sessionScores,
                    completedAt: new Date().toISOString()
                };

                const sessionId = window.currentSessionId;

                console.log('💾 Firestore write attempt - tournamentNumber:', this.tournamentNumber, 'sessionId:', sessionId);

                try {
                    await db.collection('sessions').doc(sessionId).update({
                        [`tournaments.${this.tournamentNumber}`]: tournamentEntry
                    });
                    console.log('✅ Tournament entry saved');
                } catch (err) {
                    console.error('❌ Session write failed:', err);
                }
            }

            // Fetch session doc and compute cross-tournament totals (all players)
            try {
                let fetchSessionId = window.currentSessionId;
                if (!window.isOwner) {
                    await new Promise(r => setTimeout(r, 1000)); // guard against owner write race
                    const tableDoc = await db.collection('tables').doc(String(window.multiDeviceIntegration.tableId)).get();
                    fetchSessionId = tableDoc.data()?.currentSessionId;
                }
                if (fetchSessionId) {
                    const sessionDoc = await db.collection('sessions').doc(fetchSessionId).get();
                    if (sessionDoc.exists) {
                        const { players, tournaments } = sessionDoc.data();
                        const tournamentNumbers = Object.keys(tournaments).map(Number).sort((a, b) => a - b);
                        const allSessionPlayers = [...players];
                        tournamentNumbers.forEach(n => {
                            Object.keys(tournaments[n].scores || {}).forEach(email => {
                                if (!allSessionPlayers.includes(email)) allSessionPlayers.push(email);
                            });
                        });
                        playerTotals = {};
                        allSessionPlayers.forEach(p => playerTotals[p] = 0);
                        tournamentNumbers.forEach(n => {
                            allSessionPlayers.forEach(p => {
                                playerTotals[p] += tournaments[n].scores[p] || 0;
                            });
                        });
                        window.sessionTotals = { ...playerTotals };
                        sessionPlayers = allSessionPlayers;
                        sessionTournaments = tournaments;
                        sessionTournamentNumbers = tournamentNumbers;
                    }
                }
            } catch (err) {
                console.error('❌ Session fetch failed:', err);
            }
        }

        if (!skipRoundByRound) {
            if (gameConfig.config.gameDeviceMode !== 'multi-device') {
                payoutMessage = 'There is no payout for single user';
            } else if (playerTotals === null) {
                payoutMessage = 'I cannot perform payout calculations because of session fetch failure';
            } else {
                try {
                    const sessionTotalsForPayout = sessionPlayers.map(playerName => ({
                        playerName,
                        totalChipChange: playerTotals[playerName]
                    }));
                    payoutTransactions = window.payoutCalculator(sessionTotalsForPayout);
                    if (payoutTransactions.mismatch) {
                        console.warn('⚠️ Payout mismatch, suppressing potentially erroneous payouts:', payoutTransactions.mismatch);
                        payoutTransactions = [];
                        payoutMessage = 'Payout calculation failed';
                    }
                } catch (err) {
                    console.error('❌ Payout calculation failed:', err);
                    payoutTransactions = [];
                    payoutMessage = 'Payout calculation failed';
                }
            }
        }

        // Create tournament summary modal
        const modal = document.createElement('div');
        modal.id = 'tournamentSummaryModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.8); z-index: 1001;
            display: flex; align-items: center; justify-content: center;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(135deg, #2c3e50, #34495e);
            border-radius: 15px; border: 2px solid #ffd700;
            max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
            color: white; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            padding: 30px; text-align: center;
        `;

        // Build HTML content
        const titleText = skipRoundByRound ? '🔄 SESSION RESUME' : '🏆 TOURNAMENT COMPLETE! 🏆';
        let html = `
            <h1 style="color: #ffd700; margin-bottom: 24px; font-size: 20px;">
                ${titleText}
            </h1>
        `;

        if (!skipRoundByRound) {
            html += `
            <div style="background: rgba(255, 215, 0, 0.1); padding: 20px; border-radius: 10px; margin-bottom: 30px;">
                <h2 style="color: #4ecdc4; margin-bottom: 20px;">Final Standings</h2>
            `;

            standings.forEach(standing => {
                const medal = standing.position === 1 ? '🥇' :
                             standing.position === 2 ? '🥈' :
                             standing.position === 3 ? '🥉' : '🏅';
                const bgColor = standing.position === 1 ? 'rgba(255, 215, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)';
                const color = standing.totalChipChange >= 0 ? '#4ecdc4' : '#ff6b6b';
                html += `
                    <div style="background: ${bgColor}; padding: 15px; margin: 10px 0; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 16px;">${medal} ${standing.position}. ${standing.playerName}</span>
                        <span style="font-size: 14px; font-weight: bold; color: ${color};">${standing.totalChipChange > 0 ? '+' : ''}${standing.totalChipChange}</span>
                    </div>
                `;
            });

            html += `</div>`;

            html += `<div style="background: rgba(52, 73, 94, 0.5); padding: 20px; border-radius: 10px; margin-bottom: 24px;">
                <h3 style="color: #4ecdc4; margin-bottom: 15px;">Round-by-Round Breakdown</h3>
            `;

            for (let round = 1; round <= this.roundHistory.length; round++) {
                const roundData = this.roundHistory[round - 1];
                html += `<div style="margin-bottom: 15px;"><h4 style="color: #ffd700;">Round ${round}</h4>`;

                if (roundData.chipChanges) {
                    roundData.chipChanges.forEach((chipChange, playerName) => {
                        const sign = chipChange > 0 ? '+' : '';
                        const color = chipChange > 0 ? '#4ecdc4' : chipChange < 0 ? '#ff6b6b' : '#95a5a6';
                        html += `<div style="color: ${color};">${playerName}: ${sign}${chipChange}</div>`;
                    });
                }
                html += `</div>`;
            }

            html += `</div>`;
        }

        if (playerTotals !== null && sessionPlayers && sessionTournaments && sessionTournamentNumbers) {
            html += `<div style="background: rgba(52, 73, 94, 0.5); padding: 20px; border-radius: 10px; margin-bottom: 24px;">
                <h3 style="color: #4ecdc4; margin-bottom: 15px;">Session Totals</h3>
                <table style="width:100%; border-collapse:collapse;"><thead><tr>
                    <th style="padding:8px; color:#ffd700; border-bottom:2px solid #4ecdc4; text-align:left;">Tournament</th>`;
            sessionPlayers.forEach(p => {
                const displayName = p.includes('@') ? p.split('@')[0] : p;
                html += `<th style="padding:8px; color:#ffd700; border-bottom:2px solid #4ecdc4;">${displayName}</th>`;
            });
            html += `</tr></thead><tbody>`;
            sessionTournamentNumbers.forEach(n => {
                html += `<tr><td style="padding:8px; color:#ffd700; text-align:left;">Tournament ${n}</td>`;
                sessionPlayers.forEach(p => {
                    const score = sessionTournaments[n].scores[p] || 0;
                    const color = score > 0 ? '#4ecdc4' : score < 0 ? '#ff6b6b' : '#95a5a6';
                    html += `<td style="padding:8px; color:${color};">${score > 0 ? '+' : ''}${score}</td>`;
                });
                html += `</tr>`;
            });
            html += `</tbody><tfoot><tr style="border-top:2px solid #ffd700;">
                <td style="padding:8px; color:#ffd700; font-weight:bold; text-align:left;">TOTAL</td>`;
            sessionPlayers.forEach(p => {
                const total = playerTotals[p];
                const color = total > 0 ? '#4ecdc4' : total < 0 ? '#ff6b6b' : '#95a5a6';
                html += `<td style="padding:8px; color:${color}; font-weight:bold;">${total > 0 ? '+' : ''}${total}</td>`;
            });
            html += `</tr></tfoot></table></div>`;
        }

        if (gameConfig.config.gameDeviceMode === 'multi-device') {
            if (window.isOwner) {
                html += `
                    <div style="display:flex; gap:16px; justify-content:center; margin-top:10px;">
                        <button onclick="handleNextTournament();"
                                style="background:#4ecdc4; color:white; border:none; padding:15px 30px; border-radius:8px; font-size:16px; font-weight:bold; cursor:pointer;">
                            Next Tournament
                        </button>
                        <button onclick="handleEndSession();"
                                style="background:#ff6b6b; color:white; border:none; padding:15px 30px; border-radius:8px; font-size:16px; font-weight:bold; cursor:pointer;">
                            End Session
                        </button>
                    </div>
                `;
            } else {
                html += `<p style="color:#ffd700; font-size:16px; margin-top:20px;">Waiting for owner...</p>`;
            }
        } else {
            html += `
                <button onclick="game.returnToLobbyAfterTournament();"
                        style="background: #4ecdc4; color: white; border: none; padding: 15px 30px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px;">
                    Return to Table
                </button>
            `;
        }

        if (!skipRoundByRound) {
            html += `
    <div style="margin-top: 20px;">
        <button id="showPayoutBtn" onclick="document.getElementById('payoutSection').style.display = document.getElementById('payoutSection').style.display === 'none' ? 'block' : 'none';"
                style="background: #f39c12; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;">
            Show Payout
        </button>
        <div id="payoutSection" style="display: none; margin-top: 15px; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
`;

            if (payoutMessage) {
                html += `<p style="color: #ff6b6b; font-weight: bold;">${payoutMessage}</p>`;
            } else if (payoutTransactions.length === 0) {
                html += `<p style="color: #95a5a6;">All settled — no payments needed.</p>`;
            } else {
                payoutTransactions.forEach(transaction => {
                    html += `<div style="color: #ecf0f1; padding: 4px 0;">${transaction.from} pays ${transaction.to}: ${transaction.amount}</div>`;
                });
            }

            html += `</div></div>`;
        }

        content.innerHTML = html;
        modal.appendChild(content);
        document.body.appendChild(modal);
    };


PyramidPoker.prototype.returnToLobbyAfterTournament = function() {
        console.log('🔙 Returning to table/lobby...');

        // Close the tournament summary modal
        const modals = document.querySelectorAll('div[style*="position: fixed"]');
        modals.forEach(modal => {
            if (modal.textContent.includes('TOURNAMENT COMPLETE')) {
                modal.remove();
            }
        });

        if (gameConfig.config.gameDeviceMode === 'multi-device') {
            // MULTIPLAYER: Only owner sets state, non-owners just do cleanup
            if (window.isOwner) {
                setTableState(TABLE_STATES.LOBBY);
                console.log('✅ Owner set tableState back to LOBBY');
            } else {
                // Non-owner just does local cleanup
                console.log('✅ Non-owner cleaned up locally');
            }
        } else {
            // SINGLE PLAYER: Reset to waiting state
            this.gameState = 'waiting';
            this.currentRound = 0;
            updateDisplay(this);
            console.log('✅ Single-player returned to waiting');
        }

        // Show table screen for everyone
        showTableScreen();
    };


function handleNextTournament() {
    document.getElementById('tournamentSummaryModal')?.remove();
    setTableState(TABLE_STATES.NEW_TOURNAMENT);
}

async function handleEndSession() {
    const db = firebase.firestore();
    await db.collection('sessions').doc(window.currentSessionId).update({
        ended: true,
        endedAt: new Date().toISOString()
    });
    document.getElementById('tournamentSummaryModal')?.remove();
    setTableState(TABLE_STATES.SESSION_ENDED);
}
