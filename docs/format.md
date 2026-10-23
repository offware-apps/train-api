# Open train format (v1)

Every operator maps its own data to this one shape (`src/format.ts`). The API then
publishes it per pass in the compact snapshot format (`src/compact.ts`).

## Train

| Field | Type | Meaning |
|-------|------|---------|
| `operator` | string | `sncf`, `renfe`, `nl`, `de`, `it`, `ch`, `no`, `fi`, `ie`, `se`, `gb` |
| `date` | `YYYY-MM-DD` | departure date |
| `origin`, `destination` | string | station names exactly as the operator publishes them |
| `depart`, `arrive` | `HH:MM` | local time; an arrival before the departure is the next day |
| `trainNo` | string | train number |
| `category` | string, optional | line or train family (SNCF: the `axe`; GTFS operators: `AVE`, `Eurostar`, `Intercity`…) |
| `passes` | object | per pass: `{ bookable, seat }` |

`seat` is `free` or `full` when the data says so, and `unknown` when no open data does.

The SNCF feed has one MAX flag for both MAX passes (they share one quota), so `max-jeune`
and `max-senior` differ only by MAX SENIOR's own rules. Its weekday rule is applied; its
off-peak limits (Friday afternoon and evening, Monday morning, eves of holidays) are not in
the data, so `index.json` carries them as the pass's `note`. For Interrail, each operator's
entry carries its own booking site (`bookingUrl`) and reservation rules (`note`): whether a
pass holder needs a reservation depends on the operator and the train (none on ICE within
Germany or on Dutch domestic trains; a paid one on TGV INOUI, Frecciarossa or AVE).

## Passes

| Pass | Bookable when | Seat |
|------|---------------|------|
| `max-jeune` | SNCF marks a free MAX seat (`od_happy_card = OUI`), domestic stops only | known |
| `max-senior` | as `max-jeune`, and the date is a weekday | known |
| `interrail` | the train runs: every TGV INOUI, Intercités, night and international train takes a pass-holder reservation | unknown |

GTFS operators (every operator but `sncf`) publish only `interrail`. Each kept trip becomes one train
per pair of stops it calls at, per date it runs, like an SNCF row; a departure after
midnight is dated the next day. Renfe leaves out AVLO, which doesn't take Interrail. The
Dutch feed keeps international and long-distance trains (Eurostar, ICE, EuroCity,
Intercity direct, Nightjet) at every stop, and domestic Intercity trains only between the
stations those serve. The other national feeds work the same way: long-distance families
at every stop, regional ones (Italy's REG and RV, Switzerland's IR and RE, Norway's R/RE/RX,
Finland's H, Ireland's commuter lines) only between the long-distance stations, and
suburban lines, charters and trains that don't take Interrail (Flytoget, the DART,
panoramic trains) left out. `trainNo` is the trip's number, or the route's short name when
the feed has none (Germany and Norway give only the line, e.g. `ICE 1`, `F6`).

Great Britain (`gb`) comes from Network Rail's SCHEDULE feed instead of GTFS. Each train's
permanent schedule is replaced, date by date, by any short-term overlay or cancellation
that covers that date. Only public calls count, express trains and sleepers are kept
(stopping trains, Heathrow Express, Lumo and Eurostar are left out), `trainNo` is the
headcode (e.g. `1S07`) and `category` the train operator (LNER, Avanti West Coast…).

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

## Trip bundles (v2, preview)

v1 publishes one row per pair of stops, so a train calling at n stations costs n(n-1)/2
rows and the national files grow fast (Finland's `all.json` is over 20 MB). v2 publishes
each train's run once, every stop in order, in one file per operator and pass that a
client downloads once and searches offline, changes included. `src/bundle.ts` encodes and
decodes it and has no imports, so clients can copy it.

```json
{ "v": 2, "operator": "renfe", "pass": "interrail",
  "dates": ["2026-10-05", "..."],
  "stations": [["Madrid-Puerta de Atocha-Almudena Grandes", 40.40, -3.69], "..."],
  "families": ["AVE", "..."],
  "trips": [["03063", familyIdx or -1, "dateMask", [stationIdx, ...], [arr0, dep0, arr1, dep1, ...]]] }
```

- `dates` are service days, and `dateMask` reads as in v1.
- Stop times are minutes after midnight of the service day; past 1440 is the next day.
  For stop i, element 2i is the arrival and 2i+1 the departure.
- `stations` carry `[name, lat, lon]`, from the feed's `stop_lat`/`stop_lon` (a platform's
  station takes the station's own position). They are `null` where the source has none:
  SNCF's `tgvmax` and Network Rail's SCHEDULE.
- GTFS operators keep every stop of every kept train: the `narrow` rule of v1 is not
  applied, since a stop costs one entry here. Sources without stop lists (SNCF's
  `tgvmax`) ship each row as a two-stop trip.

| Path (under `/v2/`) | Content |
|------|---------|
| `index.json` | freshness, and per operator `dates`, `stationCount`, `locatedCount` (stations with coordinates), and each pass with its `seatKnown`, `bookingUrl`, `note`, `tripCount` and `bytes` (the bundle's size) |
| `<operator>/stations.json` | `[[name, lat, lon], …]` sorted by name, to list every station before downloading a bundle |
| `<operator>/<pass>.json` | the operator's trips for the pass |

v2 is a preview: its shape may still change until it is announced stable. v1 keeps being
published alongside it.

