# train-api

[![CI](https://github.com/offware-apps/train-api/actions/workflows/ci.yml/badge.svg)](https://github.com/offware-apps/train-api/actions/workflows/ci.yml)
[![Publish API](https://github.com/offware-apps/train-api/actions/workflows/publish.yml/badge.svg)](https://github.com/offware-apps/train-api/actions/workflows/publish.yml)
[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6ba539)](docs/openapi.yaml)

**Open timetables for rail passes across Europe.** One free JSON API that tells you which
trains a pass holder can take: MAX JEUNE and MAX SENIOR on SNCF, and Interrail on nine
European operators, eleven once two free keys are set. It is rebuilt every day from each operator's own open data.

No key, no sign-up, open CORS. Use it from a browser, a server, a bot or a spreadsheet.
It powers [MAX-Finder](https://github.com/offware-apps/MAX-Finder), and anyone can build
on it too.

> "train-api" is a working name; the final one isn't chosen yet.

## Quick start

```sh
# What is published, how fresh, which passes per operator
curl -s https://offware-apps.github.io/train-api/v1/index.json

# Station ids for one operator
curl -s https://offware-apps.github.io/train-api/v1/sncf/stations.json

# Every Interrail train leaving Madrid Atocha in the next weeks
curl -s https://offware-apps.github.io/train-api/v1/renfe/interrail/from/madrid-puerta-de-atocha-almudena-grandes.json
```

The [developer guide](docs/developers.md) has every endpoint, JavaScript and Python
examples, the credit line each source asks for, and the stability promise. The
[OpenAPI spec](docs/openapi.yaml) describes every file.

## Operators

| Operator | Country | Source | Licence | Passes |
|----------|---------|--------|---------|--------|
| `sncf` | France | SNCF Open Data `tgvmax` (TGV INOUI, Intercités) | Licence Ouverte | MAX JEUNE, MAX SENIOR, Interrail |
| `renfe` | Spain | Renfe Data (GTFS) | CC BY 4.0 | Interrail |
| `nl` | Netherlands | OVapi, national timetable (GTFS) | CC0 | Interrail |
| `de` | Germany | DELFI via gtfs.de (GTFS), long distance | CC BY 4.0 | Interrail |
| `it` | Italy | Trenitalia via the Italian NAP, GTFS by [deryclem](https://github.com/deryclem/trenitalia-gtfs) | CC BY 4.0 | Interrail |
| `ch` | Switzerland | opentransportdata.swiss (GTFS) | free use, source cited | Interrail |
| `no` | Norway | Entur (GTFS): Vy, Go-Ahead, SJ | NLOD | Interrail |
| `fi` | Finland | Fintraffic / digitraffic.fi (GTFS) | CC BY 4.0 | Interrail |
| `ie` | Ireland | National Transport Authority (GTFS), without the DART | CC BY 4.0 | Interrail |
| `se` | Sweden | Samtrafiken via Trafiklab (GTFS Sverige 2) | CC0 | Interrail |
| `gb` | Great Britain | Network Rail SCHEDULE feed | Network Rail licence | Interrail |

`se` and `gb` need a free account with their publisher; they are left out until their keys
are set as repository secrets. No open data says whether an Interrail pass seat is left, so
Interrail trains are published as running, with the seat `unknown`.

## Free and hosted

| | Free API (this repository) | Hosted API (coming) |
|---|---|---|
| What | Each operator's pass timetable, as static files | Computed answers on top of the same data |
| Examples | Trains from a station, stations, dates, booking links | Madrid → Amsterdam with changes across operators, alerts |
| Access | No key, open CORS | API key, usage-based plans |
| Refresh | Daily | Daily, with live data where operators publish it |
| Code | Open source (AGPL-3.0) | Hosted service |

Public data stays public: anything the free API can serve stays free. The hosted API sells
the hard parts (Europe-wide route search, alerts, uptime and higher limits), so apps and
businesses don't have to run that themselves.

## How it works

```
operator open data ──► npm run fetch ──► npm run build:api ──► public/v1/*.json ──► GitHub Pages
  (SNCF, GTFS zips,       data/raw/        open train format,        static API          daily, free
   Network Rail)                           compact snapshots
```

1. `npm run fetch` downloads every source to `data/raw/`.
2. `npm run build:api` maps it to the [open train format](docs/format.md) and writes the
   API in compact snapshots: each service stored once with the dates it runs, about 20x
   smaller than raw rows.
3. The **Publish API** workflow does both every day and deploys to GitHub Pages. There is
   no server and no cost. The **Archive MAX seats** workflow keeps one snapshot a day of
   SNCF MAX seats on the `data` branch ([docs/archive.md](docs/archive.md)).

## Roadmap

Tracked in [MAX-Finder's issues](https://github.com/offware-apps/MAX-Finder/issues):

- [x] Interrail on SNCF, Renfe, NS, DB, Trenitalia, SBB, Norway, Finland, Ireland
- [x] Sweden and Great Britain readers (on once their keys are set)
- [ ] Europe-wide route search across operators ([#84](https://github.com/offware-apps/MAX-Finder/issues/84))
- [ ] Seat and price alerts ([#85](https://github.com/offware-apps/MAX-Finder/issues/85))
- [ ] Live delay alerts with smart connections ([#86](https://github.com/offware-apps/MAX-Finder/issues/86))
- [ ] Hosted API with keys and usage pricing ([#87](https://github.com/offware-apps/MAX-Finder/issues/87))
- [ ] Multi-city trip optimizer ([#88](https://github.com/offware-apps/MAX-Finder/issues/88)) and flexible dates ([#89](https://github.com/offware-apps/MAX-Finder/issues/89))
- [ ] Nomad mode ([#90](https://github.com/offware-apps/MAX-Finder/issues/90)) and group trips ([#91](https://github.com/offware-apps/MAX-Finder/issues/91))
- [ ] CO2 saved compared with flying ([#92](https://github.com/offware-apps/MAX-Finder/issues/92))
- [ ] Embeddable route search widget for businesses ([#93](https://github.com/offware-apps/MAX-Finder/issues/93))
- [ ] Calendar sync ([#94](https://github.com/offware-apps/MAX-Finder/issues/94))
- [ ] More operators: Belgium (SNCB), Austria (ÖBB), Denmark, once their licences allow it

## Develop

Node 22.

```sh
npm ci
npm run check                                              # typecheck + tests
npm run build:api -- tests/fixtures/sncf-tgvmax.sample.json \
  --gtfs renfe=tests/fixtures/gtfs-mini --gb tests/fixtures/gb-schedule.json \
  --from 2026-10-05                                          # build from the fixtures
```

`npm run fetch && npm run build:api` builds from the real feeds (about 3.5 GB of memory).
For `se` and `gb`, set `TRAFIKLAB_KEY`, `NETWORK_RAIL_EMAIL` and `NETWORK_RAIL_PASSWORD`.

## Contributing

Issues and pull requests are welcome. To add an operator, it needs an open timetable whose
licence allows reuse, commercial use included; see [AGENTS.md](AGENTS.md) for how the
readers are organised.

## Licence

Code: [AGPL-3.0](LICENSE). Data keeps each source's licence; credit them as the
[developer guide](docs/developers.md#licences-and-credit) says.

Not affiliated with SNCF, Interrail/Eurail or any operator. Always book on the operator's
own site.
