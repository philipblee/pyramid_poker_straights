# Lookup rebuild plan

Execution plan for the next chat. Do not start a later step until the previous step's check passes. No game behavior changes except the one netEV objective switch in step 5.

## Rules this plan uses

`evaluate-hand.js` in this repo: type 5 is a flush, type 6 is a straight. A straight outranks a flush. The payout is the same on purpose (`js/hands/hand-utilities.js`): front 4, middle 1, back 1. The comments in that file still say type 5 is a straight and type 6 is a flush. Leave the numbers alone. Both types pay the same, and both sit in the same loss-penalty band.

A hand's expected points are its win probability times that payout. The August sample already gives a straight the higher win rate, so a straight is worth more expected points than a flush before any new deal. Front example from that sample: straight about 0.905 times 4, flush about 0.714 times 4.

60,000 hands means 10,000 rounds, 6 players, 2 wilds in the deck. That is the shape of the August run.

## Do not use

- `pyramid_poker_analysis/scripts/tuple_generator_from_netEV_data.py`. Do not edit it.
- `pyramid_poker_analysis/scripts/tuple_generator_from_tiered_data.py`. It still uses the old numbering and fills ranges by formula.
- `build_tiered2.py` in this repo. Collapsing and filling is the 2026 shortcut. Steps 3, 4, and 5 are new dealt rounds.
- The current `data/netEV_lookup_table.csv` as an input. It is the interpolated online table. Step 5 replaces it.
- The current `data/tiered_win_probability.csv` and `data/tiered2_win_probability.csv` as inputs. Tiered is the old online numbering. Tiered2 is the aggregated shortcut.

## Step 1. Empirical table is the August file

Source, 21,032 data rows:

`F:\Dropbox\PycharmProjects\pyramid_poker_analysis\date 2026-08-25\hand_tuple_lookup.csv`

Columns already match the loader: `position`, `hand_rank_tuple`, `wins`, `total_matchups`, `win_rate`. Numbering is already this game's: a flush tuple starts with 5, a straight tuple starts with 6. Straights are stored as the full tuple. Flushes, pairs, trips, full houses, and four of a kind are three numbers. `lookupEmpiricalWinProbability` walks from the full tuple down to one number, so those rows are usable as they are.

Before replacing anything, copy the current `data/empirical_win_probability.csv` aside. It is the July 17, 2025 file, where a flush wins more often than a straight. Then copy the August file onto `data/empirical_win_probability.csv`.

Check: a front straight still wins more often than a front flush. The August hand-type summary is in `date 2026-08-25\win_probabilities_by_hand_type.csv` (front straight 0.905, front flush 0.714).

## How every later run is dealt

`PlayHandStats.playHandStats(6, 2)` is the dealer used for the August JSON. It calls `findBestSetup` with top-arrangement collection off. There is no 10,000-round runner in the repo. The next chat adds a loop that keeps those settings, plays 10,000 rounds, and writes one JSON array in the same shape as `pyramid_poker_analysis\data\pyramid-poker-straights-10000-rounds.json`: `metadata`, `players`, `scoringMatrix`, `summary`.

The search reads `gameConfig.config.winProbabilityMethod`. Set that string exactly. The default in `js/core/game-config.js` is `'tiered2 '` with a trailing space. That space misses every switch, and the win rate becomes 0.5.

`getExpectedPoints(hand, cards, position, playerCount, method)` is called with the method string in the playerCount slot. The method argument stays empty, so the config string is what actually selects the objective. Set the config. Do not rely on the fourth argument.

After each JSON exists, point `pyramid_poker_analysis\scripts\win_probability_analysis.py` at it and export `hand_tuple_lookup.csv`. That script currently writes to `date 2025-08-25` and reads the August JSON. Change those two paths for the stage being exported. Keep the class that truncates flushes to three numbers and leaves straights whole.

Save each stage's JSON and lookup under `pyramid_poker_analysis`, in its own folder. Copy only the finished lookup into this repo's `data\` folder.

## Step 2. Deal again, arranging by expected points

Set `winProbabilityMethod` to `empirical`.

Expected points are `lookupEmpiricalWinProbability` times the seat points. Load `data/empirical_win_probability.csv` before the first round. A missing lookup returns null, and null times points is 0, so confirm a known front straight and front flush resolve before the batch.

Play 10,000 rounds. Export the lookup.

## Step 3. That lookup is tiered

Copy the step 2 `hand_tuple_lookup.csv` to `data/tiered_win_probability.csv`.

This file is the measured win rates under expected-points arrangements. It replaces the online 1,978-row tiered file. It is not a smoothed grid.

Check: type 6 still beats type 5 in each seat, and the row count is a full tuple lookup, not 1,978 fabricated rows.

## Step 4. Deal again, arranging by tiered

Set `winProbabilityMethod` to `tiered`. Load the new tiered file. Play 10,000 rounds. Export the lookup. Copy it to `data/tiered2_win_probability.csv`.

This replaces the 429-row shortcut file. Do not prefix-aggregate and do not invent 0.0001 rows.

Check: same numbering check as step 3. Front straight flushes that were dealt have rows. A two-number-only file means this step was skipped.

## Step 5. Deal again, arranging by the netEV formula

The current netEV branch looks up `data/netEV_lookup_table.csv` first and, on a miss, calls `.toFixed` on a tiered2 probability that may be null. Do not use that path for this run.

For this batch only, the arrangement score is the formula, with the win rate taken from the tiered2 table just built:

```
netEV = (p * points) - ((1 - p) * lossPenalty)
```

`p` is `lookupTiered2WinProbability`. `points` come from `hand-utilities.js`. `lossPenalty` is the one already in `ScoringUtilities.getExpectedPoints`:

- front: 1 when the hand type is 3 or higher, otherwise 2
- middle: 2 when the hand type is 5 or higher, otherwise 4
- back: 4 when the hand type is 7 or higher, otherwise 6

Flush and straight share a payout and a penalty, so the straight scores higher only because its tiered2 win rate is higher.

Play 10,000 rounds under that objective. Export the win-rate lookup. Write `data/netEV_lookup_table.csv` by applying the same formula to those new win rates. Columns: `position`, `hand_rank_tuple`, `wins`, `total_matchups`, `netev`.

Check: an ace-high front straight has a higher netEV than an ace-high front flush, and both sit above three of a kind from this run. Do not copy the old interpolated values (front flush about 1.65, front straight about 3.28). Those were a stand-in.

## Done when

- `data/empirical_win_probability.csv` is the August 21,032-row file.
- `data/tiered_win_probability.csv` is the expected-points recount.
- `data/tiered2_win_probability.csv` is the tiered recount.
- `data/netEV_lookup_table.csv` is the formula applied to the tiered2 recount.
- Each `data\` file has a matching JSON and `hand_tuple_lookup.csv` kept in `pyramid_poker_analysis`.
- Type 5 is a flush and type 6 is a straight in every new file.
