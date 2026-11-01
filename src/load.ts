/**
 * Load trip bundles (v2) for the search, from a published API (a URL) or from a folder of
 * the same files on disk (`public/v2` after `npm run build:api`, or a download). Node only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApiIndexV2 } from "./api";
import type { SearchBundle } from "./search";

export const DEFAULT_API = "https://offware-apps.github.io/train-api/v2/";

async function getJson<T>(base: string, path: string): Promise<T> {
  if (/^https?:\/\//.test(base)) {
    const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  }
  return JSON.parse(await readFile(join(base, path), "utf-8")) as T;
}

export interface Loaded {
  index: ApiIndexV2;
  bundles: SearchBundle[];
  /** Attribution per operator, for responses. */
  sources: Map<string, string>;
}

/**
 * The index, then the bundle of each operator that publishes the pass (all of them, or
 * those in `operators`). An operator that fails to load is skipped.
 */
export async function loadBundles(base = DEFAULT_API, { pass = "interrail", operators }: { pass?: string; operators?: string[] } = {}): Promise<Loaded> {
  const index = await getJson<ApiIndexV2>(base, "index.json");
  const wanted = index.operators.filter(
    (o) => o.passes.some((p) => p.id === pass) && (!operators?.length || operators.includes(o.id)),
  );
  const loaded = await Promise.all(
    wanted.map(async (o) => {
      try {
        return await getJson<SearchBundle>(base, `${o.id}/${pass}.json`);
      } catch (err) {
        console.error(`[load] ${o.id}: skipped (${String(err)})`);
        return null;
      }
    }),
  );
  return {
    index,
    bundles: loaded.filter((b): b is SearchBundle => b !== null),
    sources: new Map(index.operators.map((o) => [o.id, o.source])),
  };
}
