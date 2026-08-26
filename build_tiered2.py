#!/usr/bin/env python3
"""
Build tiered2_win_probability.csv from hand_tuple_lookup.csv

Aggregates real empirical win/loss counts at 3-element and 2-element
tuple prefixes (matching the truncation levels lookupTiered2WinProbability
tries in JS), so the fallback ladder always has real data to hit.

No fabricated/interpolated values - purely aggregation of real matchup counts.
"""

import csv
import re
from collections import defaultdict

INPUT_FILE = 'hand_tuple_lookup.csv'
OUTPUT_FILE = 'tiered2_win_probability.csv'
MIN_MATCHUPS = 20  # rows below this threshold are dropped; fallback ladder covers them


def parse_tuple(tuple_str):
    """Parse '(6, 14, 5, 4, 4, 3, 2, 1)' -> [6, 14, 5, 4, 4, 3, 2, 1]"""
    inner = tuple_str.strip().strip('"').strip('()')
    return [int(x.strip()) for x in inner.split(',') if x.strip()]


def load_rows(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            position = row['position'].strip().lower()
            tup = parse_tuple(row['hand_rank_tuple'])
            wins = int(row['wins'])
            total = int(row['total_matchups'])
            rows.append((position, tup, wins, total))
    return rows


def aggregate_by_prefix(rows, prefix_len):
    """Sum wins/total for all rows truncated to prefix_len, grouped by (position, prefix)."""
    agg = defaultdict(lambda: [0, 0])  # (position, prefix_tuple) -> [wins, total]
    for position, tup, wins, total in rows:
        if len(tup) < prefix_len:
            continue  # can't truncate shorter tuples (e.g. 2-elem source can't give a 3-elem prefix)
        prefix = tuple(tup[:prefix_len])
        agg[(position, prefix)][0] += wins
        agg[(position, prefix)][1] += total
    return agg


def main():
    rows = load_rows(INPUT_FILE)
    print(f'Loaded {len(rows)} raw rows from {INPUT_FILE}')

    # Aggregate at 3-element and 2-element prefix levels
    agg3 = aggregate_by_prefix(rows, 3)
    agg2 = aggregate_by_prefix(rows, 2)

    output_rows = []

    # Prefer 3-element rows where sample size is sufficient
    for (position, prefix), (wins, total) in agg3.items():
        if total >= MIN_MATCHUPS:
            win_rate = wins / total
            output_rows.append((position, prefix, wins, total, win_rate))

    # Add 2-element rows (always useful as a coarser fallback level)
    for (position, prefix), (wins, total) in agg2.items():
        if total >= MIN_MATCHUPS:
            win_rate = wins / total
            output_rows.append((position, prefix, wins, total, win_rate))

    # Sort for readability: position, then hand type, then rank desc
    output_rows.sort(key=lambda r: (r[0], r[1][0], -r[1][1] if len(r[1]) > 1 else 0))

    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['position', 'hand_rank_tuple', 'wins', 'total_matchups', 'win_rate'])
        for position, prefix, wins, total, win_rate in output_rows:
            tuple_str = f'({", ".join(str(x) for x in prefix)})'
            writer.writerow([position, tuple_str, wins, total, f'{win_rate:.6f}'])

    print(f'Wrote {len(output_rows)} rows to {OUTPUT_FILE}')

    # Summary by position/length
    summary = defaultdict(int)
    for position, prefix, *_ in output_rows:
        summary[(position, len(prefix))] += 1
    print('\nRows by position and tuple length:')
    for (position, length), count in sorted(summary.items()):
        print(f'  {position} ({length}-element): {count}')


if __name__ == '__main__':
    main()
