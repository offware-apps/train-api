# Agent guidelines

- Never mention AI tools or assistants anywhere that is pushed: no assistant co-author or
  session trailers, no "generated with" lines, in commits, PRs, comments, code or docs.
- Merge pull requests with squash and merge.
- Before a commit: `npm run check` and `npm run build:api -- tests/fixtures/sncf-tgvmax.sample.json --gtfs renfe=tests/fixtures/gtfs-mini --gb tests/fixtures/gb-schedule.json --from 2026-10-05`.
- `docs/format.md` is the contract with clients: change it in the same change as
  `src/format.ts`, `src/compact.ts` or `src/api.ts`.
- Never claim a seat the data doesn't show: a pass whose seat no open data publishes
  stays `seat: "unknown"`.
