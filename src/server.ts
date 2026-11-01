/**
 * The journey search as an HTTP API, to run anywhere Node or a container runs:
 *
 *   GET /v2/places?q=madr                                   towns and stations matching a name
 *   GET /v2/journeys?from=madrid&to=amsterdam&date=2026-10-12[&time=08:00][&results=5][&maxTrains=4]
 *   GET /v2/reachable?from=madrid&date=2026-10-12[&time=06:00]   every place reachable that day, fastest journey each
 *   GET /health
 *
 * No key, CORS open. It loads the trip bundles from TRAIN_API (the public API by default,
 * or a folder such as public/v2) and reloads them every RELOAD_HOURS.
 * Configuration: PORT (8080), TRAIN_API, OPERATORS (comma-separated, default all),
 * PASS (interrail), RELOAD_HOURS (6).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DEFAULT_API, loadBundles, type Loaded } from "./load";
import { Network } from "./search";

export interface State {
  network: Network;
  loaded: Loaded;
}

const JSON_TYPE = "application/json; charset=utf-8";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": JSON_TYPE, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Handle one request. Exported for tests. */
export function handle(req: IncomingMessage, res: ServerResponse, state: State | null): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" });
    res.end();
    return;
  }
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  if (path === "/health") return send(res, state ? 200 : 503, { ok: !!state, timetables: state?.loaded.index.updatedAt ?? null });
  if (path === "/") {
    return send(res, 200, {
      name: "train-api journey search",
      endpoints: [
        "/v2/places?q=madr",
        "/v2/journeys?from=madrid&to=amsterdam&date=YYYY-MM-DD&time=08:00",
        "/v2/reachable?from=madrid&date=YYYY-MM-DD",
      ],
      source: "https://github.com/offware-apps/train-api",
    });
  }
  if (!state) return send(res, 503, { error: "timetables are loading" });
  const { network, loaded } = state;

  if (path === "/v2/places") {
    const q = url.searchParams.get("q") ?? "";
    const places = network.find(q, 10).map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      stations: m.places.flatMap((i) => network.places[i]?.stations ?? []),
    }));
    return send(res, 200, { places });
  }
  if (path === "/v2/reachable") {
    const fromQ = url.searchParams.get("from") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const time = url.searchParams.get("time") ?? undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) {
      return send(res, 400, { error: "date must be YYYY-MM-DD and time HH:MM" });
    }
    const from = network.resolve(fromQ);
    if (!from) return send(res, 404, { error: `unknown place: ${fromQ}` });
    const maxTrains = Math.min(4, Math.max(1, Number(url.searchParams.get("maxTrains") ?? 3) || 3));
    const reach = network.reachable(from, date, { time, maxTrains });
    const places = [...reach]
      .map(([i, journey]) => {
        const p = network.places[i];
        return { place: { id: p?.id, name: p?.name, lat: p?.lat, lon: p?.lon }, journey };
      })
      .sort((a, b) => a.journey.duration - b.journey.duration);
    const used = new Set(places.flatMap((r) => r.journey.legs.map((l) => l.operator)));
    return send(res, 200, {
      from: { id: from.id, name: from.name, kind: from.kind },
      date,
      places,
      sources: [...used].map((op) => loaded.sources.get(op) ?? op),
      timetables: loaded.index.updatedAt,
    });
  }
  if (path === "/v2/journeys") {
    const fromQ = url.searchParams.get("from") ?? "";
    const toQ = url.searchParams.get("to") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const time = url.searchParams.get("time") ?? undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) {
      return send(res, 400, { error: "date must be YYYY-MM-DD and time HH:MM" });
    }
    const from = network.resolve(fromQ);
    const to = network.resolve(toQ);
    if (!from || !to) return send(res, 404, { error: `unknown place: ${from ? toQ : fromQ}` });
    const results = Math.min(10, Math.max(1, Number(url.searchParams.get("results") ?? 5) || 5));
    const maxTrains = Math.min(6, Math.max(1, Number(url.searchParams.get("maxTrains") ?? 4) || 4));
    const journeys = network.journeys(from, to, date, { time, results, maxTrains });
    const used = new Set(journeys.flatMap((j) => j.legs.map((l) => l.operator)));
    return send(res, 200, {
      from: { id: from.id, name: from.name, kind: from.kind },
      to: { id: to.id, name: to.name, kind: to.kind },
      date,
      journeys,
      // Attribution the open data licences ask for.
      sources: [...used].map((op) => loaded.sources.get(op) ?? op),
      timetables: loaded.index.updatedAt,
    });
  }
  return send(res, 404, { error: "not found" });
}

async function main(): Promise<void> {
  const base = process.env.TRAIN_API ?? DEFAULT_API;
  const operators = process.env.OPERATORS?.split(",").map((s) => s.trim()).filter(Boolean);
  const pass = process.env.PASS ?? "interrail";
  let state: State | null = null;
  const reload = async (): Promise<void> => {
    try {
      const loaded = await loadBundles(base, { pass, operators });
      if (state && state.loaded.index.updatedAt === loaded.index.updatedAt) return;
      const t = Date.now();
      state = { network: new Network(loaded.bundles), loaded };
      console.log(
        `[server] timetables ${loaded.index.updatedAt}: ${loaded.bundles.map((b) => b.operator).join(", ")}; ` +
          `${state.network.places.length} places, indexed in ${Date.now() - t} ms`,
      );
    } catch (err) {
      console.error(`[server] load failed, keeping the current timetables: ${String(err)}`);
    }
  };
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    try {
      handle(req, res, state);
    } catch (err) {
      console.error(`[server] ${req.method} ${req.url}: ${String(err)}`);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  }).listen(port, () => console.log(`[server] listening on :${port}`));
  await reload();
  setInterval(() => void reload(), Number(process.env.RELOAD_HOURS ?? 6) * 3600 * 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
