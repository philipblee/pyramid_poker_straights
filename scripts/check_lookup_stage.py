"""Checks for the lookup rebuild. One stage per run."""

import csv
import sys
from pathlib import Path


POINTS = {
    "front": {1: 1, 2: 1, 4: 3, 5: 4, 6: 4, 7: 5, 8: 12, 9: 15, 10: 18},
    "middle": {
        1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 8, 9: 10,
        10: 12, 11: 16, 12: 20, 13: 22, 14: 28,
    },
    "back": {
        1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 4, 9: 5,
        10: 6, 11: 8, 12: 10, 13: 11, 14: 14, 15: 14, 16: 18,
    },
}


def points_for(position, hand_type):
    return POINTS[position].get(hand_type, 1)


def loss_penalty(position, hand_type):
    if position == "front":
        return 1 if hand_type >= 3 else 2
    if position == "middle":
        return 2 if hand_type >= 5 else 4
    return 4 if hand_type >= 7 else 6


def netev(position, hand_type, win_rate):
    payout = points_for(position, hand_type)
    penalty = loss_penalty(position, hand_type)
    return (win_rate * payout) - ((1 - win_rate) * penalty)


def parse_tuple(text):
    return tuple(int(part) for part in text.replace("(", " ").replace(")", " ").replace('"', " ").split(",") if part.strip())


def load_rows(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def weighted_rate(rows):
    wins = sum(int(row["wins"]) for row in rows)
    total = sum(int(row["total_matchups"]) for row in rows)
    return wins / total if total else None


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def check_type_order(rows, label):
    require(len(rows) not in (1978, 429), f"{label} row count {len(rows)} is an old shortcut file")
    lengths = {len(parse_tuple(row["hand_rank_tuple"])) for row in rows}
    require(max(lengths) > 2, f"{label} is two numbers only")
    for position in ("front", "middle", "back"):
        straights = [row for row in rows if row["position"] == position and parse_tuple(row["hand_rank_tuple"])[0] == 6]
        flushes = [row for row in rows if row["position"] == position and parse_tuple(row["hand_rank_tuple"])[0] == 5]
        require(straights and flushes, f"{label} missing type 5 or 6 in {position}")
        straight_rate = weighted_rate(straights)
        flush_rate = weighted_rate(flushes)
        require(straight_rate > flush_rate, f"{label} {position} straight {straight_rate} does not beat flush {flush_rate}")
        print(f"{label} {position}: straight {straight_rate:.4f} > flush {flush_rate:.4f}")
    print(f"{label} rows {len(rows)}, longest tuple {max(lengths)}")


def check_empirical(path):
    rows = load_rows(path)
    require(len(rows) == 21032, f"empirical rows {len(rows)}, expected 21032")
    check_type_order(rows, "empirical")


def check_tiered(path):
    rows = load_rows(path)
    check_type_order(rows, "tiered")


def check_tiered2(path):
    rows = load_rows(path)
    check_type_order(rows, "tiered2")
    front_straight_flush = [
        row for row in rows
        if row["position"] == "front" and parse_tuple(row["hand_rank_tuple"])[0] == 9
    ]
    require(front_straight_flush, "tiered2 has no front straight flush rows")
    print(f"tiered2 front straight flushes {len(front_straight_flush)}")


def weighted_netev(rows):
    total = sum(int(row["total_matchups"]) for row in rows)
    require(total > 0, "empty group")
    return sum(float(row["netev"]) * int(row["total_matchups"]) for row in rows) / total


def check_netev(path):
    rows = load_rows(path)
    require("netev" in rows[0], "netev column missing")
    for row in rows:
        hand = parse_tuple(row["hand_rank_tuple"])
        expected = netev(row["position"], hand[0], int(row["wins"]) / int(row["total_matchups"]))
        require(abs(expected - float(row["netev"])) < 1e-5, f"formula mismatch {row}")
    ace_straight = [
        row for row in rows
        if row["position"] == "front" and parse_tuple(row["hand_rank_tuple"])[:3] == (6, 14, 13)
    ]
    ace_flush = [
        row for row in rows
        if row["position"] == "front" and parse_tuple(row["hand_rank_tuple"])[:2] == (5, 14)
    ]
    trips = [
        row for row in rows
        if row["position"] == "front" and parse_tuple(row["hand_rank_tuple"])[0] == 4
    ]
    require(ace_straight and ace_flush and trips, "missing ace-high straight, ace-high flush, or trips")
    straight_ev = weighted_netev(ace_straight)
    flush_ev = weighted_netev(ace_flush)
    trips_ev = weighted_netev(trips)
    print(f"front ace straight {straight_ev:.4f}, ace flush {flush_ev:.4f}, trips {trips_ev:.4f}")
    require(straight_ev > flush_ev > trips_ev, "ace-high straight, ace-high flush, and trips are out of order")
    require(abs(flush_ev - 1.65) > 0.05 and abs(straight_ev - 3.28) > 0.05, "values match the old interpolated stand-in")
    print(f"netEV rows {len(rows)}")


def main():
    stage = sys.argv[1]
    path = sys.argv[2]
    if stage == "empirical":
        check_empirical(path)
    elif stage == "tiered":
        check_tiered(path)
    elif stage == "tiered2":
        check_tiered2(path)
    elif stage == "netev":
        check_netev(path)
    else:
        raise SystemExit(f"Unknown stage {stage}")
    print(f"{stage} check passed")


if __name__ == "__main__":
    main()
