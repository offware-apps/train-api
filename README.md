# train-api

> **Work in progress.** "train-api" is a placeholder name; the final name isn't chosen yet.

Open train data for rail passes: **MAX JEUNE**, **MAX SENIOR** and **Interrail**, one simple
API per operator, built from each operator's own open timetable:

| Operator | Source | Licence | Passes |
|----------|--------|---------|--------|
| `sncf` | SNCF Open Data `tgvmax` (TGV INOUI, Intercités) | Licence Ouverte | MAX JEUNE, MAX SENIOR, Interrail |
| `renfe` | Renfe Data, high-speed, long and medium distance (GTFS) | CC BY 4.0 | Interrail |
| `nl` | Dutch national timetable via OVapi (GTFS): international and Intercity trains | CC0 | Interrail |

The SNCF part is built on top of [MAX-Finder](https://github.com/offware-apps/MAX-Finder):
the same feed, without MAX-Finder's "free MAX seat only" filter, so every train an
Interrail holder can book shows up. Each operator is published on its own; trips that
change between operators aren't joined here.

No open data says whether an Interrail pass-holder seat is left, so Interrail trains are
published as running, with the seat `unknown`.

## How it works

1. `npm run fetch` downloads every source to `data/raw/`: the SNCF `tgvmax` feed (every
   TGV INOUI and Intercités train for ~30 days) and each GTFS operator's zip, unzipped.
2. `npm run build:api` maps it to the [open train format](docs/format.md) and writes the
   static API to `public/v1/` in the compact snapshot format: each service is stored once
   with the dates it runs, about 20x smaller than the raw rows.
3. The **Publish API** workflow does both daily and deploys `public/` to GitHub Pages.
   There is no server and no cost.

Live at <https://offware-apps.github.io/train-api/v1/index.json> once Pages is on
(Settings → Pages → Source: GitHub Actions).

## Develop

```sh
npm ci
npm run check                                              # typecheck + tests
npm run build:api -- tests/fixtures/sncf-tgvmax.sample.json \
  --gtfs renfe=tests/fixtures/gtfs-mini --from 2026-10-05    # build from the fixtures
```

## Next

- The front-end on top of MAX-Finder's search core, with Interrail as the pass.
- More operators through the same GTFS reader (Deutsche Bahn, SNCB once its licence is checked).

Data: SNCF Open Data (Licence Ouverte), Renfe Data (CC BY 4.0), OVapi / NDOV (CC0).
Code: AGPL-3.0.
