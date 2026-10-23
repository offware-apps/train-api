import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { buildIndexV2, buildOperatorBundles, tripsFromTrains } from "../src/api";
import { decodeBundle, encodeBundle, isBundle, type Bundle } from "../src/bundle";
import type { Train, Trip } from "../src/format";
import { readGtfsTimetable } from "../src/gtfs";
import { readNetworkRailTimetable } from "../src/operators/gb";
import { RENFE } from "../src/operators/renfe";

const DIR = fileURLToPath(new URL("./fixtures/gtfs-mini", import.meta.url));
const GB = fileURLToPath(new URL("./fixtures/gb-schedule.json", import.meta.url));
const INTERRAIL = { interrail: { bookable: true, seat: "unknown" as const } };

const trip = (over: Partial<Trip> = {}): Trip => ({
  operator: "renfe",
  trainNo: "03063",
  category: "AVE",
  dates: ["2026-10-05"],
  stops: [
    { station: "Madrid", arr: 420, dep: 420 },
    { station: "Zaragoza", arr: 500, dep: 502 },
    { station: "Barcelona", arr: 570, dep: 570 },
  ],
  passes: INTERRAIL,
  ...over,
});

describe("trip bundles", () => {
  it("stores a run repeated on several dates once, and decodes it back", () => {
    const coords = new Map<string, [number, number]>([["Madrid", [40.406789123, -3.6912345]]]);
    const b = encodeBundle("renfe", "interrail", [trip(), trip({ dates: ["2026-10-07"] }), trip({ trainNo: "03071", dates: ["2026-10-06"] })], coords);
    expect(isBundle(JSON.parse(JSON.stringify(b)))).toBe(true);
    expect(b.dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(b.stations).toEqual([
      ["Madrid", 40.40679, -3.69123],
      ["Zaragoza", null, null],
      ["Barcelona", null, null],
    ]);
    expect(b.trips).toEqual([
      ["03063", 0, "5", [0, 1, 2], [420, 420, 500, 502, 570, 570]],
      ["03071", 0, "2", [0, 1, 2], [420, 420, 500, 502, 570, 570]],
    ]);
    expect(decodeBundle(b)).toEqual([
      { trainNo: "03063", category: "AVE", dates: ["2026-10-05", "2026-10-07"], stops: trip().stops },
      { trainNo: "03071", category: "AVE", dates: ["2026-10-06"], stops: trip().stops },
    ]);
  });

  it("skips malformed trips when decoding", () => {
    const b = encodeBundle("renfe", "interrail", [trip()]);
    const bad: Bundle = { ...b, trips: [...b.trips, ["x", -1, "1", [0, 9], [0, 0, 1, 1]], ["y", -1, "1", [0, 1], [0]]] };
    expect(decodeBundle(bad)).toHaveLength(1);
  });

  it("reads each GTFS trip whole, with the stations' coordinates", async () => {
    const { trips, coords } = await readGtfsTimetable(DIR, RENFE, "2026-10-05", 7);
    expect(trips.map((t) => t.trainNo).sort()).toEqual(["03063", "03171"]);
    const night = trips.find((t) => t.trainNo === "03171");
    // Stop times count from the service day, past midnight included.
    expect(night).toMatchObject({ dates: ["2026-10-10"], category: "AVE" });
    expect(night?.stops.map((s) => [s.station.slice(0, 8), s.arr, s.dep])).toEqual([
      ["Madrid-P", 1410, 1410],
      ["Zaragoza", 1480, 1485],
      ["Barcelon", 1550, 1550],
    ]);
    // A platform's station takes the station's own coordinates.
    expect(coords.get("Zaragoza-Delicias")).toEqual([41.65, -0.91]);
    expect(coords.get("Barcelona-Sants")).toEqual([41.38, 2.14]);
  });

  it("keeps every stop of a narrowed family, which v1 cuts", async () => {
    const op = { ...RENFE, narrow: (f: string) => f === "AVE" };
    const { trains, trips } = await readGtfsTimetable(DIR, op, "2026-10-05", 7);
    // No other family serves these stations, so v1 keeps none of the pairs.
    expect(trains).toEqual([]);
    expect(trips.find((t) => t.trainNo === "03063")?.stops).toHaveLength(3);
  });

  it("reads Network Rail schedules as trips too", async () => {
    const { trains, trips, coords } = await readNetworkRailTimetable(GB, "2026-10-05");
    expect(trips.length).toBeGreaterThan(0);
    expect(trains.length).toBeGreaterThan(trips.length);
    expect(coords.size).toBe(0);
  });

  it("turns rows from a source without stop lists into two-stop trips", () => {
    const row: Train = {
      operator: "sncf",
      date: "2026-10-12",
      origin: "PARIS (intramuros)",
      destination: "NICE VILLE",
      depart: "22:00",
      arrive: "07:30",
      trainNo: "5773",
      category: "SUD EST",
      passes: INTERRAIL,
    };
    expect(tripsFromTrains([row])).toEqual([
      {
        operator: "sncf",
        trainNo: "5773",
        category: "SUD EST",
        dates: ["2026-10-12"],
        stops: [
          { station: "PARIS (intramuros)", arr: 1320, dep: 1320 },
          { station: "NICE VILLE", arr: 1890, dep: 1890 },
        ],
        passes: INTERRAIL,
      },
    ]);
  });

  it("publishes one bundle per pass, the stations and an index", () => {
    const coords = new Map<string, [number, number]>([["Madrid", [40.4, -3.69]]]);
    const max = { "max-jeune": { bookable: true, seat: "free" as const } };
    const { files, entry } = buildOperatorBundles("renfe", "src", [trip(), trip({ trainNo: "1", passes: max })], coords);
    expect(files.map((f) => f.path)).toEqual(["v2/renfe/max-jeune.json", "v2/renfe/interrail.json", "v2/renfe/stations.json"]);
    expect(files[2]?.body).toEqual([
      ["Barcelona", null, null],
      ["Madrid", 40.4, -3.69],
      ["Zaragoza", null, null],
    ]);
    expect(entry).toMatchObject({ id: "renfe", source: "src", dates: ["2026-10-05"], stationCount: 3, locatedCount: 1 });
    const interrail = entry.passes.find((p) => p.id === "interrail");
    expect(interrail).toMatchObject({ tripCount: 1, bookingUrl: "https://www.renfe.com/es/en" });
    expect(interrail?.bytes).toBe(JSON.stringify(files[1]?.body).length);
    expect(buildIndexV2("now", [entry])).toEqual({ path: "v2/index.json", body: { version: 2, updatedAt: "now", operators: [entry] } });
  });
});
