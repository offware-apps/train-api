# Build on train-api

train-api publishes, every day, which trains a rail-pass holder can take: MAX JEUNE and MAX
SENIOR on SNCF, and Interrail on nine European operators. It is plain JSON on GitHub
Pages, so anyone can use it, from a browser or a server, for free:

- **No key, no sign-up, no rate limit of ours.** All public data stays public.
- **CORS is open.** GitHub Pages answers every origin with `Access-Control-Allow-Origin: *`,
  so a web page on any site can `fetch` it directly.
- **Stable.** Everything under `/v1/` follows the [promise below](#stability).
- **Machine-readable.** [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1, JSON Schema 2020-12)
  describes every file. Load it in Swagger UI, Postman or a code generator.

Base URL: `https://offware-apps.github.io/train-api/v1`

## Quick start

```sh
# What is published, how fresh, which passes per operator
curl -s https://offware-apps.github.io/train-api/v1/index.json

# Station ids for one operator
curl -s https://offware-apps.github.io/train-api/v1/sncf/stations.json

# Every MAX JEUNE train leaving Paris in the next ~30 days
curl -s https://offware-apps.github.io/train-api/v1/sncf/max-jeune/from/paris-intramuros.json
```

Ready-to-run search, no dependencies:

```sh
node examples/search.mjs sncf max-jeune paris-intramuros lyon-intramuros 2026-10-20
python3 examples/search.py renfe interrail madrid-puerta-de-atocha-almudena-grandes zaragoza-delicias 2026-10-20
```

## Endpoints

| Path | Content |
|------|---------|
| `index.json` | build time (`updatedAt`), and per operator: `source` with its licence, `dates` covered, `stationCount`, and each pass with `seatKnown`, `bookingUrl`, `note`, `trainCount` |
| `<operator>/stations.json` | `[{ "id": "paris-intramuros", "name": "PARIS (intramuros)" }]`, sorted by name |
| `<operator>/<pass>/from/<stationId>.json` | the trains bookable with the pass that leave one station ([compact](#compact-snapshot)) |
| `<operator>/<pass>/all.json` | every train bookable with the pass ([compact](#compact-snapshot)); several MB for the large feeds |

Operators today: `sncf`, `renfe`, `nl`, `de`, `it`, `ch`, `no`, `fi`, `ie`, with `gb` and
`se` added once their feeds' free accounts are set up. Passes:
`max-jeune` and `max-senior` (SNCF only), `interrail` (all). Read both lists from
`index.json` rather than hard-coding them: operators and passes get added.

A path that doesn't exist returns **404** with an HTML body. For `from/<stationId>.json`
that just means no train leaving that station is bookable with that pass in the window.

### Search by origin, destination and date

1. Look the two stations up in `<operator>/stations.json` (by `id` or by `name`).
2. Fetch `<operator>/<pass>/from/<originId>.json`.
3. Expand it and keep the rows whose `destination` equals the destination's `name` and
   whose `date` is the day you want.

Each row is one train between two of its stops, so a train Paris → Lyon → Marseille shows
up as Paris → Lyon, Paris → Marseille and Lyon → Marseille. Trips that change trains, or
change operators, aren't joined.

## Compact snapshot

Timetable files store each service once with a bitmask of the dates it runs on:

```json
{
  "v": 1,
  "dates": ["2026-10-05", "2026-10-06", "2026-10-07"],
  "stations": ["PARIS (intramuros)", "LYON (intramuros)"],
  "axes": ["SUD EST"],
  "trains": [[0, 1, "08:00", "10:00", "6601", 0, "5"]]
}
```

A train is `[originIdx, destinationIdx, depart, arrive, trainNo, axeIdx, dateMask]`:

- `originIdx`, `destinationIdx` point into this file's `stations`; `axeIdx` into its
  `axes` (the SNCF axe, or a train family such as `AVE`, `ICE`, `Intercity`), `-1` for none.
- `dateMask` is hex. Hex digit `j` holds dates `4j` to `4j+3` of this file's `dates`, low bit
  first. Above, `"5"` = binary `0101`: the train runs on `dates[0]` and `dates[2]`.
- `dates`, `stations` and `axes` belong to each file; don't reuse indexes across files.

Expand it to one row per train per date:

```js
function decodeCompact(c) {
  const rows = [];
  for (const [o, d, depart, arrive, trainNo, axe, mask] of c.trains) {
    for (let j = 0; j < mask.length; j++) {
      const n = parseInt(mask[j], 16);
      for (let b = 0; b < 4; b++) {
        const date = c.dates[j * 4 + b];
        if (!(n & (1 << b)) || date === undefined) continue;
        rows.push({ date, origin: c.stations[o], destination: c.stations[d], depart, arrive, trainNo,
                    category: axe >= 0 ? c.axes[axe] : undefined });
      }
    }
  }
  return rows;
}
```

```python
def decode_compact(c):
    rows = []
    for o, d, depart, arrive, train_no, axe, mask in (t[:7] for t in c["trains"]):
        for j, digit in enumerate(mask):
            n = int(digit, 16)
            for b in range(4):
                i = j * 4 + b
                if n & (1 << b) and i < len(c["dates"]):
                    rows.append({"date": c["dates"][i], "origin": c["stations"][o],
                                 "destination": c["stations"][d], "depart": depart,
                                 "arrive": arrive, "trainNo": train_no,
                                 "category": c["axes"][axe] if axe >= 0 else None})
    return rows
```

In TypeScript, copy [`src/compact.ts`](../src/compact.ts): it has no imports.

## What the fields mean

- **Times** are `HH:MM`, local time at the station. An `arrive` earlier than `depart` is on
  the next day. `date` is the departure date from `origin`.
- **Station names** are exactly as each operator publishes them, so the same city is spelled
  differently by different operators (`BRUXELLES MIDI`, `Bruxelles-Midi`…). Station ids
  are per operator and are made from the name, so a station renamed by its operator gets a
  new id. Read ids from `stations.json` instead of storing them for good.
- **`trainNo`** is the train number, or the line name when a feed has none (Germany and
  Norway: `ICE 1`, `F6`).
- **Seats.** For MAX passes (`seatKnown: true`), a train is listed only when SNCF showed a
  free MAX seat when the feed was read, about once a day; seats can go between two
  builds. For Interrail (`seatKnown: false`), no open data publishes pass-holder seats:
  the train runs and takes the pass, but the reservation quota may be sold out. Never tell
  users a seat is free when `seatKnown` is false.
- **`note`** carries pass rules no timetable can check (MAX SENIOR's peak periods,
  Interrail's residence rule). Show it next to results.
- **Window.** About 30 days ahead. `index.json` lists the exact `dates` per operator.

The [open train format](format.md) explains how each operator's feed is mapped and which
trains are kept.

## Freshness and caching

- The **Publish API** workflow rebuilds everything every day at 13:30 UTC, after SNCF's
  midday refresh, and after every change merged to `main`. `updatedAt` in `index.json` is
  the build time.
- GitHub Pages sends `ETag`, `Last-Modified` and `Cache-Control: max-age=600`, and gzips
  responses. Conditional requests (`If-None-Match`) are cheap.
- Please cache: re-fetching more than once an hour gains nothing. For heavy use (a busy
  backend, a bulk import), fetch `all.json` once a day and serve your own copy, or build the
  API yourself (below). GitHub Pages has a soft limit of 100 GB of traffic a month for the
  whole site, shared by everyone.

## MAX seat history

The SNCF feed only shows today's MAX seats. A daily snapshot is kept on the public `data`
branch, for computing seat odds by weekday, time or days before travel:

```
https://raw.githubusercontent.com/offware-apps/train-api/data/archive/max/2026/2026-10-06.json.gz
```

Gzipped JSON, one file per day; format in [archive.md](archive.md). The archive is outside
`/v1/` and its promise, though its format isn't expected to change.

## Licences and credit

The code is AGPL-3.0. The data keeps each source's licence. Every source below allows
reuse, commercial use included, as long as you credit it where its licence asks. When you
show or redistribute an operator's trains, credit it, for example in your app's footer or
about page:

| Operator | Source | Licence | Credit line |
|----------|--------|---------|-------------|
| `sncf` | SNCF Open Data, `tgvmax` dataset | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) | "SNCF Open Data", with the date of the data (`updatedAt`) |
| `renfe` | Renfe Data | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "Renfe Data" |
| `nl` | OVapi, NDOV (Dutch national timetable) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | none required; "OVapi / NDOV" appreciated |
| `de` | DELFI e.V. via gtfs.de | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "DELFI e.V. / gtfs.de" |
| `it` | Trenitalia via the Italian National Access Point, GTFS by Clément Desouche | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "Trenitalia, Italian NAP; GTFS by Clément Desouche" |
| `ch` | opentransportdata.swiss | [terms of use](https://opentransportdata.swiss/en/terms-of-use/): free use, source cited | "opentransportdata.swiss" |
| `no` | Entur | [NLOD 2.0](https://data.norge.no/nlod/en/2.0) | "Contains data under the Norwegian licence for Open Government data (NLOD) distributed by Entur" |
| `fi` | Fintraffic, digitraffic.fi | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "Fintraffic / digitraffic.fi" |
| `ie` | National Transport Authority | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "National Transport Authority" |
| `se` | Samtrafiken via Trafiklab, GTFS Sverige 2 | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | none required; "Samtrafiken / Trafiklab" appreciated |
| `gb` | Network Rail open data, SCHEDULE feed | [Network Rail data feeds licence](https://www.networkrail.co.uk/data-feeds/terms-and-conditions/) | "Contains information of Network Rail Infrastructure Limited" |

The `source` field in `index.json` repeats each source and licence, so an app can build its
credit line from it. A link back to this repository is welcome and never required. This
table is a summary: the source's own licence text is what applies.

## Stability

Everything under `/v1/` keeps working for the clients written against it:

- **Additive changes only.** New operators, passes, files, object fields and trailing
  elements in a compact train may appear at any time. Ignore what you don't know: unknown
  keys, and anything after the seventh element of a train.
- **Never in v1:** removing or renaming a path or field, changing a field's type or
  meaning, or changing how `dateMask` is read.
- **A breaking change gets a new version** at `/v2/`. `/v1/` then keeps being published,
  with data refreshed daily, for at least 6 months, and the change is announced in a
  GitHub issue labelled `api` and in this file.
- **Not covered:** which trains a source publishes, station names and ids (they follow the
  operator), an operator dropped because its source stops publishing or changes its
  licence, and a day's build failing (the previous day's files stay up).

## Self-hosting

The whole API is a build step, so you can run your own copy, on your own schedule:

```sh
git clone https://github.com/offware-apps/train-api && cd train-api
npm ci && npm run fetch && npm run build:api   # writes public/v1/
```

The national feeds need about 12 GB of memory (`NODE_OPTIONS=--max-old-space-size=12288`).
Serve `public/` from any static host.

## Help and requests

Open an issue on [offware-apps/train-api](https://github.com/offware-apps/train-api/issues)
for a bug, a wrong train, an operator to add, or a field you need.
