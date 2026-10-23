import { encodeBundle, type BundleStation } from "./bundle";
import { encodeCompact } from "./compact";
import { PASSES, PASS_INFO, type PassId, type PassInfo, type Train, type Trip } from "./format";
import { INTERRAIL_BY_OPERATOR } from "./operators/interrail";

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
    const own = pass === "interrail" ? INTERRAIL_BY_OPERATOR[operator] : undefined;
    passes.push({ ...PASS_INFO[pass], ...own, trainCount: ok.length });
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

/**
 * The v2 files: per operator, one trip bundle per pass (`<operator>/<pass>.json`) and its
 * stations with their coordinates (`<operator>/stations.json`), so a client can show every
 * station before downloading any bundle. Layout (all under /v2/):
 *
 *   index.json                 what is published, how fresh, each bundle's size
 *   <operator>/stations.json   [[name, lat | null, lon | null], …]
 *   <operator>/<pass>.json     the operator's trips for the pass (src/bundle.ts)
 */
export interface ApiIndexV2 {
  version: 2;
  updatedAt: string;
  operators: {
    id: string;
    source: string;
    dates: string[];
    stationCount: number;
    /** Stations with coordinates. */
    locatedCount: number;
    passes: (PassInfo & { tripCount: number; bytes: number })[];
  }[];
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** v1 rows as two-stop trips, for a source with no stop lists (SNCF's tgvmax). */
export function tripsFromTrains(trains: Train[]): Trip[] {
  return trains.map((t) => {
    const dep = minutesOf(t.depart);
    let arr = minutesOf(t.arrive);
    if (arr < dep) arr += 1440;
    const trip: Trip = {
      operator: t.operator,
      trainNo: t.trainNo,
      dates: [t.date],
      stops: [
        { station: t.origin, arr: dep, dep },
        { station: t.destination, arr, dep: arr },
      ],
      passes: t.passes,
    };
    if (t.category) trip.category = t.category;
    return trip;
  });
}

/** Build the v2 files for one operator's trips. */
export function buildOperatorBundles(
  operator: string,
  source: string,
  trips: Trip[],
  coords: Map<string, [number, number]>,
): { files: ApiFile[]; entry: ApiIndexV2["operators"][number] } {
  const files: ApiFile[] = [];
  const passes: ApiIndexV2["operators"][number]["passes"] = [];
  const stations = new Map<string, BundleStation>();
  for (const pass of PASSES) {
    const ok = trips.filter((t) => t.passes[pass]?.bookable);
    if (ok.length === 0) continue;
    const body = encodeBundle(operator, pass, ok, coords);
    for (const s of body.stations) stations.set(s[0], s);
    const own = pass === "interrail" ? INTERRAIL_BY_OPERATOR[operator] : undefined;
    passes.push({ ...PASS_INFO[pass], ...own, tripCount: body.trips.length, bytes: JSON.stringify(body).length });
    files.push({ path: `v2/${operator}/${pass}.json`, body });
  }
  const list = [...stations.values()].sort((a, b) => a[0].localeCompare(b[0]));
  files.push({ path: `v2/${operator}/stations.json`, body: list });
  const dates = [...new Set(trips.flatMap((t) => t.dates))].sort();
  return {
    files,
    entry: { id: operator, source, dates, stationCount: list.length, locatedCount: list.filter((s) => s[1] !== null).length, passes },
  };
}

export function buildIndexV2(updatedAt: string, operators: ApiIndexV2["operators"]): ApiFile {
  const body: ApiIndexV2 = { version: 2, updatedAt, operators };
  return { path: "v2/index.json", body };
}
