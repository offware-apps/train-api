import { describe, it, expect } from "vitest";
import type { Timetable, Trip } from "../src/format";
import { mergeTimetables } from "../src/merge";

const trip = (from: string, to: string): Trip => ({
  operator: "fr",
  trainNo: "1",
  dates: ["2026-11-02"],
  stops: [
    { station: from, arr: 480, dep: 480 },
    { station: to, arr: 540, dep: 540 },
  ],
  passes: {},
});

const feed = (trips: Trip[], coords: [string, [number, number]][]): Timetable => ({ trains: [], trips, coords: new Map(coords) });

describe("mergeTimetables", () => {
  it("keeps one station for a name two feeds place together, and numbers one placed elsewhere", () => {
    const a = feed([trip("Gare SNCF", "Lyon Part-Dieu")], [["Gare SNCF", [45.9, 6.12]], ["Lyon Part-Dieu", [45.76, 4.86]]]);
    // Annecy's again 500 m off, and another town's "Gare SNCF" 100 km away.
    const b = feed([trip("Gare SNCF", "Lyon Part-Dieu")], [["Gare SNCF", [45.903, 6.124]], ["Lyon Part-Dieu", [45.76, 4.86]]]);
    const c = feed([trip("Gare SNCF", "Lyon Part-Dieu")], [["Gare SNCF", [45.19, 5.71]], ["Lyon Part-Dieu", [45.76, 4.86]]]);
    const m = mergeTimetables([a, b, c]);
    expect(m.trips.map((t) => t.stops[0]?.station)).toEqual(["Gare SNCF", "Gare SNCF", "Gare SNCF (2)"]);
    expect(m.coords.get("Gare SNCF")).toEqual([45.9, 6.12]);
    expect(m.coords.get("Gare SNCF (2)")).toEqual([45.19, 5.71]);
    expect([...(m.sameName ?? new Map()).keys()]).toEqual(["Gare SNCF"]);
    // The feeds' own trips are left as they were.
    expect(c.trips[0]?.stops[0]?.station).toBe("Gare SNCF");
  });
});
