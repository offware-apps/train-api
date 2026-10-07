import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readNetworkRail } from "../src/operators/gb";
import { SE } from "../src/operators/se";

const FEED = fileURLToPath(new URL("./fixtures/gb-schedule.json", import.meta.url));

describe("Network Rail schedule (Great Britain)", () => {
  it("applies overlays and cancellations over the permanent schedule, date by date", async () => {
    const trains = await readNetworkRail(FEED, "2026-10-05", 5);
    const kgxYork = trains.filter((t) => t.origin === "LONDON KINGS CROSS" && t.destination === "YORK");
    expect(kgxYork.map((t) => [t.date, t.depart, t.arrive])).toEqual([
      ["2026-10-05", "23:30", "01:30"],
      ["2026-10-06", "23:30", "01:30"],
      // Wednesday's overlay; Thursday is cancelled; Friday's overlay is a stopping train, left out.
      ["2026-10-07", "23:45", "02:00"],
    ]);
    expect(kgxYork[0]).toMatchObject({ operator: "gb", trainNo: "1S07", category: "LNER", passes: { interrail: { bookable: true, seat: "unknown" } } });
  });

  it("keeps public calls only, and dates a departure after midnight the next day", async () => {
    const trains = await readNetworkRail(FEED, "2026-10-05", 1);
    expect(trains.some((t) => t.origin === "HEATHROW JN" || t.destination === "HEATHROW JN")).toBe(false);
    expect(trains.find((t) => t.origin === "DONCASTER")).toMatchObject({ date: "2026-10-06", depart: "00:41", destination: "YORK" });
    expect(trains.find((t) => t.origin === "PETERBOROUGH" && t.destination === "DONCASTER")).toMatchObject({ date: "2026-10-05", depart: "23:52", arrive: "00:40" });
  });

  it("leaves out stopping trains and operators that don't take Interrail", async () => {
    const trains = await readNetworkRail(FEED, "2026-10-05", 5);
    expect(trains.some((t) => t.trainNo === "2D01" || t.trainNo === "1X01")).toBe(false);
  });

  it("reads nothing when the extract is missing", async () => {
    expect(await readNetworkRail("/nonexistent/gb.json.gz", "2026-10-05")).toEqual([]);
  });
});

describe("Swedish operator", () => {
  it("keeps long-distance and regional trains, not commuter trains or non-Interrail operators", () => {
    expect(SE.route({ route_type: "101" }, "SJ")).toBe("Snabbtåg");
    expect(SE.route({ route_type: "106" }, "Västtrafik")).toBe("Regionaltåg");
    expect(SE.narrow?.("Regionaltåg")).toBe(true);
    expect(SE.route({ route_type: "109" }, "SL")).toBeNull();
    expect(SE.route({ route_type: "102" }, "Snälltåget")).toBeNull();
    expect(SE.route({ route_type: "700" }, "SJ")).toBeNull();
  });
});
