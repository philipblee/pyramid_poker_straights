#!/usr/bin/env python3
"""
debuglog_timeline.py - merge Pyramid Poker remote debug logs into one readable timeline.

Usage:
    python debuglog_timeline.py EXPORT.json [--table 8] [--round 2] [--tz America/New_York] [--out timeline.txt]

EXPORT.json is the Firebase Realtime Database export of the debugLogs node
(Data tab -> debugLogs -> three-dot menu -> Export JSON).

It flattens every batch into single events, sorts them by server-corrected time across
all devices, prints a timeline per table and round, then lists anything suspicious.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

FAILURE_EVENT_MARKERS = ('Failed', 'windowError', 'unhandledRejection')
REPEAT_WATCH_STATES = ('dealing', 'hands_dealt', 'decide_playing', 'playing',
                       'all_submitted', 'scoring', 'round_complete')


def child_items(node):
    """RTDB exports turn numeric keys (rounds) into lists; handle both lists and dicts."""
    if node is None:
        return []
    if isinstance(node, list):
        return [(str(index), child) for index, child in enumerate(node) if child is not None]
    return [(str(key), child) for key, child in node.items()]


def parse_details(details_json):
    try:
        return json.loads(details_json) if details_json else {}
    except (TypeError, ValueError):
        return {'unparsed': str(details_json)[:200]}


def flatten_debug_logs(export_tree, table_filter, round_filter):
    """Return a list of event dicts from every batch in the export."""
    flattened_events = []
    for table_id, table_node in child_items(export_tree):
        if table_filter and table_id != table_filter:
            continue
        for round_folder, round_node in child_items(table_node):
            if round_filter is not None and round_folder != round_filter:
                continue
            for uid, uid_node in child_items(round_node):
                for batch_id, batch in child_items(uid_node):
                    try:
                        batch_entries = json.loads(batch.get('entriesJson', '[]'))
                    except ValueError:
                        continue
                    for log_entry in batch_entries:
                        flattened_events.append({
                            'table': table_id,
                            'round_folder': round_folder,
                            'uid': uid,
                            'player': batch.get('playerName', uid[:6]),
                            'is_owner': bool(batch.get('isOwner')),
                            'flush_reason': batch.get('flushReason', ''),
                            'dropped_before': batch.get('droppedBefore', 0),
                            'time_ms': log_entry.get('serverTimeMs') or log_entry.get('localTimeMs') or 0,
                            'event': log_entry.get('eventName', '?'),
                            'previous_state': log_entry.get('tableState'),
                            'details': parse_details(log_entry.get('detailsJson')),
                        })
    flattened_events.sort(key=lambda event: (event['time_ms'], event['player']))
    return flattened_events


def assign_sessions(events, gap_minutes):
    """Split each table's events into sessions wherever there is a long silence."""
    gap_ms = gap_minutes * 60 * 1000
    last_time_by_table = {}
    session_by_table = defaultdict(int)
    for event in events:
        table_id = event['table']
        last_time_ms = last_time_by_table.get(table_id)
        if last_time_ms is not None and event['time_ms'] - last_time_ms > gap_ms:
            session_by_table[table_id] += 1
        last_time_by_table[table_id] = event['time_ms']
        event['session'] = session_by_table[table_id] + 1
    return events


def summarize_event(event):
    """One short human-readable phrase for an event."""
    name, details = event['event'], event['details']
    if name == 'recvTableState':
        return f"RECV  {details.get('tableState')}"
    if name == 'wroteTableState':
        return f"WROTE {details.get('newState')}"
    if name == 'myHandAfterRetrieve':
        first_card = details.get('firstCard') or {}
        return (f"hand fetched: {details.get('cardCount')} cards, back={details.get('backLength')}, "
                f"first={first_card.get('id', first_card)}")
    if name == 'playingLocalIndex':
        return f"PLAYING localIndex={details.get('localIndex')}"
    if name in ('rtdbConnected',):
        return f"rtdb connected={details.get('connected')}"
    if name == 'visibility':
        return f"page {details.get('visibilityState')}"
    if details:
        compact = ', '.join(f"{key}={value}" for key, value in details.items())
        return f"{name}: {compact}"[:160]
    return name


def format_time(time_ms, time_zone):
    moment = datetime.fromtimestamp(time_ms / 1000, tz=time_zone)
    return moment.strftime('%H:%M:%S.') + f"{moment.microsecond // 1000:03d}"


def print_timeline(events, time_zone, write):
    grouped = defaultdict(list)
    for event in events:
        grouped[(event['table'], event['session'], event['round_folder'])].append(event)
    for (table_id, session_number, round_folder), round_events in sorted(
            grouped.items(), key=lambda item: (item[0][0], item[0][1], int(item[0][2]))):
        write(f"\n=== table {table_id} / session {session_number} / round {round_folder} " + '=' * 30)
        previous_time_ms = None
        for event in round_events:
            gap = '' if previous_time_ms is None else f"+{(event['time_ms'] - previous_time_ms) / 1000:5.2f}s"
            previous_time_ms = event['time_ms']
            owner_mark = '*' if event['is_owner'] else ' '
            write(f"{format_time(event['time_ms'], time_zone)} {gap:>9}  "
                  f"{owner_mark}{event['player'][:18]:<18}  {summarize_event(event)}")
    write("\n(* = table owner)")


