import type { GtfsOperator } from "../gtfs";

/** The Netherlands' national timetable, every operator and mode (GTFS, CC0, via OVapi). */
export const NL_GTFS_URL = "http://gtfs.openov.nl/gtfs-rt/gtfs-openov-nl.zip";

/** International and long-distance families: every stop they call at is kept. */
const LONG_DISTANCE = ["eurostar", "ice", "eurocity", "eurocity direct", "intercity direct", "nightjet"];

/** Train family from the route's short name: "Intercity IC23" → "Intercity", "Eurostar" → "Eurostar". */
function family(shortName: string): string {
  const s = shortName.trim();
  const lower = s.toLowerCase();
  const long = [...LONG_DISTANCE].sort((a, b) => b.length - a.length).find((f) => lower === f || lower.startsWith(`${f} `));
  if (long) return s.slice(0, long.length);
  if (lower.startsWith("intercity")) return "Intercity";
  return "";
}

export const NL: GtfsOperator = {
  id: "nl",
  source: "OVapi — Dutch national timetable, NDOV (CC0)",
  route: (r) => {
    if (r.route_type !== "2") return null;
    return family(r.route_short_name ?? "") || null;
  },
  // Domestic Intercity trains only count between the stations the long-distance trains
  // serve (Amsterdam, Schiphol, Rotterdam, Utrecht, Arnhem…): every IC stop pair would
  // make the snapshot tens of MB.
  narrow: (f) => f === "Intercity",
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
