import type { GtfsOperator } from "../gtfs";

/** Renfe's high-speed, long and medium-distance timetable (GTFS, CC BY 4.0). */
export const RENFE_GTFS_URL = "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip";

/** Renfe's low-cost brand, which doesn't take Interrail passes. */
const NOT_INTERRAIL = new Set(["AVLO"]);

export const RENFE: GtfsOperator = {
  id: "renfe",
  source: "Renfe Data — high-speed, long and medium distance (CC BY 4.0)",
  route: (r) => {
    const family = (r.route_short_name ?? "").trim();
    return r.route_type === "2" && family && !NOT_INTERRAIL.has(family.toUpperCase()) ? family : null;
  },
  // Most of these trains need a paid pass-holder reservation; no open data says whether one is left.
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
