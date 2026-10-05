# train-api

Open train data for rail passes, starting with **Interrail** on SNCF. It is built on top
of [MAX-Finder](https://github.com/offware-apps/MAX-Finder): the same SNCF open-data feed,
without MAX-Finder's "free MAX seat only" filter, so every train an Interrail holder can
book shows up.

No open data says whether an Interrail pass-holder seat is left, so Interrail trains are
published as running, with the seat `unknown`.

## How it works

1. `npm run fetch` downloads the SNCF `tgvmax` feed (every TGV INOUI and Intercités train
   for ~30 days) to `data/raw/`.
2. `npm run build:api` maps it to the [open train format](docs/format.md) and writes the
   static API to `public/v1/` in the compact snapshot format: each service is stored once
   with the dates it runs, about 20x smaller than the raw rows.
3. The **Publish API** workflow does both daily and deploys `public/` to GitHub Pages.
   There is no server and no cost.

GitHub Pages on a private repository needs a paid GitHub plan. Without one, make the repo
public or point the workflow at another free static host.

## Develop

```sh
npm ci
npm run check                                              # typecheck + tests
npm run build:api -- tests/fixtures/sncf-tgvmax.sample.json  # build from the fixture
```

## Next

- The front-end on top of MAX-Finder's search core, with Interrail as the pass.
- Other operators through the same format (Deutsche Bahn, Renfe).

Data: SNCF Open Data, Licence Ouverte. Code: AGPL-3.0.
