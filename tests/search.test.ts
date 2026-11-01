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

  it("names a place after its busiest station, and counts the trips calling there", () => {
    const b = bundle(
      "renfe",
      [
        run("C1", [["Madrid-Atocha Cercanías", "07:00"], ["Getafe", "07:20"]]),
        run("AVE1", [["Madrid-Puerta de Atocha", "08:00"], ["Sevilla", "10:30"]]),
        run("AVE2", [["Madrid-Puerta de Atocha", "09:00"], ["Sevilla", "11:30"]]),
      ],
      // Two platforms' worth apart: one station.
      { "Madrid-Atocha Cercanías": [40.4065, -3.6895], "Madrid-Puerta de Atocha": [40.4066, -3.6892], Getafe: [40.3, -3.7], Sevilla: [37.39, -5.97] },
    );
    const atocha = new Network([b]).places.find((p) => p.stations.length === 2);
    expect(atocha).toMatchObject({ name: "Madrid-Puerta de Atocha", lat: 40.4066, calls: 3 });
  });

  it("prefers a name its stations share over a busier one without the town", () => {
    const tram = bundle(
      "de",
      [1, 2, 3, 4].map((i) => run(`T${i}`, [["Hauptbahnhof (U, Tram)", "07:00"], ["Pasing", "07:10"]])).concat([
        run("RB1", [["München Hbf", "08:00"], ["Garmisch-Partenkirchen", "09:22"]]),
      ]),
      { "Hauptbahnhof (U, Tram)": [48.1402, 11.5601], "München Hbf": [48.1403, 11.5600], Pasing: [48.15, 11.46], "Garmisch-Partenkirchen": [47.49, 11.1] },
    );
    const obb = bundle("at", [run("RJ1", [["München Hauptbahnhof", "10:00"], ["Salzburg Hbf", "11:30"]])], {
      "München Hauptbahnhof": [48.1401, 11.5602],
      "Salzburg Hbf": [47.81, 13.05],
    });
    const net = new Network([tram, obb]);
    expect(net.places.find((p) => p.stations.length === 3)?.name).toBe("München Hbf");
  });

  it("keeps the name most of a place's stations use", () => {
    const at = (op: string, name: string, n: number): SearchBundle =>
      bundle(op, Array.from({ length: n }, (_, i) => run(`${op}${i}`, [[name, "07:00"], ["Elsewhere " + op, "08:00"]])), {
        [name]: [47.3779, 8.5403],
        ["Elsewhere " + op]: [46 + n / 10, 7],
      });
    // The quay's stop is busiest, but three operators call the place "Zürich HB".
    const net = new Network([at("ch", "Zürich HB", 2), at("de", "Zürich HB", 1), at("at", "Zürich HB", 1), at("x", "Zürich, Bahnhofquai", 9)]);
    expect(net.places.find((p) => p.stations.length === 4)?.name).toBe("Zürich HB");
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

  it("lists every place reachable from a town, each with its fastest journey", () => {
    const madrid = net.resolve("madrid");
    const reach = net.reachable(madrid as never, "2026-10-12");
    const byName = new Map([...reach].map(([p, j]) => [net.places[p]?.name, j]));
    expect([...byName.keys()].sort()).toEqual([
      "Amsterdam Centraal",
      "Barcelona-Sants",
      "PARIS (intramuros)",
      "Zaragoza-Delicias",
    ]);
    // Paris Nord is only walked to: no train arrives there.
    // The night train takes 2h20, 03071 2h25, 03063 2h30.
    expect(byName.get("Barcelona-Sants")?.legs.map((l) => l.trainNo)).toEqual(["00900"]);
    expect(byName.get("Amsterdam Centraal")).toMatchObject({ changes: 2, arrival: "2026-10-12T22:50" });
  });

  it("finds a station's place by the operator's own name", () => {
    const p = net.placeIndex("sncf", "BARCELONA SANTS");
    expect(net.places[p]?.name).toBe("Barcelona-Sants");
    expect(net.placeIndex("renfe", "Barcelona-Sants")).toBe(p);
    expect(net.placeIndex("sncf", "Nowhere")).toBe(-1);
  });
});
