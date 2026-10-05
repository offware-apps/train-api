/**
 * Download the SNCF feed to data/raw/sncf-tgvmax.json (git-ignored). Retries with backoff
 * and never overwrites a good file with an empty or malformed response.
 * Run: npm run fetch
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SNCF_FEED_URL } from "../src/operators/sncf";

const OUT = resolve("data/raw/sncf-tgvmax.json");
const TRIES = 3;

async function download(): Promise<unknown[]> {
  let last: unknown;
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await fetch(SNCF_FEED_URL, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!Array.isArray(body) || body.length === 0) throw new Error("expected a non-empty JSON array");
      return body;
    } catch (err) {
      last = err;
      console.error(`[fetch] attempt ${i}/${TRIES} failed: ${String(err)}`);
      if (i < TRIES) await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
  throw last;
}

const rows = await download();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rows), "utf-8");
console.log(`[fetch] ${rows.length} records → ${OUT}`);
