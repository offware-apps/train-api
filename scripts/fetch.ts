/**
 * Download every source to data/raw/ (git-ignored):
 *   data/raw/sncf-tgvmax.json    the SNCF feed
 *   data/raw/<operator>/*.txt    each GTFS operator's feed, unzipped
 * Retries with backoff and never overwrites a good file with an empty or malformed
 * response. A GTFS operator that can't be fetched is skipped (the build leaves it out);
 * the run fails only when nothing at all could be fetched.
 * Run: npm run fetch
 */
import { execFileSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { dirname, join, resolve } from "node:path";
import { GTFS_OPERATORS } from "../src/operators";
import { SNCF_FEED_URL } from "../src/operators/sncf";

const RAW = resolve("data/raw");
const TRIES = 3;

async function withRetries<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= TRIES; i++) {
    try {
      return await run();
    } catch (err) {
      last = err;
      console.error(`[fetch] ${what}: attempt ${i}/${TRIES} failed: ${String(err)}`);
      if (i < TRIES) await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
  throw last;
}

async function fetchSncf(): Promise<void> {
  const rows = await withRetries("sncf", async () => {
    const res = await fetch(SNCF_FEED_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length === 0) throw new Error("expected a non-empty JSON array");
    return body;
  });
  const out = join(RAW, "sncf-tgvmax.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rows), "utf-8");
  console.log(`[fetch] sncf: ${rows.length} records → ${out}`);
}

/** Files no reader uses; shapes.txt alone runs to gigabytes in some national feeds. */
const UNUSED = ["shapes.txt", "transfers.txt", "frequencies.txt", "pathways.txt", "levels.txt", "translations.txt"];

async function fetchGtfs(id: string, url: string, headers?: Record<string, string>): Promise<void> {
  const tmp = join(RAW, `${id}.zip`);
  const dir = join(RAW, id);
  const next = `${dir}.new`;
  mkdirSync(RAW, { recursive: true });
  // Streamed to disk: national feeds run to hundreds of MB.
  const bytes = await withRetries(id, async () => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(900_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp));
    const head = Buffer.alloc(2);
    const fd = openSync(tmp, "r");
    readSync(fd, head, 0, 2, 0);
    closeSync(fd);
    const size = statSync(tmp).size;
    // "PK": a zip archive, not an error page.
    if (size < 100 || head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("not a zip archive");
    return size;
  });
  rmSync(next, { recursive: true, force: true });
  execFileSync("unzip", ["-q", "-o", tmp, "-d", next, "-x", ...UNUSED], { stdio: ["ignore", "inherit", "ignore"] });
  rmSync(tmp, { force: true });
  if (!existsSync(join(next, "stop_times.txt"))) throw new Error(`${id}: the archive has no stop_times.txt`);
  rmSync(dir, { recursive: true, force: true });
  execFileSync("mv", [next, dir]);
  console.log(`[fetch] ${id}: ${(bytes / 1e6).toFixed(1)} MB → ${dir}`);
}

let ok = 0;
const jobs: [string, () => Promise<void>][] = [
  ["sncf", fetchSncf],
  ...GTFS_OPERATORS.map(({ op, url, headers }): [string, () => Promise<void>] => [op.id, () => fetchGtfs(op.id, url, headers)]),
];
for (const [id, job] of jobs) {
  try {
    await job();
    ok++;
  } catch (err) {
    console.error(`[fetch] ${id}: skipped (${String(err)})`);
  }
}
if (ok === 0) process.exit(1);
