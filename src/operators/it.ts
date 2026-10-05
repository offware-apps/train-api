import type { GtfsOperator } from "../gtfs";

/**
 * Trenitalia's timetable, converted to GTFS from Italy's National Access Point (NeTEx)
 * and republished daily under CC BY 4.0.
 */
export const IT_GTFS_URL = "https://raw.githubusercontent.com/deryclem/trenitalia-gtfs/main/gtfs-trenitalia.zip";

/** Frecciarossa, Frecciargento, Frecciabianca, Intercity (day and night), EuroCity, EuroNight, Espresso. */
const LONG_DISTANCE = new Set(["FR", "FA", "FB", "IC", "ICN", "EC", "EN", "EXP"]);
/** Regionale and Regionale Veloce: kept between the long-distance stations only. */
const REGIONAL = new Set(["REG", "RV"]);

export const IT: GtfsOperator = {
  id: "it",
  source: "Trenitalia via the Italian National Access Point, converted by Clément Desouche (CC BY 4.0)",
  route: (r) => {
    const family = (r.route_short_name ?? "").trim().toUpperCase();
    // Suburban and airport lines (SFM, FL, MET) are left out.
    return r.route_type === "2" && (LONG_DISTANCE.has(family) || REGIONAL.has(family)) ? family : null;
  },
  narrow: (f) => REGIONAL.has(f),
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
