// Progress lines for long batch runs (scripts/deal-lookup-rounds.js): printed about every 30 seconds and at least
// every 25 rounds (checked as rounds complete), and the latest line written to a progress file, overwritten each time,
// so a background run can be checked with Get-Content <file>.

const fs = require('fs');
const path = require('path');

const PROGRESS_INTERVAL_MS = 30000;
const PROGRESS_INTERVAL_ROUNDS = 25;

function formatDuration(totalSeconds) {
    const wholeSeconds = Math.round(totalSeconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;
    return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

// unitName names what is counted in the line (default 'round')
function runProgress(label, totalRounds, progressPath, unitName = 'round') {
    const startedAt = Date.now();
    let lastPrintAt = startedAt;
    let lastPrintedRounds = 0;
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });

    // detailText is evaluated only when a line is due
    function report(roundsDone, detailText = () => '') {
        const now = Date.now();
        const isDue = roundsDone >= totalRounds || now - lastPrintAt >= PROGRESS_INTERVAL_MS ||
            roundsDone - lastPrintedRounds >= PROGRESS_INTERVAL_ROUNDS;
        if (!isDue) return;
        lastPrintAt = now;
        lastPrintedRounds = roundsDone;
        const elapsedSeconds = (now - startedAt) / 1000;
        const secondsPerRound = roundsDone > 0 ? elapsedSeconds / roundsDone : null;
        const remainingText = secondsPerRound === null ? 'n/a' : formatDuration(secondsPerRound * (totalRounds - roundsDone));
        const detail = detailText();
        const progressLine = `${label}: ${roundsDone}/${totalRounds} ${unitName}s, elapsed ${formatDuration(elapsedSeconds)},` +
            ` remaining ~${remainingText}${secondsPerRound === null ? '' : ` (${secondsPerRound.toFixed(2)}s/${unitName})`}${detail ? `; ${detail}` : ''}`;
        console.log(progressLine);
        fs.writeFileSync(progressPath, `${new Date(now).toISOString()} ${progressLine}\n`);
    }

    return { report };
}

module.exports = { runProgress };
