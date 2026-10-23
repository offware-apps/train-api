/**
 * The trip bundle format (v2): how the API ships one operator's timetable for one pass as
 * a single file a client can download once and search offline.
 *
 * v1 stores one row per pair of stops, so a train calling at n stations costs n(n-1)/2
 * rows. A bundle stores each train's run once, its stops in order, so it costs n entries.
 * As in v1, a run repeated on many dates is stored once with a bitmask of its dates.
 *
 * Shape (v2):
 *   { v: 2, operator, pass, dates: ["YYYY-MM-DD", …],
 *     stations: [[name, lat | null, lon | null], …], families: [family, …],
 *     trips: [[trainNo, familyIdx | -1, dateMask, [stationIdx, …], [minutes, …]], …] }
 * `dateMask` is hex; hex digit j holds dates 4j..4j+3, low bit first. `dates` are service
 * days. For stop i, minutes[2i] is the arrival and minutes[2i+1] the departure, in minutes
 * after midnight of the service day; past 1440 is the next day.
 *
 * Pure: the API build encodes, clients decode (copy this file, it has no imports).
 */

export interface Bundle {
  v: 2;
  operator: string;
  pass: string;
  dates: string[];
  stations: BundleStation[];
  families: string[];
  trips: BundleTrip[];
}

export type BundleStation = [string, number | null, number | null];

export type BundleTrip = [string, number, string, number[], number[]];

/** One train's run: the format's `Trip` without operator and pass details. */
export interface TripRun {
  trainNo: string;
  category?: string;
  /** Service days, sorted. */
  dates: string[];
  stops: { station: string; arr: number; dep: number }[];
}

function maskToHex(bits: boolean[]): string {
  let out = "";
  for (let j = 0; j < bits.length; j += 4) {
    let n = 0;
    for (let b = 0; b < 4; b++) if (bits[j + b]) n |= 1 << b;
    out += n.toString(16);
  }
  return out;
}

/** Coordinates rounded to about a metre. */
function round(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

/** Group runs into distinct trips, each carrying the dates it runs on. */
export function encodeBundle(
  operator: string,
  pass: string,
  runs: TripRun[],
  coords: Map<string, [number, number]> = new Map(),
): Bundle {
  const dates = [...new Set(runs.flatMap((r) => r.dates))].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const stations: BundleStation[] = [];
  const stationIdx = new Map<string, number>();
  const families: string[] = [];
  const familyIdx = new Map<string, number>();
  const station = (name: string): number => {
    let i = stationIdx.get(name);
    if (i === undefined) {
      i = stations.length;
      stationIdx.set(name, i);
      const at = coords.get(name);
      stations.push(at ? [name, round(at[0]), round(at[1])] : [name, null, null]);
    }
    return i;
  };
  const family = (name: string): number => {
    let i = familyIdx.get(name);
    if (i === undefined) {
      i = families.length;
      familyIdx.set(name, i);
      families.push(name);
    }
    return i;
  };
  const trips = new Map<string, { trip: BundleTrip; bits: boolean[] }>();
  for (const r of runs) {
    const ids = r.stops.map((s) => station(s.station));
    const minutes = r.stops.flatMap((s) => [s.arr, s.dep]);
    const key = [r.trainNo, r.category ?? "", ids.join(","), minutes.join(",")].join("\u0000");
    let t = trips.get(key);
    if (!t) {
      t = { trip: [r.trainNo, r.category ? family(r.category) : -1, "", ids, minutes], bits: new Array<boolean>(dates.length).fill(false) };
      trips.set(key, t);
    }
    for (const d of r.dates) t.bits[dateIdx.get(d) ?? 0] = true;
  }
  const out: BundleTrip[] = [];
  for (const t of trips.values()) {
    t.trip[2] = maskToHex(t.bits);
    out.push(t.trip);
  }
  return { v: 2, operator, pass, dates, stations, families, trips: out };
}

/** Is this parsed JSON a v2 bundle? */
export function isBundle(x: unknown): x is Bundle {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Partial<Bundle>;
  return (
    o.v === 2 &&
    Array.isArray(o.dates) &&
    Array.isArray(o.stations) &&
    Array.isArray(o.families) &&
    Array.isArray(o.trips)
  );
}

/** The dates a hex mask holds. */
export function maskDates(mask: string, dates: string[]): string[] {
  const out: string[] = [];
  for (let j = 0; j < mask.length; j++) {
    const n = parseInt(mask[j] ?? "0", 16);
    if (!n) continue;
    for (let b = 0; b < 4; b++) {
      const d = dates[j * 4 + b];
      if (n & (1 << b) && d !== undefined) out.push(d);
    }
  }
  return out;
}

/** Expand a bundle back to its runs. Malformed trips are skipped. */
export function decodeBundle(b: Bundle): TripRun[] {
  const out: TripRun[] = [];
  for (const t of b.trips) {
    if (!Array.isArray(t)) continue;
    const [trainNo, fam, mask, ids, minutes] = t;
    if (typeof mask !== "string" || !Array.isArray(ids) || !Array.isArray(minutes) || minutes.length !== ids.length * 2) continue;
    const stops: TripRun["stops"] = [];
    for (let i = 0; i < ids.length; i++) {
      const s = b.stations[ids[i] as number];
      if (!s) break;
      stops.push({ station: s[0], arr: minutes[2 * i] as number, dep: minutes[2 * i + 1] as number });
    }
    if (stops.length !== ids.length) continue;
    const run: TripRun = { trainNo, dates: maskDates(mask, b.dates), stops };
    const category = fam >= 0 ? b.families[fam] : undefined;
    if (category !== undefined) run.category = category;
    out.push(run);
  }
  return out;
}