def find_anomalies(events, time_zone):
    """Heuristic checks. Each finding is (severity, text). Logs may simply be unflushed, so verify."""
    findings = []
    by_player_round = defaultdict(list)
    players_by_round = defaultdict(set)
    for event in events:
        by_player_round[(event['table'], event['session'], event['round_folder'], event['player'])].append(event)
        players_by_round[(event['table'], event['session'], event['round_folder'])].add(event['player'])

    connected_once = set()
    for (table_id, session_number, round_folder, player), player_events in sorted(
            by_player_round.items(), key=lambda item: (item[0][0], item[0][1], int(item[0][2]), item[0][3])):
        where = f"table {table_id} session {session_number} round {round_folder} {player}"
        received_states = [e['details'].get('tableState') for e in player_events if e['event'] == 'recvTableState']
        event_names = {e['event'] for e in player_events}
        is_owner = any(e['is_owner'] for e in player_events)

        if 'scoring' in received_states and 'popupShown' not in event_names:
            findings.append(('PROBLEM', f"{where}: received 'scoring' but never logged popupShown"))
        if 'scoring' in received_states and 'proceedToScoringStart' not in event_names:
            findings.append(('PROBLEM', f"{where}: received 'scoring' but proceedToScoring never started"))
        if 'playing' in received_states and not is_owner and round_folder != '0' \
                and 'myHandAfterRetrieve' not in event_names:
            findings.append(('PROBLEM', f"{where}: reached 'playing' with no new-hand fetch logged"))

        for state_name, times_seen in Counter(received_states).items():
            if state_name in REPEAT_WATCH_STATES and times_seen > 1:
                findings.append(('NOTE', f"{where}: state '{state_name}' received {times_seen}x "
                                         f"(overlapping state chains?)"))

        for event in player_events:
            if any(marker in event['event'] for marker in FAILURE_EVENT_MARKERS):
                findings.append(('PROBLEM', f"{where} @ {format_time(event['time_ms'], time_zone)}: "
                                            f"{summarize_event(event)}"))
            if event['event'] == 'rtdbConnected' and event['details'].get('connected') is True:
                connected_once.add((table_id, session_number, player))
            if event['event'] == 'rtdbConnected' and event['details'].get('connected') is False \
                    and (table_id, session_number, player) in connected_once:
                findings.append(('WARN', f"{where} @ {format_time(event['time_ms'], time_zone)}: "
                                         f"database connection dropped"))
            if event['event'] == 'visibility' and event['details'].get('visibilityState') == 'hidden':
                findings.append(('WARN', f"{where} @ {format_time(event['time_ms'], time_zone)}: "
                                         f"page hidden/backgrounded (state was {event['previous_state']})"))
            if event.get('dropped_before'):
                findings.append(('WARN', f"{where}: {event['dropped_before']} log entries dropped before a batch"))

    for (table_id, session_number, round_folder), players_here in sorted(players_by_round.items()):
        next_round = str(int(round_folder) + 1)
        players_next = players_by_round.get((table_id, session_number, next_round))
        if players_next:
            for stuck_player in sorted(players_here - players_next):
                findings.append(('PROBLEM', f"table {table_id} session {session_number}: {stuck_player} logged "
                                            f"round {round_folder} but nothing in round {next_round} while others did"))
    return findings


def main():
    parser = argparse.ArgumentParser(description='Merge debugLogs export into one timeline')
    parser.add_argument('export_path')
    parser.add_argument('--table')
    parser.add_argument('--round', dest='round_number')
    parser.add_argument('--tz', default='America/New_York')
    parser.add_argument('--out')
    parser.add_argument('--gap-minutes', type=float, default=5,
                        help='silence longer than this starts a new session (default 5)')
    arguments = parser.parse_args()

    with open(arguments.export_path, encoding='utf-8') as export_file:
        export_tree = json.load(export_file)

    time_zone = ZoneInfo(arguments.tz)
    events = assign_sessions(flatten_debug_logs(export_tree, arguments.table, arguments.round_number),
                             arguments.gap_minutes)
    output_lines = []
    write = output_lines.append

    write(f"{len(events)} events from {len({e['player'] for e in events})} players")
    print_timeline(events, time_zone, write)

    write("\n=== CHECKS " + '=' * 50)
    findings = find_anomalies(events, time_zone)
    if not findings:
        write("nothing suspicious found")
    for severity, text in sorted(findings, key=lambda item: ('PROBLEM', 'WARN', 'NOTE').index(item[0])):
        write(f"[{severity}] {text}")
    write("\nNote: a missing event can also mean the batch was not flushed (tab killed). "
          "Confirm with the neighbouring events.")

    report_text = '\n'.join(output_lines)
    if arguments.out:
        with open(arguments.out, 'w', encoding='utf-8') as report_file:
            report_file.write(report_text + '\n')
    print(report_text)


if __name__ == '__main__':
    sys.exit(main())
