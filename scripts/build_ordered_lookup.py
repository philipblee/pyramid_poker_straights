"""Write a lookup whose rows stay in hand-rank order.

Each seat gets one win rate per hand type, the matchup-weighted average from
the measured file. A legal type the sample never dealt is placed evenly in the
gap beside its neighbors, at 1 when it sits above a perfect type, and at 0
when it sits below a type that never won. The range around an average stops
at the midpoint toward the next type. The stronger type keeps that edge.

Inside a type, every legal rank is a row, dealt or not. The rows step evenly
from the best rank to the worst. A straight runs royal, wheel, then downward.
"""

import csv
import sys
from collections import defaultdict

SCALE = 1_000_000

NAMES = {
    1: "High Card", 2: "Pair", 3: "Two Pair", 4: "Trips",
    5: "Flush", 6: "Straight", 7: "Full House", 8: "Quads",
    9: "Straight Flush", 10: "Five of a Kind", 11: "6-card SF",
    12: "Six of a Kind", 13: "7-card SF", 14: "Seven of a Kind",
    15: "8-card SF", 16: "Eight of a Kind",
}

# Strongest first. This repo: 5 is a flush, 6 is a straight.
LEGAL = {
    "front": [10, 9, 8, 7, 6, 5, 4, 2, 1],
    "middle": [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    "back": [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
}


def parse_tuple(text):
    inner = text.strip().strip('"').strip("()")
    return tuple(int(part.strip()) for part in inner.split(",") if part.strip())


def descending_top_two(min_high, lowest_second=2):
    rows = []
    for high in range(14, min_high - 1, -1):
        for second in range(high - 1, lowest_second - 1, -1):
            rows.append((high, second))
    return rows


def flush_ranks():
    """Two decks can put two cards of the same rank in one flush."""
    rows = []
    for high in range(14, 3, -1):
        for second in range(high, 2, -1):
            rows.append((high, second))
    return rows


def any_second(primary_first=True):
    rows = []
    for primary in range(14, 1, -1):
        for secondary in range(14, 1, -1):
            if secondary != primary:
                rows.append((primary, secondary))
    return rows


def two_pair_ranks():
    rows = []
    for high in range(14, 2, -1):
        for low in range(high - 1, 1, -1):
            rows.append((high, low))
    return rows


def straight_heights(length):
    """Royal, then the wheel, then the king-high sequence down to the bottom."""
    regular = []
    for high in range(14, length, -1):
        second = 13 if high == 14 else high - 1
        regular.append((high, second))
    wheel = (14, 5 if length == 5 else length)
    regular.insert(1, wheel)
    return regular


def rank_rows(hand_type, position):
    if hand_type in (6, 9):
        return straight_heights(5)
    if hand_type == 11:
        return straight_heights(6)
    if hand_type == 13:
        return straight_heights(7)
    if hand_type == 15:
        return straight_heights(8)
    if hand_type == 5:
        return flush_ranks()
    if hand_type == 1:
        return descending_top_two(4 if position == "front" else 6)
    if hand_type == 3:
        return two_pair_ranks()
    if hand_type in (2, 7, 8):
        return any_second()
    if hand_type == 4 and position == "front":
        return [(rank,) for rank in range(14, 1, -1)]
    if hand_type == 4:
        return any_second()
    if hand_type in (10, 12, 14, 16):
        return [(rank,) for rank in range(14, 1, -1)]
    raise SystemExit(f"no rows for type {hand_type} in {position}")


def load_measured(path):
    measured = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            tup = parse_tuple(row["hand_rank_tuple"])
            bucket = measured[row["position"].strip().lower()][tup[0]]
            bucket[0] += int(row["wins"])
            bucket[1] += int(row["total_matchups"])
    return measured


def isotonic_centers(position, measured):
    present = []
    for hand_type in LEGAL[position]:
        wins, total = measured[position][hand_type]
        if total:
            present.append((hand_type, wins, total))
    blocks = []
    for hand_type, wins, total in present:
        blocks.append({"types": [hand_type], "wins": wins, "total": total})
        while len(blocks) >= 2:
            stronger, weaker = blocks[-2], blocks[-1]
            if weaker["wins"] / weaker["total"] > stronger["wins"] / stronger["total"] + 1e-15:
                stronger["types"].extend(weaker["types"])
                stronger["wins"] += weaker["wins"]
                stronger["total"] += weaker["total"]
                blocks.pop()
            else:
                break
    centers = {}
    for block in blocks:
        center = block["wins"] / block["total"]
        for hand_type in block["types"]:
            centers[hand_type] = center
    return centers


def fill_missing(position, centers):
    legal = LEGAL[position]
    filled = dict(centers)

    def place_gap(stronger_center, weaker_center, missing):
        span = stronger_center - weaker_center
        count = len(missing)
        for index, hand_type in enumerate(missing):
            filled[hand_type] = stronger_center - span * (index + 1) / (count + 1)

    index = 0
    while index < len(legal):
        if legal[index] in filled:
            index += 1
            continue
        start = index
        while index < len(legal) and legal[index] not in filled:
            index += 1
        missing = legal[start:index]
        stronger = filled[legal[start - 1]] if start > 0 else None
        weaker = filled[legal[index]] if index < len(legal) else None
        if stronger is None and weaker is None:
            raise SystemExit(f"{position} has no measured hands")
        if stronger is None:
            if weaker >= 1 - 1e-12:
                for hand_type in missing:
                    filled[hand_type] = 1.0
            else:
                # Strongest missing type stays nearest the ceiling.
                span = 1.0 - weaker
                for offset, hand_type in enumerate(missing):
                    filled[hand_type] = 1.0 - span * (offset + 1) / (len(missing) + 1)
        elif weaker is None:
            if stronger <= 1e-12:
                for hand_type in missing:
                    filled[hand_type] = 0.0
            else:
                span = stronger - 0.0
                for offset, hand_type in enumerate(missing):
                    filled[hand_type] = stronger - span * (offset + 1) / (len(missing) + 1)
        else:
            place_gap(stronger, weaker, missing)
    return filled


def band(center, stronger_center, weaker_center):
    gap_up = (1.0 - center) if stronger_center is None else (stronger_center - center)
    gap_down = center if weaker_center is None else (center - weaker_center)
    half = min(max(gap_up, 0.0), max(gap_down, 0.0)) / 2
    return max(0.0, center - half), min(1.0, center + half)


def spread(top, bottom, count, floor):
    top = min(1.0, max(0.0, top))
    bottom = min(top, max(0.0, bottom))
    if count == 1:
        value = (top + bottom) / 2
        if floor is not None and value > floor:
            value = floor
        return [value]
    if floor is not None and top >= floor - 1e-15 and floor < 1 - 1e-12 and bottom < floor:
        step = (min(top, floor) - bottom) / count
        if step <= 0:
            return [min(floor, top)] * count
        return [min(top, floor) - step * (index + 1) for index in range(count)]
    step = (top - bottom) / (count - 1)
    return [top - step * index for index in range(count)]


def build_position(position, centers):
    legal = LEGAL[position]
    rows = []
    floor = None
    print(f"\n=== {position} ===")
    for index, hand_type in enumerate(legal):
        stronger = centers[legal[index - 1]] if index else None
        weaker = centers[legal[index + 1]] if index + 1 < len(legal) else None
        bottom, top = band(centers[hand_type], stronger, weaker)
        keys = rank_rows(hand_type, position)
        values = spread(top, bottom, len(keys), floor)
        for key, value in zip(keys, values):
            rows.append({"position": position, "tuple": (hand_type, *key), "rate": value})
        floor = min(values)
        print(
            f"  {hand_type:2d} {NAMES[hand_type]:16} "
            f"center={centers[hand_type]:.4f}  {min(values):.4f} .. {max(values):.4f}  rows={len(keys)}"
        )
    return rows


def enforce_order(rows):
    rows.sort(key=lambda row: row["tuple"], reverse=True)
    repairs = 0
    floor = None
    for row in rows:
        wins = int(round(row["rate"] * SCALE))
        if floor is not None and wins > floor:
            wins = floor
            repairs += 1
        row["wins"] = wins
        row["rate"] = wins / SCALE
        floor = wins
    return repairs


def lookup_hit(rows, position, full_tuple):
    keys = {(row["tuple"]) for row in rows if row["position"] == position}
    for length in range(len(full_tuple), 0, -1):
        prefix = full_tuple[:length]
        if prefix in keys:
            return prefix
    return None


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["position", "hand_rank_tuple", "wins", "total_matchups", "win_rate"])
        for row in rows:
            tuple_text = "(" + ", ".join(str(part) for part in row["tuple"]) + ")"
            writer.writerow([row["position"], tuple_text, row["wins"], SCALE, f"{row['rate']:.10f}"])


def main():
    source = sys.argv[1]
    destination = sys.argv[2]
    measured = load_measured(source)
    rows = []
    for position in ("front", "middle", "back"):
        centers = fill_missing(position, isotonic_centers(position, measured))
        built = build_position(position, centers)
        repairs = enforce_order(built)
        print(f"  rounding repairs {repairs}")
        rows.extend(built)

    probes = [
        ("front", (6, 14, 13, 1, 1, 1, 1, 4), (6, 14, 13)),
        ("front", (6, 14, 5, 4, 3, 2, 1), (6, 14, 5)),
        ("front", (5, 14, 13, 12, 11, 10, 1), (5, 14, 13)),
        ("front", (4, 14, 1, 2, 3), (4, 14)),
        ("middle", (11, 14, 6, 1), (11, 14, 6)),
        ("back", (15, 14, 8, 1), (15, 14, 8)),
        ("back", (3, 14, 13, 12, 1, 1, 1, 1), (3, 14, 13)),
    ]
    for position, full_tuple, expected in probes:
        hit = lookup_hit(rows, position, full_tuple)
        if hit != expected:
            raise SystemExit(f"{position} {full_tuple} hit {hit}, expected {expected}")

    write_csv(destination, rows)
    print(f"\nWrote {len(rows)} rows to {destination}")


if __name__ == "__main__":
    main()
