/**
 * Archive today's MAX seat flags from the SNCF feed, so seat odds (by weekday, departure
 * time and days before travel) can be computed later. The feed only shows the current
 * state; anything not archived on the day is lost.
 *
 * One file per day, never overwritten: <out>/YYYY/YYYY-MM-DD.json.gz. Each service
 * (origin, destination, train, departure) is stored once with one character per day of
 * the feed's window: "1" a free MAX seat, "0" full, "." not running that day.
 *
 * Run: npx tsx scripts/archive-max.ts [feed.json] [outDir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import type { SncfRecord } from "../src/operators/sncf";

export interface MaxArchive {
  /** Day the feed was read (UTC), "YYYY-MM-DD". */
  snapshot: string;
  /** First travel day of the window; character i of each service is start + i days. */
  start: string;
  days: number;
  /** [origin, destination, trainNo, depart "HH:MM", per-day flags]. */
  services: [string, string, string, string, string][];
}

const DAY_MS = 86_400_000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function hhmm(v: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : "";
}

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function buildArchive(records: SncfRecord[], snapshot: string): MaxArchive {
  const rows: { key: string; day: number; free: boolean }[] = [];
  for (const r of records) {
    const date = str(r.date);
    const depart = hhmm(r.heure_depart);
    const origin = str(r.origine);
    const destination = str(r.destination);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !depart || !origin || !destination) continue;
    const key = [origin, destination, str(r.train_no), depart].join("\u0000");
    rows.push({ key, day: dayIndex(date), free: str(r.od_happy_card).toUpperCase() === "OUI" });
  }
  if (rows.length === 0) return { snapshot, start: snapshot, days: 0, services: [] };

  // A loop, not Math.min(...rows): the feed has ~360k rows, too many for spread arguments.
  let first = Infinity;
  let last = -Infinity;
  for (const r of rows) {
    first = Math.min(first, r.day);
    last = Math.max(last, r.day);
  }
  const days = last - first + 1;
  const flags = new Map<string, string[]>();
  for (const r of rows) {
    let f = flags.get(r.key);
    if (!f) flags.set(r.key, (f = Array<string>(days).fill(".")));
    // A free seat on any duplicate row wins: the feed never lists a seat it doesn't have.
    if (f[r.day - first] !== "1") f[r.day - first] = r.free ? "1" : "0";
  }

  const services = [...flags]
    .map(([key, f]) => [...(key.split("\u0000") as [string, string, string, string]), f.join("")] as MaxArchive["services"][number])
    .sort((a, b) => a.join("|").localeCompare(b.join("|")));
  return { snapshot, start: new Date(first * DAY_MS).toISOString().slice(0, 10), days, services };
}

/** Write the day's archive; returns the path, or null when that day is already archived. */
export function writeArchive(archive: MaxArchive, outDir: string): string | null {
  const path = join(outDir, archive.snapshot.slice(0, 4), `${archive.snapshot}.json.gz`);
  if (existsSync(path)) return null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(JSON.stringify(archive)));
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const feed = resolve(process.argv[2] ?? "data/raw/sncf-tgvmax.json");
  const outDir = resolve(process.argv[3] ?? "data/archive");
  const records = JSON.parse(readFileSync(feed, "utf-8")) as SncfRecord[];
  if (!Array.isArray(records) || records.length === 0) throw new Error(`no records in ${feed}`);
  const archive = buildArchive(records, new Date().toISOString().slice(0, 10));
  const path = writeArchive(archive, outDir);
  console.log(
    path
      ? `[archive] ${archive.services.length} services over ${archive.days} days → ${path}`
      : `[archive] ${archive.snapshot} is already archived, left as is`,
  );
}
