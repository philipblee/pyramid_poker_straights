// js/utilities/remote-debug-logger.js
// Always-on remote debug log: buffers events in memory and appends them in batches to
// RTDB debugLogs/{tableId}/{round}/{uid}. Fire-and-forget; never throws into gameplay.

const REMOTE_DEBUG_FLUSH_INTERVAL_MS = 5000;
const REMOTE_DEBUG_FLUSH_AT_ENTRY_COUNT = 25;
const REMOTE_DEBUG_MAX_BUFFERED_ENTRIES = 200;     // drop-oldest beyond this
const REMOTE_DEBUG_MAX_BATCHES_PER_ROUND = 40;     // per device; later batches for that round are dropped
const REMOTE_DEBUG_MAX_DETAILS_CHARS = 500;
const REMOTE_DEBUG_MAX_BATCH_CHARS = 15000;        // must stay under the rules limit (16000)

const remoteDebugState = {
    serverTimeOffsetMs: 0,
    pendingEntries: [],
    droppedEntryCount: 0,
    batchCountByRound: new Map()
};

/**
 * Config switch: on unless gameConfig.config.remoteDebugLogging is 'no'
 * @returns {boolean}
 */
function isRemoteDebugLoggingEnabled() {
    try {
        return window.gameConfig?.config?.remoteDebugLogging !== 'no';
    } catch (configError) {
        return false;
    }
}

/**
 * Record one debug event; never throws
 * @param {string} eventName - Short event name, e.g. 'proceedToScoringFailed'
 * @param {Object} eventDetails - Small plain object of values worth keeping
 * @param {boolean} flushNow - Write the buffer immediately (key events)
 */
function remoteDebugLogger(eventName, eventDetails = {}, flushNow = false) {
    try {
        if (!isRemoteDebugLoggingEnabled()) return;

        let detailsJson;
        try {
            detailsJson = JSON.stringify(eventDetails ?? {});
        } catch (serializeError) {
            detailsJson = '"[unserializable]"';
        }
        if (detailsJson.length > REMOTE_DEBUG_MAX_DETAILS_CHARS) {
            detailsJson = detailsJson.slice(0, REMOTE_DEBUG_MAX_DETAILS_CHARS) + '…';
        }

        const localTimeMs = Date.now();
        remoteDebugState.pendingEntries.push({
            localTimeMs,
            serverTimeMs: localTimeMs + remoteDebugState.serverTimeOffsetMs,
            round: window.game?.currentRound ?? 0,
            tableState: window.game?.tableState ?? null,
            eventName: String(eventName).slice(0, 80),
            detailsJson
        });

        while (remoteDebugState.pendingEntries.length > REMOTE_DEBUG_MAX_BUFFERED_ENTRIES) {
            remoteDebugState.pendingEntries.shift();
            remoteDebugState.droppedEntryCount++;
        }

        if (flushNow || remoteDebugState.pendingEntries.length >= REMOTE_DEBUG_FLUSH_AT_ENTRY_COUNT) {
            flushRemoteDebugLog(eventName);
        }
    } catch (loggerError) {
        // Logging must never affect gameplay
    }
}

/**
 * Append buffered entries to RTDB, one batch per round; entries stay buffered until a table and user exist
 * @param {string} flushReason - Why this flush happened (interval, pagehide, event name)
 */
function flushRemoteDebugLog(flushReason) {
    try {
        if (!isRemoteDebugLoggingEnabled()) {
            remoteDebugState.pendingEntries.length = 0;
            return;
        }

        const tableId = window.game?.currentTableId;
        const authUid = firebase.auth().currentUser?.uid;
        if (!tableId || !authUid || remoteDebugState.pendingEntries.length === 0) return;

        const entriesToSend = remoteDebugState.pendingEntries.splice(0);
        const entriesByRound = new Map();
        entriesToSend.forEach((logEntry) => {
            const roundKey = Number.isInteger(logEntry.round) && logEntry.round >= 0 ? String(logEntry.round) : '0';
            if (!entriesByRound.has(roundKey)) entriesByRound.set(roundKey, []);
            entriesByRound.get(roundKey).push(logEntry);
        });

        entriesByRound.forEach((roundEntries, roundKey) => {
            const batchesAlreadyWritten = remoteDebugState.batchCountByRound.get(roundKey) || 0;
            if (batchesAlreadyWritten >= REMOTE_DEBUG_MAX_BATCHES_PER_ROUND) {
                remoteDebugState.droppedEntryCount += roundEntries.length;
                return;
            }

            let entriesJson = JSON.stringify(roundEntries);
            while (entriesJson.length > REMOTE_DEBUG_MAX_BATCH_CHARS && roundEntries.length > 1) {
                roundEntries.shift();
                remoteDebugState.droppedEntryCount++;
                entriesJson = JSON.stringify(roundEntries);
            }
            if (entriesJson.length > REMOTE_DEBUG_MAX_BATCH_CHARS) return;

            remoteDebugState.batchCountByRound.set(roundKey, batchesAlreadyWritten + 1);
            const droppedBeforeBatch = remoteDebugState.droppedEntryCount;
            remoteDebugState.droppedEntryCount = 0;

            firebase.database()
                .ref(`debugLogs/${tableId}/${roundKey}/${authUid}`)
                .push({
                    playerName: String(window.uniquePlayerName || '').slice(0, 120),
                    isOwner: window.isOwner === true,
                    flushReason: String(flushReason).slice(0, 40),
                    droppedBefore: droppedBeforeBatch,
                    writtenAt: firebase.database.ServerValue.TIMESTAMP,
                    entriesJson
                })
                .catch(() => {});
        });
    } catch (flushError) {
        // Logging must never affect gameplay
    }
}

// Startup: server time offset, periodic flush, lifecycle and connection events, uncaught errors
(function startRemoteDebugLogger() {
    try {
        firebase.database().ref('.info/serverTimeOffset').on('value', (offsetSnapshot) => {
            try {
                remoteDebugState.serverTimeOffsetMs = Number(offsetSnapshot.val()) || 0;
            } catch (offsetError) {}
        });

        firebase.database().ref('.info/connected').on('value', (connectedSnapshot) => {
            remoteDebugLogger('rtdbConnected', { connected: connectedSnapshot.val() === true });
        });

        setInterval(() => flushRemoteDebugLog('interval'), REMOTE_DEBUG_FLUSH_INTERVAL_MS);

        document.addEventListener('visibilitychange', () => {
            remoteDebugLogger('visibility', { visibilityState: document.visibilityState },
                document.visibilityState === 'hidden');
        });
        window.addEventListener('pagehide', () => remoteDebugLogger('pagehide', {}, true));

        window.addEventListener('error', (errorEvent) => {
            remoteDebugLogger('windowError', {
                message: String(errorEvent.message).slice(0, 200),
                source: errorEvent.filename,
                line: errorEvent.lineno
            }, true);
        });
        window.addEventListener('unhandledrejection', (rejectionEvent) => {
            remoteDebugLogger('unhandledRejection', {
                reason: String(rejectionEvent.reason?.stack || rejectionEvent.reason).slice(0, 400)
            }, true);
        });
    } catch (startupError) {
        // Logging must never affect gameplay
    }
})();

window.remoteDebugLogger = remoteDebugLogger;
window.flushRemoteDebugLog = flushRemoteDebugLog;
