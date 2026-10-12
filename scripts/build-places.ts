/**
 * Write public/v1/places.json: the town or city each station is in (see src/places.ts).
 * Runs after `npm run build:api`, whose stations.json files it reads.
 *
 * It reads the places dataset's index.json, or a saved copy with `--index <file>`. When the
 * dataset can't be reached it writes nothing and exits cleanly: the timetables still publish.
 *
 * Run: npm run build:places [-- --index <index.json>]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLACES_BASE, buildStationPlaces, type PlacesIndex, type StationRef } from "../src/places";

const args = process.argv.slice(2);
const indexArg = args.includes("--index") ? args[args.indexOf("--index") + 1] : undefined;
const base = process.env.PLACES_BASE ?? PLACES_BASE;
const v1 = resolve("public/v1");

function readStations(): StationRef[] {
  if (!existsSync(v1)) return [];
  const out: StationRef[] = [];
  for (const op of readdirSync(v1)) {
    const file = join(v1, op, "stations.json");
    if (!existsSync(file)) continue;
    for (const s of JSON.parse(readFileSync(file, "utf-8")) as { id: string; name: string }[]) {
      out.push({ operator: op, id: s.id, name: s.name });
    }
  }
  return out;
}

async function readIndex(): Promise<PlacesIndex> {
  if (indexArg) return JSON.parse(readFileSync(resolve(indexArg), "utf-8")) as PlacesIndex;
  const res = await fetch(`${base}/index.json`, {
    headers: { "User-Agent": "train-api/0.1 (https://github.com/offware-apps/train-api)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PlacesIndex;
}

const stations = readStations();
if (stations.length === 0) {
  console.error("[places] no stations.json under public/v1; run `npm run build:api` first.");
  process.exit(1);
}

let index: PlacesIndex;
try {
  index = await readIndex();
  // Only a CC0 dataset is republished here, with its attribution.
  if (index.license !== "CC0-1.0" || !Array.isArray(index.places)) throw new Error("unexpected shape or licence");
} catch (err) {
  console.error(`[places] places dataset not read, places.json left out (${String(err)})`);
  process.exit(0);
}

const out = buildStationPlaces(index, stations, new Date().toISOString(), base);
writeFileSync(join(v1, "places.json"), JSON.stringify(out), "utf-8");
console.log(`[places] ${Object.keys(out.stations).length} of ${stations.length} stations matched to a place`);
