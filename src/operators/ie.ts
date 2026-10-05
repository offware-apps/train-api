import type { GtfsOperator } from "../gtfs";

/** Irish Rail's timetable (GTFS, CC BY 4.0, National Transport Authority). */
export const IE_GTFS_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip";

/** Lines the feed calls "rail" that run as commuter services around Dublin and Cork. */
const COMMUTER_ROUTES = /^(DUB-MAYNOOTH|DUB-DRO\/DUN|MAL-COBH)/;

export const IE: GtfsOperator = {
  id: "ie",
  source: "National Transport Authority — Irish Rail timetable (CC BY 4.0)",
  route: (r) => {
    const name = (r.route_short_name ?? "").trim();
    const id = r.route_id ?? "";
    // The DART is Dublin's suburban line: thousands of stop pairs for one city.
    if (r.route_type !== "2" || name === "DART") return null;
    if (id.startsWith("DUB-BFT") || id.startsWith("BFT-DUB")) return "Enterprise";
    if (name === "Commuter" || COMMUTER_ROUTES.test(id)) return "Commuter";
    return "InterCity";
  },
  narrow: (f) => f === "Commuter",
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
