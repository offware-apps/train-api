import type { GtfsOperator } from "../gtfs";

/**
 * Sweden's national timetable, every operator and mode (GTFS Sverige 2, CC0, Samtrafiken
 * via Trafiklab). Needs a free Trafiklab key in TRAFIKLAB_KEY; `{key}` is replaced with it.
 */
export const SE_GTFS_URL = "https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip?key={key}";
export const SE_KEY_ENV = "TRAFIKLAB_KEY";
export const SE_HEADERS = { "Accept-Encoding": "gzip" };

/** Operators whose trains don't take Interrail, or only give pass holders a discount. */
const NOT_INTERRAIL = /^(Snälltåget|Arlanda Express|FlixTrain|Flixtrain|Inlandsbanan|VR Snabbtåg)/i;

/** GTFS extended route types → family. */
const FAMILIES: Record<string, string> = {
  "101": "Snabbtåg",
  "102": "Fjärrtåg",
  "105": "Nattåg",
  "103": "Regionaltåg",
  "106": "Regionaltåg",
};

export const SE: GtfsOperator = {
  id: "se",
  source: "Samtrafiken via Trafiklab — GTFS Sverige 2 (CC0)",
  route: (r, agency) => {
    if (NOT_INTERRAIL.test(agency.trim())) return null;
    // Commuter trains (pendeltåg, 109) and every non-rail mode are left out.
    return FAMILIES[r.route_type ?? ""] ?? null;
  },
  // Regional trains only count between the stations the long-distance trains serve.
  narrow: (f) => f === "Regionaltåg",
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
