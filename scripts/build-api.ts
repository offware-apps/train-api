/**
 * Build the static API into public/ from the sources on disk (see `npm run fetch`):
 *   data/raw/sncf-tgvmax.json, or the feed file given as the first argument
 *   data/raw/<operator>/       each GTFS operator, or `--gtfs <operator>=<dir>`
 * `--from YYYY-MM-DD` sets the first day of the GTFS window (default: today, UTC).
 * Sources that are missing are left out; the build fails only when none is there.
 * Run: npm run build:api [-- <feed.json>] [--gtfs renfe=<dir>] [--from <date>]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildIndex, buildOperatorApi, type ApiFile, type ApiIndex } from "../src/api";
import { readGtfs } from "../src/gtfs";
import { GTFS_OPERATORS } from "../src/operators";
import { mapSncfFeed } from "../src/operators/sncf";

const args = process.argv.slice(2);
const gtfsDirs = new Map<string, string>();
let feedArg: string | undefined;
let from = new Date().toISOString().slice(0, 10);
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a === "--gtfs") {
    const [id, dir] = (args[++i] ?? "").split("=");
    if (id && dir) gtfsDirs.set(id, resolve(dir));
  } else if (a === "--from") from = args[++i] ?? from;
  else feedArg = a;
}
const outDir = resolve("public");
const files: ApiFile[] = [];
const entries: ApiIndex["operators"] = [];
const counts: string[] = [];

const feedPath = resolve(feedArg ?? "data/raw/sncf-tgvmax.json");
if (existsSync(feedPath)) {
  const raw: unknown = JSON.parse(readFileSync(feedPath, "utf-8"));
  if (Array.isArray(raw) && raw.length > 0) {
    const sncf = buildOperatorApi("sncf", "SNCF Open Data — tgvmax (Licence Ouverte)", mapSncfFeed(raw));
    files.push(...sncf.files);
    entries.push(sncf.entry);
  } else console.error(`[build-api] ${feedPath} is not a non-empty array; SNCF left out.`);
} else console.error(`[build-api] no SNCF feed at ${feedPath}; SNCF left out.`);

for (const { op } of GTFS_OPERATORS) {
  const dir = gtfsDirs.get(op.id) ?? resolve("data/raw", op.id);
  if (!existsSync(join(dir, "stop_times.txt"))) {
    if (gtfsDirs.size === 0 || gtfsDirs.has(op.id)) console.error(`[build-api] no ${op.id} feed at ${dir}; left out.`);
    continue;
  }
  const trains = await readGtfs(dir, op, from);
  if (trains.length === 0) {
    console.error(`[build-api] ${op.id}: no trains from ${from}; left out.`);
    continue;
  }
  const built = buildOperatorApi(op.id, op.source, trains);
  files.push(...built.files);
  entries.push(built.entry);
}

if (entries.length === 0) {
  console.error("[build-api] no source to publish.");
  process.exit(1);
}
files.push(buildIndex(new Date().toISOString(), entries));

rmSync(join(outDir, "v1"), { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const p = join(outDir, f.path);
  mkdirSync(dirname(p), { recursive: true });
  const text = JSON.stringify(f.body);
  bytes += text.length;
  writeFileSync(p, text, "utf-8");
}
console.log(`[build-api] ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${outDir}`);
for (const e of entries) {
  for (const p of e.passes) counts.push(`${e.id}/${p.id}: ${p.trainCount} trains, ${e.stationCount} stations`);
}
for (const c of counts) console.log(`[build-api]   ${c}`);
