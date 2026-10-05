/**
 * Read a GTFS timetable (the open format most European operators publish) into the open
 * train format. Each kept trip becomes one `Train` per pair of stops it calls at, per date
 * it runs, so a row reads like the SNCF feed's: "this train goes from A to B that day".
 *
 * Files are streamed line by line: a national feed's stop_times.txt can run to gigabytes.
 */
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { PassAvailability, PassId, Train } from "./format";

/** One CSV line → fields. Handles quoted fields and doubled quotes; trims padding. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field.trim());
      field = "";
    } else field += c;
  }
  out.push(field.trim());
  return out;
}

/** Stream a GTFS table, calling `onRow` with each row keyed by column name. Missing file → no rows. */
export async function readTable(dir: string, name: string, onRow: (row: Record<string, string>) => void): Promise<void> {
  const path = join(dir, `${name}.txt`);
  if (!existsSync(path)) return;
  const lines = createInterface({ input: createReadStream(path, "utf-8"), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of lines) {
    if (!raw.trim()) continue;
    const fields = parseCsvLine(raw);
    if (!header) {
      header = fields.map((h) => h.replace(/^﻿/, ""));
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i] as string] = fields[i] ?? "";
    onRow(row);
  }
}

/** What to keep from one operator's feed, and how its trains map to passes. */
export interface GtfsOperator {
  id: string;
  /** Attribution line for the API index: who publishes the data, under which licence. */
  source: string;
  /** Keep this route? `agency` is the route's agency name. Returns the train family kept, or null. */
  route(route: Record<string, string>, agency: string): string | null;
  /**
   * Families whose trains only count between stations the other kept families also serve.
   * A national feed keeps its domestic Intercity this way between the long-distance
   * stations, so the snapshot stays small. Default: none.
   */
  narrow?: (family: string) => boolean;
  passes(family: string): Partial<Record<PassId, PassAvailability>>;
}

/** "YYYYMMDD" → "YYYY-MM-DD". */
function isoDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** GTFS "25:10:00" → minutes after midnight of the service day (1510), or NaN. */
export function gtfsMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The dates each service runs within [from, from + days). */
async function serviceDates(dir: string, from: string, days: number): Promise<Map<string, Set<string>>> {
  const window = Array.from({ length: days }, (_, i) => addDays(from, i));
  const inWindow = new Set(window);
  const out = new Map<string, Set<string>>();
  const get = (id: string): Set<string> => {
    let s = out.get(id);
    if (!s) out.set(id, (s = new Set()));
    return s;
  };
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  await readTable(dir, "calendar", (r) => {
    const start = isoDate(r.start_date ?? "");
    const end = isoDate(r.end_date ?? "");
    for (const d of window) {
      if (d < start || d > end) continue;
      const day = weekdays[new Date(`${d}T12:00:00Z`).getUTCDay()] as string;
      if (r[day] === "1") get(r.service_id ?? "").add(d);
    }
  });
  await readTable(dir, "calendar_dates", (r) => {
    const d = isoDate(r.date ?? "");
    if (!inWindow.has(d)) return;
    if (r.exception_type === "1") get(r.service_id ?? "").add(d);
    else if (r.exception_type === "2") out.get(r.service_id ?? "")?.delete(d);
  });
  return out;
}

interface Call {
  seq: number;
  station: string;
  arr: number;
  dep: number;
}

/** Read one operator's GTFS directory into trains running in [from, from + days). */
export async function readGtfs(dir: string, op: GtfsOperator, from: string, days = 31): Promise<Train[]> {
  const agencies = new Map<string, string>();
  await readTable(dir, "agency", (r) => agencies.set(r.agency_id ?? "", r.agency_name ?? ""));
  const onlyAgency = agencies.size === 1 ? [...agencies.values()][0] ?? "" : "";

  const families = new Map<string, string>();
  await readTable(dir, "routes", (r) => {
    const family = op.route(r, agencies.get(r.agency_id ?? "") ?? onlyAgency);
    if (family) families.set(r.route_id ?? "", family);
  });

  const trips = new Map<string, { service: string; family: string; trainNo: string }>();
  await readTable(dir, "trips", (r) => {
    const family = families.get(r.route_id ?? "");
    if (family) trips.set(r.trip_id ?? "", { service: r.service_id ?? "", family, trainNo: r.trip_short_name ?? "" });
  });

  // Platforms roll up to their station (parent_station), named after the station.
  const names = new Map<string, string>();
  const parents = new Map<string, string>();
  await readTable(dir, "stops", (r) => {
    names.set(r.stop_id ?? "", r.stop_name ?? "");
    if (r.parent_station) parents.set(r.stop_id ?? "", r.parent_station);
  });
  const stationOf = (stop: string): string => names.get(parents.get(stop) ?? stop) ?? names.get(stop) ?? "";

  const calls = new Map<string, Call[]>();
  await readTable(dir, "stop_times", (r) => {
    const trip = r.trip_id ?? "";
    if (!trips.has(trip)) return;
    const arr = gtfsMinutes(r.arrival_time || r.departure_time || "");
    const dep = gtfsMinutes(r.departure_time || r.arrival_time || "");
    if (Number.isNaN(arr) || Number.isNaN(dep)) return;
    const list = calls.get(trip) ?? [];
    list.push({ seq: Number(r.stop_sequence), station: stationOf(r.stop_id ?? ""), arr, dep });
    calls.set(trip, list);
  });

  const dates = await serviceDates(dir, from, days);
  const wide = new Set<string>();
  if (op.narrow) {
    for (const [tripId, trip] of trips) {
      if (op.narrow(trip.family)) continue;
      for (const c of calls.get(tripId) ?? []) wide.add(c.station);
    }
  }
  const out: Train[] = [];
  for (const [tripId, trip] of trips) {
    const runs = dates.get(trip.service);
    const list = calls.get(tripId);
    if (!runs?.size || !list) continue;
    list.sort((a, b) => a.seq - b.seq);
    const narrow = op.narrow?.(trip.family) ?? false;
    const keep = list.filter((c, i) => c.station && c.station !== list[i - 1]?.station && (!narrow || wide.has(c.station)));
    const passes = op.passes(trip.family);
    for (let i = 0; i < keep.length; i++) {
      for (let j = i + 1; j < keep.length; j++) {
        const a = keep[i] as Call;
        const b = keep[j] as Call;
        if (a.station === b.station || b.arr < a.dep) continue;
        // A departure past 24:00 belongs to the next calendar day.
        const shift = Math.floor(a.dep / 1440);
        for (const d of runs) {
          const t: Train = {
            operator: op.id,
            date: addDays(d, shift),
            origin: a.station,
            destination: b.station,
            depart: hhmm(a.dep),
            arrive: hhmm(b.arr),
            trainNo: trip.trainNo,
            category: trip.family,
            passes,
          };
          out.push(t);
        }
      }
    }
  }
  return out;
}
