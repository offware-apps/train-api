import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { gtfsMinutes, parseCsvLine, readGtfs } from "../src/gtfs";
import { RENFE } from "../src/operators/renfe";
import { NL } from "../src/operators/nl";

const DIR = fileURLToPath(new URL("./fixtures/gtfs-mini", import.meta.url));

describe("GTFS reading", () => {
  it("parses quoted, padded CSV and times past midnight", () => {
    expect(parseCsvLine('a, "b, c" ,"d ""e"""')).toEqual(["a", "b, c", 'd "e"']);
    expect(gtfsMinutes("8:30:00")).toBe(510);
    expect(gtfsMinutes("25:50:00")).toBe(1550);
    expect(gtfsMinutes("")).toBeNaN();
  });

  it("turns each kept trip into one train per stop pair per running date", async () => {
    const trains = await readGtfs(DIR, RENFE, "2026-10-05", 7);
    const t1 = trains.filter((t) => t.trainNo === "03063");
    // Mon–Fri minus Wednesday's removal = 4 dates, 3 stop pairs each.
    expect(new Set(t1.map((t) => t.date))).toEqual(new Set(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09"]));
    expect(t1).toHaveLength(12);
    const leg = t1.find((t) => t.date === "2026-10-05" && t.destination === "Barcelona-Sants" && t.origin.startsWith("Madrid"));
    expect(leg).toMatchObject({
      operator: "renfe",
      origin: "Madrid-Puerta de Atocha-Almudena Grandes",
      depart: "07:00",
      arrive: "09:30",
      category: "AVE",
      passes: { interrail: { bookable: true, seat: "unknown" } },
    });
    // A platform reads as its station.
    expect(t1.some((t) => t.origin === "Zaragoza-Delicias")).toBe(true);
  });

  it("skips the routes an operator leaves out (Avlo, buses)", async () => {
    const trains = await readGtfs(DIR, RENFE, "2026-10-05", 7);
    expect(trains.some((t) => t.trainNo === "06101")).toBe(false);
  });

  it("dates a stop pair by its departure, past midnight included", async () => {
    const t3 = (await readGtfs(DIR, RENFE, "2026-10-05", 7)).filter((t) => t.trainNo === "03171");
    expect(t3.map((t) => [t.date, t.origin.slice(0, 6), t.depart, t.arrive]).sort()).toEqual([
      ["2026-10-10", "Madrid", "23:30", "00:40"],
      ["2026-10-10", "Madrid", "23:30", "01:50"],
      ["2026-10-11", "Zarago", "00:45", "01:50"],
    ]);
  });

  it("keeps only the window asked for", async () => {
    expect(await readGtfs(DIR, RENFE, "2026-11-01", 7)).toEqual([]);
  });
});

describe("Dutch operator", () => {
  const route = (short: string, type = "2"): Record<string, string> => ({ route_short_name: short, route_type: type });

  it("keeps long-distance and Intercity trains, by family", () => {
    expect(NL.route(route("Eurostar"), "NS International")).toBe("Eurostar");
    expect(NL.route(route("ICE"), "NS International")).toBe("ICE");
    expect(NL.route(route("Eurocity Direct"), "NS International")).toBe("Eurocity Direct");
    expect(NL.route(route("Intercity direct"), "NS")).toBe("Intercity direct");
    expect(NL.route(route("Intercity IC23"), "Blauwnet Keolis")).toBe("Intercity");
    expect(NL.route(route("Sprinter"), "NS")).toBeNull();
    expect(NL.route(route("Intercity", "3"), "Bus")).toBeNull();
    expect(NL.narrow?.("Intercity")).toBe(true);
    expect(NL.narrow?.("Eurostar")).toBe(false);
  });
});
