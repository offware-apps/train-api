/**
 * How big is every train in Europe? Reads the European feeds Transitous republishes
 * (https://api.transitous.org/gtfs/, which asks reusers to download from there), keeps the
 * rail routes, and prints per country the trips, stations and bundle size, then how long
 * the search engine takes to load them all and answer. It sizes the search server.
 *
 *   npm run probe:europe                 download the feeds one at a time
 *   npm run probe:europe -- <folder>     read zips already downloaded there
 *
 * PROBE_FROM (default today) and PROBE_DAYS (default 31) set the window; PROBE_ONLY=fr,es limits the countries.
 * PROBE_PAIRS="Madrid,Valencia;Lyon,Annecy" sets the searches timed.
 * Writes data/probe/<country>.json and a Markdown summary (also to $GITHUB_STEP_SUMMARY).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { gzipSync } from "node:zlib";
import { encodeBundle, type Bundle } from "../src/bundle";
import type { Trip } from "../src/format";
import { addDays, readGtfsTimetable, type GtfsOperator } from "../src/gtfs";
import { Network } from "../src/search";

const MIRROR = "https://api.transitous.org/gtfs/";
const HEADERS = { "User-Agent": "train-api probe (https://github.com/offware-apps/train-api)" };
const OUT = resolve("data/probe");
const WORK = resolve("data/probe-raw");
const DAYS = Number(process.env.PROBE_DAYS ?? 31);
const ONLY = new Set((process.env.PROBE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));

/** The 33 Interrail countries, by the region code Transitous files start with; "eu" holds cross-border feeds. */
const COUNTRIES: Record<string, string> = {
  at: "Austria", be: "Belgium", ba: "Bosnia and Herzegovina", bg: "Bulgaria", hr: "Croatia", cz: "Czechia",
  dk: "Denmark", ee: "Estonia", fi: "Finland", fr: "France", de: "Germany", gb: "Great Britain", gr: "Greece",
  hu: "Hungary", ie: "Ireland", it: "Italy", lv: "Latvia", lt: "Lithuania", lu: "Luxembourg", me: "Montenegro",
  nl: "Netherlands", mk: "North Macedonia", no: "Norway", pl: "Poland", pt: "Portugal", ro: "Romania",
  rs: "Serbia", sk: "Slovakia", si: "Slovenia", es: "Spain", se: "Sweden", ch: "Switzerland", tr: "Turkey",
  eu: "Cross-border",
};

/** Files no reader uses; shapes.txt alone runs to gigabytes in some national feeds. */
const UNUSED = ["shapes.txt", "transfers.txt", "frequencies.txt", "pathways.txt", "levels.txt", "translations.txt", "fare_*.txt"];

/** GTFS rail: 2, and the extended railway types 100–117. Trams, metros and buses are left out. */
function isRail(routeType: string): boolean {
  const t = Number(routeType);
  return t === 2 || (t >= 100 && t <= 117);
}

const rail = (id: string): GtfsOperator => ({
  id,
  source: "Transitous",
  route: (r) => (isRail(r.route_type ?? "") ? ((r.route_short_name ?? "").trim().split(/\s+/)[0] ?? "") || "train" : null),
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
});

/** Every zip the mirror lists, following its folders one level down. */
async function listMirror(): Promise<string[]> {
  const page = async (url: string): Promise<string[]> => {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    const links = [...html.matchAll(/href="([^"?#]+)"/g)].map((m) => new URL(m[1] as string, url).href).filter((u) => u.startsWith(url) && u !== url);
    if (links.length === 0) console.log(`[probe] ${url} lists no links; it starts:\n${html.slice(0, 2000)}`);
    return links;
  };
  const top = await page(MIRROR);
  const zips = top.filter((u) => u.endsWith(".zip"));
  for (const dir of top.filter((u) => u.endsWith("/"))) zips.push(...(await page(dir)).filter((u) => u.endsWith(".zip")));
  return [...new Set(zips)];
}

/** "de_DELFI.gtfs.zip" → "de"; null for a region outside the 33 countries. */
function countryOf(file: string): string | null {
  const code = /^([a-z]{2})[_-]/i.exec(file)?.[1]?.toLowerCase();
  const c = code === "uk" ? "gb" : code;
  return c && c in COUNTRIES ? c : null;
}

const mb = (n: number): string => (n / 1e6).toFixed(1);
const secs = (ms: number): string => (ms / 1000).toFixed(1);

async function download(url: string, out: string): Promise<number> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(1_800_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(out));
      return statSync(out).size;
    } catch (err) {
      if (i >= 3) throw err;
      console.error(`[probe] ${url}: attempt ${i} failed (${String(err)})`);
      await new Promise((r) => setTimeout(r, 5_000 * i));
    }
  }
}

