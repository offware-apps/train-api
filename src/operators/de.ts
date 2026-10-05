import type { GtfsOperator } from "../gtfs";

/** Germany's long-distance timetable from DELFI, every operator's ICE/IC/EC (GTFS, CC BY 4.0, via gtfs.de). */
export const DE_GTFS_URL = "https://download.gtfs.de/germany/fv_free/latest.zip";

/** Charter trains, which no pass covers. */
const NOT_INTERRAIL_AGENCIES = new Set(["BahnTouristikExpress"]);
/** Families that don't take Interrail. */
const NOT_INTERRAIL = new Set(["FLX"]);

export const DE: GtfsOperator = {
  id: "de",
  source: "DELFI e.V. via gtfs.de — German long-distance trains (CC BY 4.0)",
  route: (r, agency) => {
    if (r.route_type !== "2" || NOT_INTERRAIL_AGENCIES.has(agency)) return null;
    // "ICE 1" → "ICE", "EC" → "EC": the family, then the line number.
    const family = (r.route_short_name ?? "").trim().split(/\s+/)[0] ?? "";
    return family && !NOT_INTERRAIL.has(family) ? family : null;
  },
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
