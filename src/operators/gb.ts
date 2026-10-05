/**
 * Great Britain's timetable from Network Rail's open data SCHEDULE feed (the daily full
 * extract, newline-delimited JSON, gzipped). Needs a free Network Rail open data account:
 * NETWORK_RAIL_EMAIL and NETWORK_RAIL_PASSWORD, repository secrets in the workflows.
 *
 * The feed lists each train's schedules with the days and date range they apply to, plus
 * short-term overlays and cancellations (the STP indicator) that override the permanent
 * schedule on their dates. Locations are TIPLOCs, named by the feed's own TIPLOC records.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { PassAvailability, PassId, Train } from "../format";
import { addDays, interner, pushStopPairs, type Call } from "../gtfs";

export const NETWORK_RAIL_URL =
  "https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full";
export const NETWORK_RAIL_ENV = { user: "NETWORK_RAIL_EMAIL", password: "NETWORK_RAIL_PASSWORD" };
export const GB_SOURCE = "Network Rail open data — GB timetable (contains information of Network Rail Infrastructure Limited)";

/** Train operators by ATOC code, for the train's category. */
const OPERATORS: Record<string, string> = {
  AW: "Transport for Wales",
  CC: "c2c",
  CH: "Chiltern Railways",
  CS: "Caledonian Sleeper",
  EM: "East Midlands Railway",
  GC: "Grand Central",
  GN: "Great Northern",
  GR: "LNER",
  GW: "GWR",
  GX: "Gatwick Express",
  HT: "Hull Trains",
  LE: "Greater Anglia",
  LM: "West Midlands Trains",
  NT: "Northern",
  SE: "Southeastern",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  TL: "Thameslink",
  TP: "TransPennine Express",
  VT: "Avanti West Coast",
  XC: "CrossCountry",
};
/** Heathrow Express, Lumo and Eurostar don't take Interrail. */
const NOT_INTERRAIL = new Set(["HX", "LD", "ES"]);
/** Express passenger trains and sleepers. Stopping trains (OO) would add every local stop pair. */
const CATEGORIES = new Set(["XX", "XZ"]);
const PASSES: Partial<Record<PassId, PassAvailability>> = { interrail: { bookable: true, seat: "unknown" } };

interface Location {
  location_type?: string;
  tiploc_code?: string;
  public_arrival?: string | null;
  public_departure?: string | null;
}

interface Schedule {
  uid: string;
  stp: string;
  start: string;
  end: string;
  days: string;
  trainNo: string;
  operator: string;
  /** False for a train left out (a stopping train, a non-Interrail operator): it still wins its dates. */
  kept: boolean;
  calls: { tiploc: string; arr: number; dep: number }[];
}

/** "0745" or "0745H" → minutes after midnight; null, "" or "0000" on a calling point → no public time. */
function publicMinutes(t: string | null | undefined, allowMidnight: boolean): number | null {
  if (!t || !/^\d{4}/.test(t) || (!allowMidnight && t.startsWith("0000"))) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
}

/** The public calls of a schedule, with times running past midnight kept increasing. */
function publicCalls(locations: Location[]): Schedule["calls"] {
  const out: Schedule["calls"] = [];
  let offset = 0;
  let last = -1;
  const roll = (m: number): number => {
    let t = m + offset;
    if (t < last) {
      offset += 1440;
      t += 1440;
    }
    last = t;
    return t;
  };
  for (const l of locations) {
    const type = l.location_type;
    const first = type === "LO";
    const end = type === "LT";
    const arr = first ? null : publicMinutes(l.public_arrival, end);
    const dep = end ? null : publicMinutes(l.public_departure, first);
    if (arr === null && dep === null) continue;
    const a = roll(arr ?? (dep as number));
    const d = dep === null ? a : roll(dep);
    out.push({ tiploc: l.tiploc_code ?? "", arr: a, dep: d });
  }
  return out;
}

/** Does a schedule apply on this date ("YYYY-MM-DD")? `days` is Monday first. */
function appliesOn(s: Schedule, date: string): boolean {
  if (date < s.start || date > s.end) return false;
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return s.days[weekday] === "1";
}

/** Short-term cancellations, overlays and new schedules win over the permanent one. */
const STP_RANK: Record<string, number> = { C: 0, N: 1, O: 1, P: 2 };

/** Read the gzipped (or plain) SCHEDULE extract into trains running in [from, from + days). */
export async function readNetworkRail(path: string, from: string, days = 31): Promise<Train[]> {
  if (!existsSync(path)) return [];
  const raw = createReadStream(path);
  const input = path.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  const names = new Map<string, string>();
  const byUid = new Map<string, Schedule[]>();
  const until = addDays(from, days - 1);
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.startsWith('{"TiplocV1"')) {
      const t = (JSON.parse(line) as { TiplocV1: { tiploc_code?: string; tps_description?: string; description?: string } }).TiplocV1;
      const name = (t.description || t.tps_description || "").trim();
      if (t.tiploc_code && name) names.set(t.tiploc_code, name);
      continue;
    }
    if (!line.startsWith('{"JsonScheduleV1"')) continue;
    const j = (JSON.parse(line) as { JsonScheduleV1: Record<string, unknown> }).JsonScheduleV1;
    const stp = String(j.CIF_stp_indicator ?? "");
    const start = String(j.schedule_start_date ?? "");
    const end = String(j.schedule_end_date ?? "");
    if (!(stp in STP_RANK) || end < from || start > until) continue;
    const seg = (j.schedule_segment ?? {}) as { CIF_train_category?: string; signalling_id?: string; schedule_location?: Location[] };
    const operator = String(j.atoc_code ?? "");
    // Every schedule is kept for its dates, so an overlay onto a left-out train still hides the
    // permanent one. Cancellations carry no train details.
    const kept = stp !== "C" && CATEGORIES.has(seg.CIF_train_category ?? "") && !NOT_INTERRAIL.has(operator);
    const s: Schedule = {
      uid: String(j.CIF_train_uid ?? ""),
      stp,
      start,
      end,
      days: String(j.schedule_days_runs ?? ""),
      trainNo: seg.signalling_id ?? "",
      operator,
      kept,
      calls: kept ? publicCalls(seg.schedule_location ?? []) : [],
    };
    const list = byUid.get(s.uid);
    if (list) list.push(s);
    else byUid.set(s.uid, [s]);
  }

  const window = Array.from({ length: days }, (_, i) => addDays(from, i));
  const str = interner();
  const out: Train[] = [];
  for (const schedules of byUid.values()) {
    // The dates each schedule is the one in force on.
    const runs = new Map<Schedule, string[]>();
    for (const d of window) {
      let best: Schedule | undefined;
      for (const s of schedules) {
        if (appliesOn(s, d) && (!best || (STP_RANK[s.stp] ?? 9) < (STP_RANK[best.stp] ?? 9))) best = s;
      }
      if (!best?.kept) continue;
      const list = runs.get(best);
      if (list) list.push(d);
      else runs.set(best, [d]);
    }
    for (const [s, dates] of runs) {
      const calls: Call[] = s.calls.map((c, i) => ({ seq: i, station: names.get(c.tiploc) ?? c.tiploc, arr: c.arr, dep: c.dep }));
      const kept = calls.filter((c, i) => c.station !== calls[i - 1]?.station);
      pushStopPairs(out, str, "gb", kept, dates, s.trainNo, OPERATORS[s.operator] ?? s.operator, PASSES);
    }
  }
  return out;
}