interface FeedRow {
  file: string;
  country: string;
  zipBytes: number;
  trips: number;
  readMs: number;
  error?: string;
}

const from = process.env.PROBE_FROM ?? new Date().toISOString().slice(0, 10);
const local = process.argv[2] ? resolve(process.argv[2]) : null;
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const sources = local
  ? readdirSync(local).filter((f) => f.endsWith(".zip")).map((f) => join(local, f))
  : await listMirror();
const byCountry = new Map<string, string[]>();
const skipped: string[] = [];
for (const s of sources) {
  const file = s.split("/").pop() as string;
  const c = countryOf(file);
  if (!c || (ONLY.size > 0 && !ONLY.has(c))) {
    skipped.push(file);
    continue;
  }
  byCountry.set(c, [...(byCountry.get(c) ?? []), s]);
}
console.log(`[probe] ${sources.length} feeds listed, ${sources.length - skipped.length} in ${byCountry.size} countries; window ${from} + ${DAYS} days`);
if (skipped.length) console.log(`[probe] other regions: ${skipped.join(", ")}`);

const feeds: FeedRow[] = [];
const summary: { country: string; feeds: number; trips: number; variants: number; stations: number; located: number; bytes: number; gz: number }[] = [];
const t0 = Date.now();
for (const [country, list] of [...byCountry].sort()) {
  const trips: Trip[] = [];
  const coords = new Map<string, [number, number]>();
  for (const src of list) {
    const file = src.split("/").pop() as string;
    const row: FeedRow = { file, country, zipBytes: 0, trips: 0, readMs: 0 };
    feeds.push(row);
    const zip = local ? src : join(WORK, file);
    const dir = join(WORK, file.replace(/\.zip$/, ""));
    try {
      row.zipBytes = local ? statSync(src).size : await download(src, zip);
      rmSync(dir, { recursive: true, force: true });
      // unzip exits 11 when an excluded name matches nothing; the files are out all the same.
      try {
        execFileSync("unzip", ["-q", "-o", "-j", zip, "-d", dir, "-x", ...UNUSED.map((u) => `*${u}`)], { stdio: "ignore" });
      } catch (err) {
        if (!existsSync(join(dir, "stop_times.txt"))) throw err;
      }
      if (!local) rmSync(zip, { force: true });
      const t = Date.now();
      const tt = await readGtfsTimetable(dir, rail(country), from, DAYS, { v1: false });
      row.readMs = Date.now() - t;
      row.trips = tt.trips.length;
      for (const trip of tt.trips) trips.push(trip);
      for (const [name, at] of tt.coords) if (!coords.has(name)) coords.set(name, at);
    } catch (err) {
      row.error = String(err).slice(0, 200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (!local) rmSync(zip, { force: true });
    }
    console.log(
      `[probe] ${country} ${file}: ${mb(row.zipBytes)} MB zip, ${row.trips} rail trips, read in ${secs(row.readMs)} s${row.error ? `, FAILED ${row.error}` : ""}`,
    );
  }
  if (trips.length === 0) continue;
  const bundle = encodeBundle(country, "interrail", trips, coords);
  const json = JSON.stringify(bundle);
  writeFileSync(join(OUT, `${country}.json`), json);
  const row = {
    country,
    feeds: list.length,
    trips: trips.length,
    variants: bundle.trips.length,
    stations: bundle.stations.length,
    located: bundle.stations.filter((s) => s[1] !== null).length,
    bytes: json.length,
    gz: gzipSync(json).length,
  };
  summary.push(row);
  console.log(`[probe] ${country}: ${row.variants} trips in the bundle, ${row.stations} stations (${row.located} located), ${mb(row.bytes)} MB, ${mb(row.gz)} MB gzipped`);
}
const readAll = Date.now() - t0;

// The engine over every country, as a server would hold it.
const memory = (): string => {
  global.gc?.();
  const m = process.memoryUsage();
  return `heap ${mb(m.heapUsed)} MB, rss ${mb(m.rss)} MB`;
};
const before = memory();
const t1 = Date.now();
const bundles = summary.map((s) => JSON.parse(readFileSync(join(OUT, `${s.country}.json`), "utf-8")) as Bundle);
const parseMs = Date.now() - t1;
const t2 = Date.now();
const net = new Network(bundles, { utcOffsets: { tr: 120 } });
const buildMs = Date.now() - t2;
const loaded = memory();

const day = addDays(from, 1);
const PAIRS: [string, string][] = process.env.PROBE_PAIRS
  ? process.env.PROBE_PAIRS.split(";").map((p) => p.split(",") as [string, string])
  : [
  ["Paris", "Berlin"],
  ["Madrid", "Warszawa"],
  ["Lisboa", "Helsinki"],
  ["Amsterdam", "Roma"],
  ["Zürich", "Budapest"],
  ["Bruxelles", "København"],
  ["Lyon", "Annecy"],
  ["München", "Garmisch-Partenkirchen"],
];
const searches: string[] = [];
for (const [a, b] of PAIRS) {
  const from = net.resolve(a);
  const to = net.resolve(b);
  if (!from || !to) {
    searches.push(`| ${a} → ${b} | ${from ? "" : `no "${a}"`} ${to ? "" : `no "${b}"`} | | | |`);
    continue;
  }
  const times: number[] = [];
  let found: ReturnType<Network["journeys"]> = [];
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    found = net.journeys(from, to, day, { maxTrains: 6 });
    times.push(Date.now() - t);
  }
  const best = found.reduce<(typeof found)[number] | undefined>((x, j) => (!x || j.duration < x.duration ? j : x), undefined);
  const route = best ? `${Math.floor(best.duration / 60)}h${String(best.duration % 60).padStart(2, "0")}, ${best.legs.length} trains` : "none";
  searches.push(`| ${from.name} → ${to.name} | ${found.length} | ${route} | ${times[0]} ms | ${times[1]} ms |`);
}
const firstDay = (() => {
  const t = Date.now();
  const p = net.resolve("Paris");
  const b = net.resolve("Berlin");
  if (p && b) net.journeys(p, b, addDays(from, 3), { maxTrains: 6 });
  return Date.now() - t;
})();
const paris = net.resolve("Paris");
const t4 = Date.now();
const reach = paris ? net.reachable(paris, day, { maxTrains: 4, step: 120 }) : new Map();
const reachMs = Date.now() - t4;
const searched = memory();

