/**
 * The open train format (v1): one shape every operator maps to.
 *
 * One `Train` is one train running between two stops on one date. Each pass the
 * operator's data knows about says whether the train is bookable with it and what is
 * known about a seat. See docs/format.md.
 */

/** Passes the API knows. Add one here, then teach each operator's mapper about it. */
export const PASSES = ["max-jeune", "max-senior", "interrail"] as const;
export type PassId = (typeof PASSES)[number];

/** "free" / "full" when the data says so; "unknown" when no open data does (Interrail). */
export type SeatStatus = "free" | "full" | "unknown";

export interface PassAvailability {
  /** Can a holder of this pass travel on this train (with a reservation where needed)? */
  bookable: boolean;
  seat: SeatStatus;
}

export interface Train {
  operator: string;
  /** "YYYY-MM-DD", the departure date. */
  date: string;
  /** Station names exactly as the operator publishes them. */
  origin: string;
  destination: string;
  /** "HH:MM" local time. An arrival before the departure means the next day. */
  depart: string;
  arrive: string;
  trainNo: string;
  /** Line or train family, when the operator gives one (SNCF: the "axe"). */
  category?: string;
  passes: Partial<Record<PassId, PassAvailability>>;
}

/** What a pass's snapshot can promise, published in the API index. */
export interface PassInfo {
  id: PassId;
  name: string;
  /** False when no open data says whether a seat is left for this pass. */
  seatKnown: boolean;
  /** Where its holders book. */
  bookingUrl: string;
  /** Pass rules the data can't check, for clients to show. */
  note?: string;
}

export const PASS_INFO: Record<PassId, PassInfo> = {
  "max-jeune": {
    id: "max-jeune",
    name: "MAX JEUNE",
    seatKnown: true,
    bookingUrl: "https://www.sncf-connect.com/",
  },
  "max-senior": {
    id: "max-senior",
    name: "MAX SENIOR",
    seatKnown: true,
    bookingUrl: "https://www.sncf-connect.com/",
    note: "Weekdays only, off-peak. Weekend trains are left out; peak periods (Friday afternoon and evening, Monday morning, eves of holidays) are not in the data, so check before booking.",
  },
  interrail: {
    id: "interrail",
    name: "Interrail",
    seatKnown: false,
    bookingUrl: "https://www.sncf-connect.com/",
    note: "Every train here needs a paid pass-holder reservation. A Global Pass covers only one outbound and one return trip inside your country of residence.",
  },
};
