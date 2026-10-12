/**
 * What an Interrail pass holder pays to reserve a seat on SNCF trains, in euros, 2nd
 * class. Hand-entered from Interrail's own fee pages (they are indicative and change;
 * clients should say so and link them). Checked on 2026-10-12.
 *
 * A train's fee depends on where it goes: a stop abroad sets the international fee for
 * that country, otherwise the train family (the SNCF "axe") sets the domestic one.
 */

export const INTERRAIL_FEES_URL =
  "https://www.interrail.com/en/book-reservations/reservation-fees/domestic-train-reservation-fees";
export const INTERRAIL_FEES_CHECKED = "2026-10-12";

/** A pass-holder reservation, 2nd class, in euros. `min === max` for a fixed fee. */
export interface ReservationFee {
  min: number;
  max: number;
}

export type FeeCountry = "BE" | "CH" | "DE" | "ES" | "IT" | "LU";

/** Whole words of SNCF stop names abroad, by country (accents and case ignored). */
export const FOREIGN_STOPS: Record<FeeCountry, string[]> = {
  BE: ["bruxelles", "brussel", "liege", "anvers", "antwerpen"],
  CH: ["geneve", "lausanne", "zurich", "basel", "bale", "bern", "vallorbe", "neuchatel"],
  DE: [
    "mannheim", "saarbrucken", "saarbruecken", "kaiserslautern", "frankfurt", "karlsruhe",
    "stuttgart", "augsburg", "munchen", "baden baden", "ulm", "freiburg", "koln", "dortmund",
  ],
  ES: ["barcelona", "girona", "figueres", "madrid"],
  IT: ["torino", "milano", "oulx", "oux"],
  LU: ["luxembourg"],
};

/** International pass-holder fees (international train reservation fees page). */
const BY_COUNTRY: Record<Exclude<FeeCountry, "ES">, ReservationFee> = {
  BE: { min: 20, max: 35 }, // TGV to Brussels
  CH: { min: 25, max: 25 }, // TGV Lyria
  DE: { min: 19, max: 19 }, // ICE & TGV France–Germany
  IT: { min: 31, max: 31 }, // TGV France–Italy
  LU: { min: 10, max: 20 }, // TGV to Luxembourg
};
/** TGV France–Spain: from Paris, or from Lyon, Montpellier or Perpignan. */
const SPAIN_FROM_PARIS: ReservationFee = { min: 35, max: 35 };
const SPAIN_OTHER: ReservationFee = { min: 25, max: 25 };

/** Domestic fees by SNCF axe (domestic and night train reservation fees pages). */
const BY_AXE: Record<string, ReservationFee> = {
  "SUD EST": { min: 10, max: 20 }, // TGV INOUI
  EST: { min: 10, max: 20 },
  ATLANTIQUE: { min: 10, max: 20 },
  NORD: { min: 10, max: 20 },
  INTERNATIONAL: { min: 10, max: 20 }, // a stretch inside France
  "IC SRO": { min: 10, max: 20 }, // Intercités, reservation compulsory
  "IC ARO": { min: 10, max: 20 },
  "IC NUIT": { min: 10, max: 25 }, // seat €10, couchette €19–25
};

function fold(s: string): string {
  return ` ${s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
}

/** The country of a stop abroad, or undefined for a stop in France. */
export function foreignCountry(stop: string): FeeCountry | undefined {
  const f = fold(stop);
  for (const [country, names] of Object.entries(FOREIGN_STOPS) as [FeeCountry, string[]][]) {
    if (names.some((n) => f.includes(` ${n} `))) return country;
  }
  return undefined;
}

/**
 * The pass-holder fee for one SNCF train between two stops, or undefined when no fee
 * page covers it (SNCF coaches, an unknown axe).
 */
export function sncfInterrailFee(category: string | undefined, origin: string, destination: string): ReservationFee | undefined {
  const abroad = foreignCountry(origin) ?? foreignCountry(destination);
  if (abroad === "ES") return [origin, destination].some((s) => fold(s).includes(" paris ")) ? SPAIN_FROM_PARIS : SPAIN_OTHER;
  if (abroad) return BY_COUNTRY[abroad];
  return category ? BY_AXE[category] : undefined;
}

/** The fee table as published in v1/sncf/interrail/fees.json. */
export function sncfFeeTable(): unknown {
  return {
    currency: "EUR",
    class: 2,
    checked: INTERRAIL_FEES_CHECKED,
    source: INTERRAIL_FEES_URL,
    note: "Indicative pass-holder reservation fees, 2nd class; 1st class can cost more on international trains. A stop abroad sets the fee for that country, otherwise the axe does.",
    byCountry: { ...BY_COUNTRY, ES: { fromParis: SPAIN_FROM_PARIS, other: SPAIN_OTHER } },
    byAxe: BY_AXE,
    foreignStops: FOREIGN_STOPS,
  };
}
