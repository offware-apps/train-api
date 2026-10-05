/**
 * The compact snapshot format: how the API ships a timetable.
 *
 * A feed lists one row per train per day, so most of a 30-day file is the same
 * service repeated on every date it runs. Storing each distinct service ONCE, with a
 * bitmask of the dates it runs on, cuts the file by roughly the number of days covered
 * and keeps the "all trains" snapshot small enough to ship as a static file.
 *
 * Shape (v1):
 *   { v: 1, dates: ["YYYY-MM-DD", …], stations: [name, …], axes: [axe, …],
 *     trains: [[originIdx, destIdx, "HH:MM", "HH:MM", trainNo, axeIdx | -1, dateMask], …] }
 * `dateMask` is a hex string; hex digit j holds dates 4j..4j+3, low bit first.
 * `axes` holds the trains' categories (the SNCF "axe").
 *
 * Pure: the API build encodes, clients decode (copy this file, it has no imports).
 */

export interface CompactSnapshot {
  v: 1;
  dates: string[];
  stations: string[];
  axes: string[];
  trains: CompactTrain[];
}

export type CompactTrain = [number, number, string, string, string, number, string];

/** One timetable row: the open format's train without its pass details. */
export interface TimetableRow {
  date: string;
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  trainNo: string;
  category?: string;
}

function indexer(): { list: string[]; idx: (s: string) => number } {
  const list: string[] = [];
  const map = new Map<string, number>();
  return {
    list,
    idx: (s) => {
      let i = map.get(s);
      if (i === undefined) {
        i = list.length;
        list.push(s);
        map.set(s, i);
      }
      return i;
    },
  };
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

/** Group rows into distinct services, each carrying the dates it runs on. */
export function encodeCompact(rows: TimetableRow[]): CompactSnapshot {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const stations = indexer();
  const axes = indexer();
  const services = new Map<string, { row: CompactTrain; bits: boolean[] }>();
  for (const r of rows) {
    const key = [r.origin, r.destination, r.depart, r.arrive, r.trainNo, r.category ?? ""].join("\u0000");
    let s = services.get(key);
    if (!s) {
      const row: CompactTrain = [
        stations.idx(r.origin),
        stations.idx(r.destination),
        r.depart,
        r.arrive,
        r.trainNo,
        r.category ? axes.idx(r.category) : -1,
        "",
      ];
      s = { row, bits: new Array<boolean>(dates.length).fill(false) };
      services.set(key, s);
    }
    s.bits[dateIdx.get(r.date) ?? 0] = true;
  }
  const trains: CompactTrain[] = [];
  for (const s of services.values()) {
    s.row[6] = maskToHex(s.bits);
    trains.push(s.row);
  }
  return { v: 1, dates, stations: stations.list, axes: axes.list, trains };
}

/** Is this parsed JSON a v1 compact snapshot? */
export function isCompact(x: unknown): x is CompactSnapshot {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Partial<CompactSnapshot>;
  return o.v === 1 && Array.isArray(o.dates) && Array.isArray(o.stations) && Array.isArray(o.axes) && Array.isArray(o.trains);
}

/** Expand a compact snapshot back to one row per train per date. Malformed rows are skipped. */
export function decodeCompact(c: CompactSnapshot): TimetableRow[] {
  const out: TimetableRow[] = [];
  for (const t of c.trains) {
    if (!Array.isArray(t)) continue;
    const [o, d, dep, arr, no, ax, mask] = t;
    const origin = c.stations[o];
    const destination = c.stations[d];
    if (origin === undefined || destination === undefined || typeof mask !== "string") continue;
    const category = ax >= 0 ? c.axes[ax] : undefined;
    for (let j = 0; j < mask.length; j++) {
      const n = parseInt(mask[j] ?? "0", 16);
      if (!n) continue;
      for (let b = 0; b < 4; b++) {
        if (!(n & (1 << b))) continue;
        const date = c.dates[j * 4 + b];
        if (date === undefined) continue;
        const row: TimetableRow = { date, origin, destination, depart: dep, arrive: arr, trainNo: no };
        if (category !== undefined) row.category = category;
        out.push(row);
      }
    }
  }
  return out;
}
