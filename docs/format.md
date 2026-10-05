# Open train format (v1)

Every operator maps its own data to this one shape (`src/format.ts`). The API then
publishes it per pass in the compact snapshot format (`src/compact.ts`).

## Train

| Field | Type | Meaning |
|-------|------|---------|
| `operator` | string | `sncf` for now |
| `date` | `YYYY-MM-DD` | departure date |
| `origin`, `destination` | string | station names exactly as the operator publishes them |
| `depart`, `arrive` | `HH:MM` | local time; an arrival before the departure is the next day |
| `trainNo` | string | train number |
| `category` | string, optional | line or train family (SNCF: the `axe`) |
| `passes` | object | per pass: `{ bookable, seat }` |

`seat` is `free` or `full` when the data says so, and `unknown` when no open data does.

The SNCF feed has one MAX flag for both MAX passes (they share one quota), so `max-jeune`
and `max-senior` differ only by MAX SENIOR's own rules. Its weekday rule is applied; its
off-peak limits (Friday afternoon and evening, Monday morning, eves of holidays) are not in
the data, so `index.json` carries them as the pass's `note`. Interrail's `note` carries
its residence rule, which no timetable can check.

## Passes

| Pass | Bookable when | Seat |
|------|---------------|------|
| `max-jeune` | SNCF marks a free MAX seat (`od_happy_card = OUI`), domestic stops only | known |
| `max-senior` | as `max-jeune`, and the date is a weekday | known |
| `interrail` | the train runs: every TGV INOUI, Intercités, night and international train takes a pass-holder reservation | unknown |

## Compact snapshot

Most of a 30-day timetable is the same service repeated every day, so each distinct
service is stored once with a bitmask of the dates it runs:

```json
{ "v": 1,
  "dates": ["2026-10-05", "..."],
  "stations": ["PARIS (intramuros)", "..."],
  "axes": ["SUD EST", "..."],
  "trains": [[originIdx, destIdx, "08:00", "10:00", "6601", axeIdx or -1, "dateMask"]] }
```

`dateMask` is hex; hex digit `j` holds dates `4j..4j+3`, low bit first. `decodeCompact`
in `src/compact.ts` expands it back to one row per train per date (the file has no
imports, so clients can copy it).

## Endpoints

All static files under `/v1/`:

| Path | Content |
|------|---------|
| `index.json` | freshness, dates covered, and each pass with its `seatKnown`, `bookingUrl`, `note`, `trainCount` |
| `<operator>/stations.json` | `[{ id, name }]`; `id` is the URL slug used below |
| `<operator>/<pass>/all.json` | every bookable train for the pass (compact) |
| `<operator>/<pass>/from/<id>.json` | the bookable trains leaving one station (compact) |

A search by origin, destination and date fetches `from/<origin>.json` and filters it.
