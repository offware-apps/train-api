"""Find the trains a pass holder can take between two stations on one day.

Python 3.8+, standard library only.

    python3 examples/search.py sncf max-jeune paris-intramuros lyon-intramuros 2026-10-20

Set TRAIN_API to use a mirror or a local build (e.g. http://localhost:8000/v1).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("TRAIN_API", "https://offware-apps.github.io/train-api/v1")


def decode_compact(c):
    """Expand a compact snapshot to one row per train per date (same as src/compact.ts)."""
    rows = []
    for o, d, depart, arrive, train_no, axe, mask in (t[:7] for t in c["trains"]):
        for j, digit in enumerate(mask):
            n = int(digit, 16)
            for b in range(4):
                i = j * 4 + b
                if not n & (1 << b) or i >= len(c["dates"]):
                    continue
                row = {
                    "date": c["dates"][i],
                    "origin": c["stations"][o],
                    "destination": c["stations"][d],
                    "depart": depart,
                    "arrive": arrive,
                    "trainNo": train_no,
                }
                if axe >= 0:
                    row["category"] = c["axes"][axe]
                rows.append(row)
    return rows


def get_json(path):
    with urllib.request.urlopen(f"{BASE}/{path}") as res:
        return json.load(res)


def search(operator, pass_id, from_id, to_id, date):
    stations = get_json(f"{operator}/stations.json")
    to = next((s for s in stations if s["id"] == to_id), None)
    if to is None:
        raise SystemExit(f'no station "{to_id}" for {operator}; see {BASE}/{operator}/stations.json')
    try:
        snapshot = get_json(f"{operator}/{pass_id}/from/{from_id}.json")
    except urllib.error.HTTPError as e:
        if e.code == 404:  # no bookable train leaves this station for this pass
            return []
        raise
    trains = [t for t in decode_compact(snapshot) if t["destination"] == to["name"] and t["date"] == date]
    return sorted(trains, key=lambda t: t["depart"])


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit("usage: python3 examples/search.py <operator> <pass> <fromId> <toId> <YYYY-MM-DD>")
    trains = search(*sys.argv[1:])
    if not trains:
        print("No bookable train.")
    for t in trains:
        print(f'{t["depart"]} → {t["arrive"]}  {t["trainNo"]}  {t["origin"]} → {t["destination"]}')
