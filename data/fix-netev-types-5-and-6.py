#!/usr/bin/env python3
"""
Build this repo's netEV table from the online table's tuple grid.

The online file has one row per hand type, rank, and kicker. It also uses the
old numbering, where 5 is a straight and 6 is a flush. This game (evaluate-hand.js)
uses 5 for a flush and 6 for a straight. Each online tuple is kept once. Rows
whose type is 5 or 6 swap numbers, and their netEV is placed between three of
a kind and a full house at the same rank: flush one third of the way, straight
two thirds. Every other hand type keeps the online netEV.

The online file writes each tuple twice. Those duplicate lines are not copied.
"""

import csv
import re
from pathlib import Path

ONLINE_PATH = Path(r'F:\Dropbox\PycharmProjects\pyramid_poker_online\data\netEV_lookup_table.csv')
OUT_PATH = Path(__file__).with_name('netEV_lookup_table.csv')

# Same payout for flush and straight. hand-utilities.js
POINTS = {'front': 4, 'middle': 1, 'back': 1}


def parse_tuple(text):
    return tuple(int(part) for part in re.findall(r'\d+', text))


def loss_penalty(position):
    """ScoringUtilities netEV fallback. Types 5 and 6 are in these bands."""
    if position == 'front':
        return 1
    if position == 'middle':
        return 2
    return 6


def nearest_rank(table, rank):
    if rank in table:
        return table[rank]
    return table[min(table, key=lambda existing: abs(existing - rank))]


def load_online():
    unique = {}
    with ONLINE_PATH.open(newline='', encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            position = row['position'].strip()
            tup = parse_tuple(row['hand_rank_tuple'])
            unique[(position, tup)] = {
                'position': position,
                'tuple': tup,
                'wins': row['wins'],
                'total': row['total_matchups'],
                'netev': float(row['netev']),
            }
    return list(unique.values())


def index_neighbors(rows):
    trips = {}
    houses = {}
    houses_by_rank = {}
    for row in rows:
        position, tup, netev = row['position'], row['tuple'], row['netev']
        if tup[0] == 4 and len(tup) >= 2:
            trips[(position, tup[1])] = netev
        elif tup[0] == 7 and len(tup) >= 3:
            houses[(position, tup[1], tup[2])] = netev
            houses_by_rank.setdefault((position, tup[1]), []).append(netev)
    return trips, houses, houses_by_rank


def between_neighbors(position, primary, secondary, share, trips, houses, houses_by_rank):
    trip_table = {rank: value for (pos, rank), value in trips.items() if pos == position}
    low = nearest_rank(trip_table, primary)
    if (position, primary, secondary) in houses:
        high = houses[(position, primary, secondary)]
    else:
        ranked = {rank: sum(values) / len(values)
                  for (pos, rank), values in houses_by_rank.items() if pos == position}
        high = nearest_rank(ranked, primary)
    return low + (high - low) * share


def wins_for_netev(position, netev):
    points = POINTS[position]
    penalty = loss_penalty(position)
    rate = (netev + penalty) / (points + penalty)
    rate = min(1.0, max(0.0, rate))
    return str(round(rate * 1000)), '1000'


def main():
    rows = load_online()
    trips, houses, houses_by_rank = index_neighbors(rows)

    written = []
    swapped = 0
    for row in rows:
        tup = row['tuple']
        hand_type = tup[0]
        if hand_type == 5:
            hand_type = 6
            share = 2 / 3
        elif hand_type == 6:
            hand_type = 5
            share = 1 / 3
        else:
            hand_type = tup[0]
            share = None

        if share is None:
            netev = row['netev']
            wins, total = row['wins'], row['total']
        else:
            swapped += 1
            netev = between_neighbors(
                row['position'], tup[1], tup[2], share, trips, houses, houses_by_rank
            )
            wins, total = wins_for_netev(row['position'], netev)

        new_tuple = (hand_type,) + tup[1:]
        written.append({
            'position': row['position'],
            'hand_rank_tuple': f'({", ".join(str(part) for part in new_tuple)})',
            'wins': wins,
            'total_matchups': total,
            'netev': f'{netev:.6f}',
            '_sort': (row['position'], new_tuple),
        })

    position_order = {'front': 0, 'middle': 1, 'back': 2}
    written.sort(key=lambda row: (
        position_order[row['_sort'][0]],
        -row['_sort'][1][0],
        -row['_sort'][1][1],
        -(row['_sort'][1][2] if len(row['_sort'][1]) > 2 else 0),
    ))

    with OUT_PATH.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=['position', 'hand_rank_tuple', 'wins', 'total_matchups', 'netev'],
            lineterminator='\n',
        )
        writer.writeheader()
        for row in written:
            row.pop('_sort')
            writer.writerow(row)

    print(f'Unique online tuples: {len(rows)}')
    print(f'Rewrote {swapped} flush/straight rows')
    print(f'Wrote {len(written)} rows to {OUT_PATH}')


if __name__ == '__main__':
    main()
