/**
 * Build the static API from a feed file already on disk (default: data/raw/sncf-tgvmax.json,
 * which `npm run fetch` downloads) into public/. Run: npm run build:api [-- <feed.json>]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildIndex, buildOperatorApi } from "../src/api";
import { mapSncfFeed } from "../src/operators/sncf";

const feedPath = resolve(process.argv[2] ?? "data/raw/sncf-tgvmax.json");
const outDir = resolve("public");

const raw: unknown = JSON.parse(readFileSync(feedPath, "utf-8"));
if (!Array.isArray(raw) || raw.length === 0) {
  console.error(`[build-api] ${feedPath} is not a non-empty array.`);
  process.exit(1);
}
const trains = mapSncfFeed(raw);
const updatedAt = new Date().toISOString();
const sncf = buildOperatorApi("sncf", "SNCF Open Data — tgvmax (Licence Ouverte)", trains);
const files = [...sncf.files, buildIndex(updatedAt, [sncf.entry])];

rmSync(join(outDir, "v1"), { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const p = join(outDir, f.path);
  mkdirSync(dirname(p), { recursive: true });
  const text = JSON.stringify(f.body);
  bytes += text.length;
  writeFileSync(p, text, "utf-8");
}
console.log(
  `[build-api] ${raw.length} records → ${trains.length} trains → ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${outDir}`,
);
for (const p of sncf.entry.passes) console.log(`[build-api]   ${p.id}: ${p.trainCount} bookable trains`);
