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
import { NETWORK_RAIL_ENV, NETWORK_RAIL_URL } from "../src/operators/gb";
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

/** Stream `url` to `out`, retrying; `ok` checks the file's first bytes. Returns its size. */
async function download(
  id: string,
  url: string,
  out: string,
  ok: (head: Buffer) => boolean,
  headers?: Record<string, string>,
): Promise<number> {
  mkdirSync(dirname(out), { recursive: true });
  return withRetries(id, async () => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(900_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(out));
    const size = statSync(out).size;
    // Not an error page.
    if (size < 100 || !ok(firstBytes(out))) throw new Error("unexpected file type");
    return size;
  });
}

function firstBytes(path: string): Buffer {
  const head = Buffer.alloc(2);
  const fd = openSync(path, "r");
  readSync(fd, head, 0, 2, 0);
  closeSync(fd);
  return head;
}

const isZip = (h: Buffer): boolean => h[0] === 0x50 && h[1] === 0x4b;
const isGzip = (h: Buffer): boolean => h[0] === 0x1f && h[1] === 0x8b;

async function fetchGtfs(id: string, url: string, headers?: Record<string, string>): Promise<void> {
  const tmp = join(RAW, `${id}.zip`);
  const dir = join(RAW, id);
  const next = `${dir}.new`;
  // Streamed to disk: national feeds run to hundreds of MB. "PK": a zip archive.
  const bytes = await download(id, url, tmp, isZip, headers);
  rmSync(next, { recursive: true, force: true });
  execFileSync("unzip", ["-q", "-o", tmp, "-d", next, "-x", ...UNUSED], { stdio: ["ignore", "inherit", "ignore"] });
  rmSync(tmp, { force: true });
  if (!existsSync(join(next, "stop_times.txt"))) throw new Error(`${id}: the archive has no stop_times.txt`);
  rmSync(dir, { recursive: true, force: true });
  execFileSync("mv", [next, dir]);
  console.log(`[fetch] ${id}: ${(bytes / 1e6).toFixed(1)} MB → ${dir}`);
}

/** A source behind a sign-up whose key isn't set: skipped quietly, not an error. */
class Missing extends Error {}

/** Great Britain: Network Rail's daily full SCHEDULE extract, behind a free account. */
async function fetchGb(): Promise<void> {
  const user = process.env[NETWORK_RAIL_ENV.user];
  const password = process.env[NETWORK_RAIL_ENV.password];
  if (!user || !password) throw new Missing(`${NETWORK_RAIL_ENV.user} and ${NETWORK_RAIL_ENV.password}`);
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  // The answer redirects to a signed download URL; fetch drops the credentials on the way.
  const tmp = join(RAW, "gb-schedule.new");
  const bytes = await download("gb", NETWORK_RAIL_URL, tmp, (h) => isGzip(h) || h[0] === 0x7b, { Authorization: auth });
  // Gzipped as published, or already inflated if the host sent it with Content-Encoding.
  const gzipped = isGzip(firstBytes(tmp));
  const out = join(RAW, gzipped ? "gb-schedule.json.gz" : "gb-schedule.json");
  rmSync(join(RAW, "gb-schedule.json.gz"), { force: true });
  rmSync(join(RAW, "gb-schedule.json"), { force: true });
  execFileSync("mv", [tmp, out]);
  console.log(`[fetch] gb: ${(bytes / 1e6).toFixed(1)} MB → ${out}`);
}

let ok = 0;
const jobs: [string, () => Promise<void>][] = [
  ["sncf", fetchSncf],
  ...GTFS_OPERATORS.map(({ op, url, headers, keyEnv }): [string, () => Promise<void>] => [
    op.id,
    () => {
      const key = keyEnv ? process.env[keyEnv] : undefined;
      if (keyEnv && !key) throw new Missing(keyEnv);
      return fetchGtfs(op.id, key ? url.replace("{key}", encodeURIComponent(key)) : url, headers);
    },
  ]),
  ["gb", fetchGb],
];
for (const [id, job] of jobs) {
  try {
    await job();
    ok++;
  } catch (err) {
    if (err instanceof Missing) console.log(`[fetch] ${id}: no ${err.message} set; left out.`);
    else console.error(`[fetch] ${id}: skipped (${String(err)})`);
  }
}
if (ok === 0) process.exit(1);
