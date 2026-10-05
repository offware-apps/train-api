import type { Train } from "../format";

/** SNCF Open Data, `tgvmax` dataset: every TGV INOUI and Intercités train for ~30 days. */
export const SNCF_FEED_URL =
  "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax/exports/json";

/**
 * Stops the feed marks with a free MAX seat that the MAX pass doesn't cover (it is
 * domestic). Accent-insensitive substrings. Interrail covers them.
 */
const MAX_EXCLUDED = ["geneve", "lausanne", "zurich", "bruxelles", "brussel"];

/** One record of the SNCF feed, as published. */
export interface SncfRecord {
  date?: unknown;
  origine?: unknown;
  destination?: unknown;
  heure_depart?: unknown;
  heure_arrivee?: unknown;
  train_no?: unknown;
  od_happy_card?: unknown;
  axe?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Saturday or Sunday, for a "YYYY-MM-DD" date. */
function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** "8:05" / "08:05:00" → "08:05"; anything else → "". */
function hhmm(v: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Map one SNCF record to the open format, or null when it can't be a real train. */
export function mapSncf(r: SncfRecord): Train | null {
  const date = str(r.date);
  const origin = str(r.origine);
  const destination = str(r.destination);
  const depart = hhmm(r.heure_depart);
  const arrive = hhmm(r.heure_arrivee);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !origin || !destination || origin === destination) return null;
  if (!depart || !arrive) return null;
  const maxSeat = str(r.od_happy_card).toUpperCase() === "OUI";
  const international = [origin, destination].some((s) => MAX_EXCLUDED.some((p) => fold(s).includes(p)));
  const category = str(r.axe);
  const train: Train = {
    operator: "sncf",
    date,
    origin,
    destination,
    depart,
    arrive,
    trainNo: str(r.train_no),
    passes: {
      // One flag covers both MAX passes: the feed has a single MAX quota.
      "max-jeune": { bookable: maxSeat && !international, seat: maxSeat ? "free" : "full" },
      // MAX SENIOR is weekday-only; its off-peak limits aren't in the data (see PASS_INFO).
      "max-senior": { bookable: maxSeat && !international && !isWeekend(date), seat: maxSeat ? "free" : "full" },
      // Every train in this feed takes an Interrail pass-holder reservation; no open
      // data says whether one is left.
      interrail: { bookable: true, seat: "unknown" },
    },
  };
  if (category) train.category = category;
  return train;
}

export function mapSncfFeed(records: unknown[]): Train[] {
  const out: Train[] = [];
  for (const r of records) {
    if (typeof r !== "object" || r === null) continue;
    const t = mapSncf(r as SncfRecord);
    if (t) out.push(t);
  }
  return out;
}
