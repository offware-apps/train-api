import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexV2, buildOperatorBundles } from "../src/api";
import type { Trip } from "../src/format";
import { loadBundles } from "../src/load";
import { Network } from "../src/search";
import { handle, type State } from "../src/server";

const INTERRAIL = { interrail: { bookable: true, seat: "unknown" as const } };
const trip = (operator: string, trainNo: string, stops: [string, number][]): Trip => ({
  operator,
  trainNo,
  category: "X",
  dates: ["2026-10-12"],
  stops: stops.map(([station, t]) => ({ station, arr: t, dep: t })),
  passes: INTERRAIL,
});

/** A v2 folder as build-api writes it: index, then each operator's files. */
function writeApi(): string {
  const dir = mkdtempSync(join(tmpdir(), "train-api-v2-"));
  const renfe = buildOperatorBundles(
    "renfe",
    "Renfe (CC BY 4.0)",
    [trip("renfe", "03071", [["Madrid-Puerta de Atocha", 465], ["Barcelona-Sants", 610]])],
    new Map([
      ["Madrid-Puerta de Atocha", [40.4066, -3.6892]],
      ["Barcelona-Sants", [41.3792, 2.1404]],
    ]),
  );
  const sncf = buildOperatorBundles("sncf", "SNCF (Licence Ouverte)", [trip("sncf", "9714", [["BARCELONA SANTS", 645], ["PARIS (intramuros)", 1040]])], new Map());
  for (const f of [...renfe.files, ...sncf.files, buildIndexV2("2026-10-11T12:00:00Z", [renfe.entry, sncf.entry])]) {
    const p = join(dir, f.path.replace(/^v2\//, ""));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(f.body));
  }
  return dir;
}

describe("loading bundles", () => {
  it("reads a folder of v2 files, every operator or only some", async () => {
    const dir = writeApi();
    const all = await loadBundles(dir);
    expect(all.bundles.map((b) => b.operator).sort()).toEqual(["renfe", "sncf"]);
    expect(all.sources.get("renfe")).toBe("Renfe (CC BY 4.0)");
    expect((await loadBundles(dir, { operators: ["renfe"] })).bundles.map((b) => b.operator)).toEqual(["renfe"]);
  });
});

describe("search API", () => {
  let server: Server;
  let base = "";
  let state: State | null = null;

  beforeAll(async () => {
    const loaded = await loadBundles(writeApi());
    state = { network: new Network(loaded.bundles), loaded };
    server = createServer((req, res) => handle(req, res, state));
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const get = async (path: string) => {
    const res = await fetch(base + path);
    return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: (await res.json()) as Record<string, unknown> };
  };

  it("finds places by name", async () => {
    const { status, cors, body } = await get("/v2/places?q=barcelona");
    expect(status).toBe(200);
    expect(cors).toBe("*");
    expect(body.places).toEqual([
      {
        id: "barcelona-sants",
        name: "Barcelona-Sants",
        kind: "station",
        stations: [
          { operator: "renfe", name: "Barcelona-Sants" },
          { operator: "sncf", name: "BARCELONA SANTS" },
        ],
      },
    ]);
  });

  it("finds journeys with changes and credits the sources used", async () => {
    const { status, body } = await get("/v2/journeys?from=madrid&to=paris&date=2026-10-12");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      from: { name: "Madrid-Puerta de Atocha", kind: "station" },
      to: { id: "paris", name: "PARIS (intramuros)" },
      date: "2026-10-12",
      sources: ["Renfe (CC BY 4.0)", "SNCF (Licence Ouverte)"],
      timetables: "2026-10-11T12:00:00Z",
    });
    const journeys = body.journeys as { changes: number; departure: string; arrival: string }[];
    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({ changes: 1, departure: "2026-10-12T07:45", arrival: "2026-10-12T17:20" });
  });

  it("lists the places reachable from one, fastest first", async () => {
    const { status, body } = await get("/v2/reachable?from=madrid&date=2026-10-12");
    expect(status).toBe(200);
    const places = body.places as { place: { name: string }; journey: { changes: number } }[];
    expect(places.map((r) => [r.place.name, r.journey.changes])).toEqual([
      ["Barcelona-Sants", 0],
      ["PARIS (intramuros)", 1],
    ]);
    expect(body.sources).toEqual(["Renfe (CC BY 4.0)", "SNCF (Licence Ouverte)"]);
  });

  it("says what is wrong with a request", async () => {
    expect((await get("/v2/journeys?from=madrid&to=paris&date=12/10/2026")).status).toBe(400);
    expect((await get("/v2/journeys?from=madrid&to=atlantis&date=2026-10-12")).status).toBe(404);
    expect((await get("/nowhere")).status).toBe(404);
    expect((await get("/health")).body).toEqual({ ok: true, timetables: "2026-10-11T12:00:00Z" });
  });

  it("answers 503 until the timetables are loaded", async () => {
    const saved = state;
    state = null;
    expect((await get("/v2/places?q=a")).status).toBe(503);
    expect((await get("/health")).status).toBe(503);
    state = saved;
  });
});
