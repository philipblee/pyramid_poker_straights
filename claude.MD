# Pyramid Poker Online — CLAUDE.md

## Project Overview
Web-based Chinese Poker variant (single-player vs AI and multiplayer).
Stack: JavaScript, HTML/CSS, Firebase (Firestore + Realtime Database), Git/GitHub Pages.

## Key Files
- `game.html` — main game page
- `js/core/game.js` — main game class
- `js/ui/lobby.js` — lobby UI
- `js/ui/display.js` — card display and drag-and-drop
- `js/multiplayer/multi-device-integration.js` — multiplayer coordination
- `js/hands/evaluate-hand.js` — hand evaluation
- `js/hands/hand-detector.js` — hand detection
- `js/game-flow/game-state-manager.js` — state machine
- `js/game-flow/surrender-decision.js` — surrender logic
- `js/utils/card-sorter.js` — card sorting

## Folder Structure
js/ → arrange, constants, core, firebase, game-flow, hands,
       heuristics, multiplayer, scoring, stats, tests, ui, utilities, utils

## Firebase Architecture
- **Realtime Database** — ephemeral state (table state, player lists, turn coordination)
- **Firestore** — persistent data (arrangements, scoring, history)
- `window.isOwner` is the single source of truth for ownership checks

## Git Workflow
- `ui-stable` — deployed branch (GitHub Pages)
- All work is committed directly to `ui-stable`; `main` is no longer maintained
- One-line git commits

## Naming Conventions
- Filenames: kebab-case → main function: camelCase matching filename
  - `evaluate-hand.js` → `evaluateHand()`
- Variables: descriptive, content-based (no `result`, `data`, `obj`)
- New code only — don't migrate working code

## Rules
1. **Talk through approach before coding.** No code until approach is agreed.
2. **One task = one edit.** Stay in scope.
3. **Show final clean code only.** No intermediate or transitional versions.
4. **No refactoring** unless explicitly asked.
5. **Root cause first.** Understand why before fixing.
6. **Don't modify working code** without understanding it.
7. **Incremental changes.** Test between each step.
8. **No explanations after edits.** Confirm what changed. Done.
9. **Ask before deviating.** Any change outside stated scope → ask first.

## When to Stop
- "This could be cleaner..." → Stop. Stick to the task.
- "While I'm here..." → Stop. One task at a time.