const total = summary.reduce((n, s) => ({ trips: n.trips + s.variants, stations: n.stations + s.stations, bytes: n.bytes + s.bytes, gz: n.gz + s.gz }), {
  trips: 0,
  stations: 0,
  bytes: 0,
  gz: 0,
});
const lines = [
  `## Every train in Europe: probe of ${from} + ${DAYS} days`,
  "",
  `${feeds.length} feeds read in ${secs(readAll)} s; ${feeds.filter((f) => f.error).length} failed.`,
  "",
  "| Country | Feeds | Trips | Stations (located) | Bundle MB | Gzipped MB |",
  "|---|---|---|---|---|---|",
  ...summary.map((s) => `| ${COUNTRIES[s.country]} | ${s.feeds} | ${s.variants} | ${s.stations} (${s.located}) | ${mb(s.bytes)} | ${mb(s.gz)} |`),
  `| **All** | ${feeds.length} | ${total.trips} | ${total.stations} | ${mb(total.bytes)} | ${mb(total.gz)} |`,
  "",
  `Missing countries: ${Object.keys(COUNTRIES).filter((c) => !summary.some((s) => s.country === c)).map((c) => COUNTRIES[c]).join(", ") || "none"}.`,
  "",
  "### Engine over every country",
  "",
  `- Memory before loading: ${before}.`,
  `- Parse every bundle: ${secs(parseMs)} s. Build the network: ${secs(buildMs)} s, ${net.places.length} places. Then ${loaded}.`,
  `- The first search below also builds that day's timetable. Paris → Berlin on another day, built afresh: ${firstDay} ms.`,
  `- Everything reachable from Paris in a day, up to 4 trains: ${reach.size} places in ${reachMs} ms. Then ${searched}.`,
  "",
  "| Search, tomorrow, up to 6 trains | Journeys | Fastest | First run | Again |",
  "|---|---|---|---|---|",
  ...searches,
  "",
  "### Feeds",
  "",
  "| Feed | Zip MB | Rail trips | Read s | Error |",
  "|---|---|---|---|---|",
  ...feeds.map((f) => `| ${f.file} | ${mb(f.zipBytes)} | ${f.trips} | ${secs(f.readMs)} | ${f.error ?? ""} |`),
];
const md = lines.join("\n");
console.log(`\n${md}`);
writeFileSync(join(OUT, "summary.md"), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
rmSync(WORK, { recursive: true, force: true });
