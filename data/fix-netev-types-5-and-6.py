#!/usr/bin/env python3
"""
Rewrite netEV rows for hand types 5 and 6.

This game (evaluate-hand.js): 5 = Flush, 6 = Straight.
The original tuple generator still uses the old numbering (5 = Straight, 6 = Flush)
and is left unchanged.

For each position and rank, the new win rate sits between the surrounding
hand types already in the table: three of a kind (4) and full house (7).
Flush takes one third of that gap. Straight takes two thirds, so a straight
stays ahead of a flush. NetEV is then points * win rate minus the loss penalty.

Flush highs are 6 through ace. Straight highs are 5 through ace.
"""

import csv
import re
from pathlib import Path

CSV_PATH = Path(__file__).with_name('netEV_lookup_table.csv')

# hand-utilities.js point values. Types 5 and 6 are worth the same points;
# the straight ranks higher because its hand-type number is 6.
POINTS = {
    'front': {5: 4, 6: 4},
    'middle': {5: 1, 6: 1},
    'back': {5: 1, 6: 1},
}

FLUSH_RANKS = list(range(14, 5, -1))      # 14 down to 6
STRAIGHT_RANKS = list(range(14, 4, -1))    # 14 down to 5
POSITIONS = ('back', 'front', 'middle')


def parse_tuple(text):
    return tuple(int(part) for part in re.findall(r'\d+', text))


def loss_penalty(position, hand_type):
    """Same thresholds as ScoringUtilities.getExpectedPoints netEV fallback."""
    if position == 'front':
        return 1 if hand_type >= 3 else 2
    if position == 'middle':
        return 2 if hand_type >= 5 else 4
    return 4 if hand_type >= 7 else 6


def netev_from_wins(position, hand_type, wins, total):
    win_rate = wins / total
    points = POINTS[position][hand_type]
    penalty = loss_penalty(position, hand_type)
    return (win_rate * points) - ((1 - win_rate) * penalty)


def nearest(by_rank, rank):
    if rank in by_rank:
        return by_rank[rank]
    return by_rank[min(by_rank, key=lambda existing: abs(existing - rank))]


def interpolated_wins(low_row, high_row, share):
    low_wins, low_total = low_row
    high_wins, high_total = high_row
    low_rate = low_wins / low_total
    high_rate = high_wins / high_total
    total = low_total
    wins = round((low_rate + (high_rate - low_rate) * share) * total)
    return max(0, min(total, wins)), total


def main():
    with CSV_PATH.open(newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames
        kept = []
        neighbors = {4: {}, 7: {}}
        removed = 0
        for row in reader:
            tup = parse_tuple(row['hand_rank_tuple'])
            hand_type = tup[0]
            if hand_type in (5, 6):
                removed += 1
                continue
            kept.append(row)
            if hand_type in (4, 7) and len(tup) >= 2:
                neighbors[hand_type][(row['position'].strip(), tup[1])] = (
                    int(row['wins']),
                    int(row['total_matchups']),
                )

    added = []
    for position in POSITIONS:
        for hand_type, ranks, share in (
            (5, FLUSH_RANKS, 1 / 3),
            (6, STRAIGHT_RANKS, 2 / 3),
        ):
            for rank in ranks:
                low = nearest(dict_for(neighbors[4], position), rank)
                high = nearest(dict_for(neighbors[7], position), rank)
                wins, total = interpolated_wins(low, high, share)
                netev = netev_from_wins(position, hand_type, wins, total)
                added.append({
                    'position': position,
                    'hand_rank_tuple': f'({hand_type}, {rank})',
                    'wins': str(wins),
                    'total_matchups': str(total),
                    'netev': f'{netev:.6f}',
                })

    position_order = {name: index for index, name in enumerate(POSITIONS)}
    rows = kept + added

    def sort_key(row):
        tup = parse_tuple(row['hand_rank_tuple'])
        primary = tup[1] if len(tup) > 1 else 0
        return (position_order.get(row['position'].strip(), 9), tup[0], -primary)

    rows.sort(key=sort_key)

    with CSV_PATH.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f'Removed {removed} type 5/6 rows')
    print(f'Added {len(added)} rows ({len(FLUSH_RANKS)} flush and {len(STRAIGHT_RANKS)} straight per position)')
    print(f'Wrote {len(rows)} rows to {CSV_PATH}')


def dict_for(table, position):
    return {rank: value for (pos, rank), value in table.items() if pos == position}


if __name__ == '__main__':
    main()
