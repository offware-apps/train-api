import { encodeCompact } from "./compact";
import { PASSES, PASS_INFO, type PassId, type PassInfo, type Train } from "./format";

/**
 * The static API: plain JSON files, so it can be hosted for free and never needs a
 * server. Layout (all under /v1/):
 *
 *   index.json                          what is published, how fresh, per pass
 *   <operator>/stations.json            [{ id, name }] — id is the URL slug
 *   <operator>/<pass>/all.json          every bookable train, compact snapshot
 *   <operator>/<pass>/from/<id>.json    the trains leaving one station, compact snapshot
 *
 * Search by origin, destination and date = fetch `from/<origin>.json` and filter.
 */

export interface ApiFile {
  /** Path under the API root, e.g. "v1/sncf/interrail/all.json". */
  path: string;
  body: unknown;
}

export interface ApiIndex {
  version: 1;
  updatedAt: string;
  operators: {
    id: string;
    source: string;
    dates: string[];
    stationCount: number;
    passes: (PassInfo & { trainCount: number })[];
  }[];
}

/** URL-safe station id: accents folded, lowercase, dashes. "PARIS (intramuros)" → "paris-intramuros". */
export function stationId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function bookableFor(trains: Train[], pass: PassId): Train[] {
  return trains.filter((t) => t.passes[pass]?.bookable);
}

/** Build every API file for one operator's trains. */
export function buildOperatorApi(
  operator: string,
  source: string,
  trains: Train[],
): { files: ApiFile[]; entry: ApiIndex["operators"][number] } {
  const names = [...new Set(trains.flatMap((t) => [t.origin, t.destination]))].sort();
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const n of names) {
    // Two names folding to one id would overwrite each other's file: suffix the later one.
    const base = stationId(n) || "station";
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    ids.set(n, id);
  }
  const files: ApiFile[] = [
    { path: `v1/${operator}/stations.json`, body: names.map((n) => ({ id: ids.get(n), name: n })) },
  ];
  const passes: ApiIndex["operators"][number]["passes"] = [];
  for (const pass of PASSES) {
    const ok = bookableFor(trains, pass);
    if (ok.length === 0) continue;
    passes.push({ ...PASS_INFO[pass], trainCount: ok.length });
    files.push({ path: `v1/${operator}/${pass}/all.json`, body: encodeCompact(ok) });
    const byOrigin = new Map<string, Train[]>();
    for (const t of ok) {
      const list = byOrigin.get(t.origin);
      if (list) list.push(t);
      else byOrigin.set(t.origin, [t]);
    }
    for (const [origin, list] of byOrigin) {
      files.push({ path: `v1/${operator}/${pass}/from/${ids.get(origin)}.json`, body: encodeCompact(list) });
    }
  }
  const dates = [...new Set(trains.map((t) => t.date))].sort();
  return { files, entry: { id: operator, source, dates, stationCount: names.length, passes } };
}

export function buildIndex(updatedAt: string, operators: ApiIndex["operators"]): ApiFile {
  const body: ApiIndex = { version: 1, updatedAt, operators };
  return { path: "v1/index.json", body };
}
