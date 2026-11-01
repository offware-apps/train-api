import { describe, it, expect } from "vitest";
import { encodeBundle, type TripRun } from "../src/bundle";
import { Network, normalize, type SearchBundle } from "../src/search";

const DATES = ["2026-10-12", "2026-10-13"];
const M = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function run(trainNo: string, stops: [string, string][], dates = DATES): TripRun {
  return {
    trainNo,
    category: "X",
    dates,
    stops: stops.map(([station, t]) => {
      const [arr = t, dep = t] = t.split("/");
      return { station, arr: M(arr), dep: M(dep) };
    }),
  };
}

function bundle(operator: string, runs: TripRun[], coords: Record<string, [number, number]> = {}): SearchBundle {
  return encodeBundle(operator, "interrail", runs, new Map(Object.entries(coords))) as SearchBundle;
}

const RENFE = bundle(
  "renfe",
  [
    run("03063", [["Madrid-Puerta de Atocha", "07:00"], ["Zaragoza-Delicias", "08:20/08:22"], ["Barcelona-Sants", "09:30"]]),
    run("03071", [["Madrid-Puerta de Atocha", "07:45"], ["Barcelona-Sants", "10:10"]]),
    // A night train of the 12th that reaches Barcelona after midnight.
    run("00900", [["Madrid-Puerta de Atocha", "23:30"], ["Zaragoza-Delicias", "24:40/24:45"], ["Barcelona-Sants", "25:50"]], ["2026-10-12"]),
  ],
  {
    "Madrid-Puerta de Atocha": [40.4066, -3.6892],
    "Zaragoza-Delicias": [41.6582, -0.9112],
    "Barcelona-Sants": [41.3792, 2.1404],
  },
);
// SNCF's tgvmax has names only.
const SNCF = bundle("sncf", [
  // Too tight after the 09:30 arrival: changing between two operators takes 15 minutes.
  run("9702", [["BARCELONA SANTS", "09:40"], ["PARIS (intramuros)", "16:00"]]),
  run("9714", [["BARCELONA SANTS", "10:45"], ["PARIS (intramuros)", "17:20"]]),
]);
const NL = bundle(
  "nl",
  [
    // Crossing Paris from an unplaced station takes an hour: 18:00 is too early after 17:20.
    run("9343", [["Paris Nord", "18:00"], ["Amsterdam Centraal", "21:20"]]),
    run("9351", [["Paris Nord", "19:30"], ["Amsterdam Centraal", "22:50"]]),
  ],
  { "Paris Nord": [48.8809, 2.3553], "Amsterdam Centraal": [52.3791, 4.9003] },
);
const DE = bundle("de", [run("ICE 9", [["Paris Est", "08:55"], ["Frankfurt (Main) Hbf", "12:45"]])], {
  "Paris Est": [48.8768, 2.3592],
  "Frankfurt (Main) Hbf": [50.107, 8.6632],
});

describe("station matching", () => {
  const net = new Network([RENFE, SNCF, NL, DE]);

  it("folds spellings of one station and drops generic words", () => {
    expect(normalize("BARCELONA SANTS")).toBe(normalize("Barcelona-Sants"));
    expect(normalize("Zürich HB")).toBe("zurich");
    expect(normalize("Frankfurt (Main) Hbf")).toBe("frankfurt main");
  });

  it("makes one place of a station two operators name differently", () => {
    const sants = net.places.filter((p) => p.stations.some((s) => normalize(s.name) === "barcelona sants"));
    expect(sants).toHaveLength(1);
    expect(sants[0]?.stations.map((s) => s.operator).sort()).toEqual(["renfe", "sncf"]);
    // Named and placed after the operator that publishes a position.
    expect(sants[0]).toMatchObject({ name: "Barcelona-Sants", lat: 41.3792 });
  });

  it("groups a town's stations, placed or not, and finds the town first", () => {
    const paris = net.resolve("paris");
    expect(paris?.kind).toBe("city");
    expect(paris?.places.map((i) => net.places[i]?.name).sort()).toEqual(["PARIS (intramuros)", "Paris Est", "Paris Nord"]);
    expect(net.find("paris")[0]?.id).toBe("paris");
    expect(net.resolve("Amsterdam Centraal")?.kind).toBe("station");
  });
});

describe("journey search", () => {
  const net = new Network([RENFE, SNCF, NL, DE]);
  const go = (from: string, to: string, date = "2026-10-12", time?: string) =>
    net.journeys(net.resolve(from) as never, net.resolve(to) as never, date, { time });

  it("finds Madrid to Amsterdam across three operators and across Paris", () => {
    const first = go("madrid", "amsterdam")[0];
    expect(first?.changes).toBe(2);
    expect(first?.legs.map((l) => [l.operator, l.trainNo, l.from, l.to])).toEqual([
      // The later of two trains that make the same connection.
      ["renfe", "03071", "Madrid-Puerta de Atocha", "Barcelona-Sants"],
      ["sncf", "9714", "BARCELONA SANTS", "PARIS (intramuros)"],
      ["nl", "9351", "Paris Nord", "Amsterdam Centraal"],
    ]);
    expect(first).toMatchObject({ departure: "2026-10-12T07:45", arrival: "2026-10-12T22:50", duration: 905 });
  });

  it("stays on one train through its stops", () => {
    const j = go("Madrid-Puerta de Atocha", "Barcelona-Sants")[0];
    expect(j?.legs).toEqual([
      {
        operator: "renfe",
        trainNo: "03063",
        category: "X",
        from: "Madrid-Puerta de Atocha",
        to: "Barcelona-Sants",
        departure: "2026-10-12T07:00",
        arrival: "2026-10-12T09:30",
        stops: 2,
      },
    ]);
  });

  it("offers each later departure that arrives later too, and nothing before the time asked", () => {
    const list = go("Madrid-Puerta de Atocha", "Barcelona-Sants", "2026-10-12", "07:01");
    expect(list.map((j) => j.legs[0]?.trainNo)).toEqual(["03071", "00900"]);
  });

  it("catches the previous day's night train after midnight", () => {
    const j = go("Zaragoza-Delicias", "Barcelona-Sants", "2026-10-13")[0];
    expect(j).toMatchObject({ departure: "2026-10-13T00:45", arrival: "2026-10-13T01:50" });
  });

  it("returns nothing between places with no train", () => {
    expect(go("frankfurt", "madrid")).toEqual([]);
  });

  it("uses each operator's own clock", () => {
    const fi = bundle("fi", [run("IC 1", [["Helsinki", "10:00"], ["Tampere", "11:30"]])], {
      Helsinki: [60.1719, 24.9414],
      Tampere: [61.4986, 23.7737],
    });
    const j = new Network([fi]).journeys([0], [1], "2026-10-12", { time: "09:30" })[0];
    expect(j).toMatchObject({ departure: "2026-10-12T10:00", arrival: "2026-10-12T11:30", duration: 90 });
  });
});
