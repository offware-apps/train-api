import type { GtfsOperator } from "../gtfs";

/** Norway's national timetable, every operator and mode (GTFS, NLOD, from Entur). */
export const NO_GTFS_URL = "https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs.zip";

/** Train operators whose trains take Interrail (Flytoget and the Swedish private trains don't). */
const AGENCIES = /^(Vy|Go-Ahead|SJ)\b/;

/** Line code → family: "F6" → "F" (long distance), "RE10" → "RE", "R60" → "R", "L1" → "L". */
function family(shortName: string): string {
  return /^[A-Z]+/.exec(shortName.trim())?.[0] ?? "";
}

export const NO: GtfsOperator = {
  id: "no",
  source: "Entur — Norwegian national timetable (NLOD)",
  route: (r, agency) => {
    const type = Number(r.route_type);
    if (!(type === 2 || (type >= 100 && type < 200)) || !AGENCIES.test(agency)) return null;
    const f = family(r.route_short_name ?? "");
    // SJ's Oslo–Stockholm trains carry no line code.
    if (!f) return agency.startsWith("SJ") ? "SJ" : null;
    // Local trains (L) are left out.
    return ["F", "RE", "RX", "R"].includes(f) ? f : null;
  },
  narrow: (f) => f === "RE" || f === "RX" || f === "R",
  passes: () => ({ interrail: { bookable: true, seat: "unknown" } }),
};
