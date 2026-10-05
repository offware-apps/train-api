import type { GtfsOperator } from "../gtfs";

/** Switzerland's official timetable, every operator (GTFS, opentransportdata.swiss). Redirects to the current year's file. */
export const CH_GTFS_URL = "https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020/permalink";

/** International and long-distance families: every stop they call at is kept. */
const LONG_DISTANCE = new Set(["IC", "ICN", "EC", "ICE", "TGV", "RJ", "RJX", "NJ", "EN"]);
/** InterRegio and RegioExpress: kept between the long-distance stations only. */
const REGIONAL = new Set(["IR", "RE"]);

export const CH: GtfsOperator = {
  id: "ch",
  source: "opentransportdata.swiss — Swiss national timetable (free use, source cited)",
  route: (r) => {
    // route_desc holds the family (IC, IR, S…); route_short_name is often the line ("IC5", "S11").
    const family = (r.route_desc ?? "").trim().toUpperCase();
    // S-Bahn, regional and panoramic trains (S, R, EXT…) are left out: too many stop pairs,
    // and the panoramic ones need a surcharge.
    return LONG_DISTANCE.has(family) || REGIONAL.has(family) ? family : null;
  },
  narrow: (f) => REGIONAL.has(f),
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
