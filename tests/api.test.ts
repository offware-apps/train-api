import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapSncf, mapSncfFeed } from "../src/operators/sncf";
import { buildIndex, buildOperatorApi, stationId, type ApiIndex } from "../src/api";
import { decodeCompact, encodeCompact, isCompact, type CompactSnapshot, type TimetableRow } from "../src/compact";

const feed = JSON.parse(readFileSync(new URL("./fixtures/sncf-tgvmax.sample.json", import.meta.url), "utf-8")) as unknown[];

const rec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  date: "2026-10-12",
  origine: "PARIS (intramuros)",
  destination: "LYON (intramuros)",
  heure_depart: "8:05:00",
  heure_arrivee: "10:01",
  train_no: "6601",
  od_happy_card: "NON",
  axe: "SUD EST",
  ...over,
});

describe("SNCF mapping", () => {
  it("maps a record to the open format, with each pass's rule", () => {
    expect(mapSncf(rec())).toEqual({
      operator: "sncf",
      date: "2026-10-12",
      origin: "PARIS (intramuros)",
      destination: "LYON (intramuros)",
      depart: "08:05",
      arrive: "10:01",
      trainNo: "6601",
      category: "SUD EST",
      passes: {
        "max-jeune": { bookable: false, seat: "full" },
        "max-senior": { bookable: false, seat: "full" },
        interrail: { bookable: true, seat: "unknown" },
      },
    });
    // 2026-10-12 is a Monday: both MAX passes can take it.
    const weekday = mapSncf(rec({ od_happy_card: "OUI" }));
    expect(weekday?.passes["max-jeune"]).toEqual({ bookable: true, seat: "free" });
    expect(weekday?.passes["max-senior"]).toEqual({ bookable: true, seat: "free" });
  });

  it("keeps MAX SENIOR off weekends, MAX JEUNE on them", () => {
    const saturday = mapSncf(rec({ od_happy_card: "OUI", date: "2026-10-10" }));
    expect(saturday?.passes["max-jeune"]?.bookable).toBe(true);
    expect(saturday?.passes["max-senior"]).toEqual({ bookable: false, seat: "free" });
  });

  it("keeps international stops for Interrail only", () => {
    const t = mapSncf(rec({ od_happy_card: "OUI", destination: "GENÈVE" }));
    expect(t?.passes["max-jeune"]?.bookable).toBe(false);
    expect(t?.passes["max-senior"]?.bookable).toBe(false);
    expect(t?.passes.interrail?.bookable).toBe(true);
  });

  it("drops records that can't be a real train", () => {
    expect(mapSncf(rec({ destination: "PARIS (intramuros)" }))).toBeNull();
    expect(mapSncf(rec({ heure_depart: "25:00" }))).toBeNull();
    expect(mapSncf(rec({ date: "12/10/2026" }))).toBeNull();
    expect(mapSncfFeed([null, 3, rec()])).toHaveLength(1);
  });
});

describe("compact snapshot", () => {
  const row = (date: string, over: Partial<TimetableRow> = {}): TimetableRow => ({
    date,
    origin: "PARIS (intramuros)",
    destination: "LYON (intramuros)",
    depart: "08:00",
    arrive: "10:00",
    trainNo: "6601",
    category: "SUD EST",
    ...over,
  });

  it("stores a service once and expands it back to one row per date", () => {
    const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const rows = [
      ...dates.filter((_, i) => i % 3 !== 0).map((d) => row(d)),
      row("2026-10-05", { trainNo: "6603", depart: "09:00", arrive: "11:00", category: undefined }),
    ];
    const c = encodeCompact(rows);
    expect(c.trains).toHaveLength(2);
    const key = (r: TimetableRow): string => JSON.stringify([r.date, r.trainNo, r.depart, r.category ?? null]);
    expect(decodeCompact(JSON.parse(JSON.stringify(c))).map(key).sort()).toEqual(rows.map(key).sort());
  });

  it("recognizes only the compact shape and skips malformed rows", () => {
    expect(isCompact([])).toBe(false);
    const c = encodeCompact([row("2026-10-01")]);
    expect(isCompact(c)).toBe(true);
    c.trains.push([9, 9, "08:00", "09:00", "1", -1, "1"]);
    expect(decodeCompact(c)).toHaveLength(1);
  });
});

describe("static API", () => {
  const trains = mapSncfFeed(feed);
  const { files, entry } = buildOperatorApi("sncf", "test", trains);
  const file = (path: string): unknown => files.find((f) => f.path === path)?.body;

  it("slugs station names into URL-safe ids", () => {
    expect(stationId("PARIS (intramuros)")).toBe("paris-intramuros");
    expect(stationId("Aix-en-Provence TGV")).toBe("aix-en-provence-tgv");
    expect(stationId("GENÈVE")).toBe("geneve");
  });

  it("publishes each pass, with Interrail counting every train", () => {
    expect(entry.passes.map((p) => [p.id, p.trainCount, p.seatKnown])).toEqual([
      ["max-jeune", trains.filter((t) => t.passes["max-jeune"]?.bookable).length, true],
      ["max-senior", trains.filter((t) => t.passes["max-senior"]?.bookable).length, true],
      ["interrail", trains.length, false],
    ]);
    const all = file("v1/sncf/interrail/all.json") as CompactSnapshot;
    expect(decodeCompact(all)).toHaveLength(trains.length);
  });

  it("answers a search by origin, destination and date from one origin file", () => {
    const stations = file("v1/sncf/stations.json") as { id: string; name: string }[];
    const paris = stations.find((s) => s.name === "PARIS (intramuros)");
    expect(paris?.id).toBe("paris-intramuros");
    const fromParis = decodeCompact(file(`v1/sncf/interrail/from/${paris?.id}.json`) as CompactSnapshot);
    expect(fromParis.length).toBeGreaterThan(0);
    expect(fromParis.every((t) => t.origin === "PARIS (intramuros)")).toBe(true);
    const expected = trains.filter((t) => t.origin === "PARIS (intramuros)" && t.destination === "LYON (intramuros)" && t.date === "2026-06-25");
    expect(fromParis.filter((t) => t.destination === "LYON (intramuros)" && t.date === "2026-06-25")).toHaveLength(expected.length);
  });

  it("indexes what it published", () => {
    const index = buildIndex("2026-10-05T00:00:00Z", [entry]).body as ApiIndex;
    expect(index.version).toBe(1);
    expect(index.operators[0]?.dates[0]).toBe("2026-06-25");
  });
});
