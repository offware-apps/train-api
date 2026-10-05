import type { GtfsOperator } from "../gtfs";

/** VR's passenger trains in Finland (GTFS, CC BY 4.0, Fintraffic's digitraffic.fi). */
export const FI_GTFS_URL = "https://rata.digitraffic.fi/api/v1/trains/gtfs-passenger.zip";
/** digitraffic answers 406 without these. */
export const FI_HEADERS = { "Accept-Encoding": "gzip", "Digitraffic-User": "train-api" };

/** InterCity, Pendolino (S) and night trains: every stop is kept. */
const LONG_DISTANCE = new Set(["IC", "S", "PYO"]);
/** Regional trains: kept between the long-distance stations only. */
const REGIONAL = new Set(["H", "HDM"]);

export const FI: GtfsOperator = {
  id: "fi",
  source: "Fintraffic / digitraffic.fi — Finnish passenger trains (CC BY 4.0)",
  route: (r, agency) => {
    // Helsinki commuter trains (route_type 109) and museum trains are left out.
    if (agency !== "VR" || r.route_type !== "102") return null;
    const family = (r.route_short_name ?? "").trim().split(/\s+/)[0] ?? "";
    return LONG_DISTANCE.has(family) || REGIONAL.has(family) ? family : null;
  },
  narrow: (f) => REGIONAL.has(f),
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
