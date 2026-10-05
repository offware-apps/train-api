import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { gtfsMinutes, parseCsvLine, readGtfs } from "../src/gtfs";
import { RENFE } from "../src/operators/renfe";
import { NL } from "../src/operators/nl";
import { CH } from "../src/operators/ch";
import { DE } from "../src/operators/de";
import { FI } from "../src/operators/fi";
import { IE } from "../src/operators/ie";
import { IT } from "../src/operators/it";
import { NO } from "../src/operators/no";

const DIR = fileURLToPath(new URL("./fixtures/gtfs-mini", import.meta.url));
const QUOTED = fileURLToPath(new URL("./fixtures/gtfs-quoted", import.meta.url));

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

describe("Quoted feeds (the Swiss shape)", () => {
  it("reads quoted CSV with a byte-order mark, and names the train after its line when the trip has no number", async () => {
    const trains = await readGtfs(QUOTED, CH, "2026-10-05", 2);
    expect(trains).toEqual([
      expect.objectContaining({ date: "2026-10-05", origin: "Basel SBB", destination: "Zürich HB", depart: "09:03", trainNo: "IC5", category: "IC" }),
      expect.objectContaining({ date: "2026-10-06", origin: "Basel SBB", destination: "Zürich HB", depart: "09:03", trainNo: "IC5", category: "IC" }),
    ]);
  });
});

describe("Operator rules", () => {
  const route = (r: Record<string, string>) => r;

  it("Germany keeps long-distance families, not charter trains", () => {
    expect(DE.route(route({ route_type: "2", route_short_name: "ICE 1" }), "DB Fernverkehr AG")).toBe("ICE");
    expect(DE.route(route({ route_type: "2", route_short_name: "EC" }), "SBB")).toBe("EC");
    expect(DE.route(route({ route_type: "2", route_short_name: "D" }), "BahnTouristikExpress")).toBeNull();
  });

  it("Italy keeps long-distance trains, regional ones only between their stations, and drops suburban lines", () => {
    expect(IT.route(route({ route_type: "2", route_short_name: "FR" }), "TRENITALIA")).toBe("FR");
    expect(IT.route(route({ route_type: "2", route_short_name: "RV" }), "TRENITALIA")).toBe("RV");
    expect(IT.narrow?.("RV")).toBe(true);
    expect(IT.narrow?.("FR")).toBe(false);
    expect(IT.route(route({ route_type: "2", route_short_name: "SFM" }), "TRENITALIA")).toBeNull();
  });

  it("Switzerland reads the family from route_desc and drops the S-Bahn", () => {
    expect(CH.route(route({ route_type: "102", route_short_name: "IC5", route_desc: "IC" }), "SBB")).toBe("IC");
    expect(CH.route(route({ route_type: "103", route_short_name: "IR35", route_desc: "IR" }), "SOB")).toBe("IR");
    expect(CH.narrow?.("IR")).toBe(true);
    expect(CH.route(route({ route_type: "109", route_short_name: "S11", route_desc: "S" }), "SBB")).toBeNull();
    expect(CH.route(route({ route_type: "117", route_short_name: "EXT", route_desc: "EXT" }), "SBB")).toBeNull();
  });

  it("Norway keeps Vy, Go-Ahead and SJ trains, not Flytoget or local trains", () => {
    expect(NO.route(route({ route_type: "100", route_short_name: "F6" }), "SJ Nord")).toBe("F");
    expect(NO.route(route({ route_type: "100", route_short_name: "RE10" }), "Vy Tåg")).toBe("RE");
    expect(NO.route(route({ route_type: "105", route_short_name: "" }), "SJ")).toBe("SJ");
    expect(NO.route(route({ route_type: "100", route_short_name: "L1" }), "Vy Tåg")).toBeNull();
    expect(NO.route(route({ route_type: "101", route_short_name: "FLY1" }), "Flytoget")).toBeNull();
    expect(NO.route(route({ route_type: "700", route_short_name: "F1" }), "Vy Buss")).toBeNull();
  });

  it("Finland keeps VR's long-distance trains, not Helsinki commuter or museum trains", () => {
    expect(FI.route(route({ route_type: "102", route_short_name: "IC 22" }), "VR")).toBe("IC");
    expect(FI.route(route({ route_type: "102", route_short_name: "S 45" }), "VR")).toBe("S");
    expect(FI.route(route({ route_type: "109", route_short_name: "R 1" }), "VR")).toBeNull();
    expect(FI.route(route({ route_type: "102", route_short_name: "MUS 1" }), "Keitele-Museo Oy")).toBeNull();
  });

  it("Ireland drops the DART and narrows commuter lines", () => {
    expect(IE.route(route({ route_type: "2", route_id: "BRAY-HOWTH-I", route_short_name: "DART" }), "Irish Rail")).toBeNull();
    expect(IE.route(route({ route_type: "2", route_id: "DUB-CORK-O", route_short_name: "InterCity" }), "Irish Rail")).toBe("InterCity");
    expect(IE.route(route({ route_type: "2", route_id: "DUB-BFT-O", route_short_name: "rail" }), "Irish Rail")).toBe("Enterprise");
    expect(IE.route(route({ route_type: "2", route_id: "DUB-MAYNOOTH-O", route_short_name: "rail" }), "Irish Rail")).toBe("Commuter");
    expect(IE.narrow?.("Commuter")).toBe(true);
  });
});
