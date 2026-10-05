import type { PassInfo } from "../format";

/**
 * Where an Interrail holder books each operator's trains, and whether they need a
 * reservation. Reservation rules come from the operators' own pass pages and change;
 * clients should show the note, not decide for the traveller.
 */
export const INTERRAIL_BY_OPERATOR: Record<string, Pick<PassInfo, "bookingUrl" | "note">> = {
  sncf: {
    bookingUrl: "https://www.sncf-connect.com/en-en/",
    note: "Every TGV INOUI, Intercités, night and international train here needs a paid pass-holder reservation. A Global Pass covers only one outbound and one return trip inside your country of residence.",
  },
  renfe: {
    bookingUrl: "https://www.renfe.com/es/en",
    note: "High-speed and long-distance trains (AVE, Alvia, Euromed, Intercity) need a paid pass-holder reservation; medium-distance trains need a free one.",
  },
  nl: {
    bookingUrl: "https://www.ns.nl/en",
    note: "Domestic trains need no reservation. Eurostar needs a paid pass-holder reservation; ICE and Intercity direct don't within the Netherlands.",
  },
  de: {
    bookingUrl: "https://int.bahn.de/en",
    note: "ICE, IC and EC trains within Germany need no reservation (one is optional). Trains to France and some night trains need a paid reservation.",
  },
  it: {
    bookingUrl: "https://www.trenitalia.com/en.html",
    note: "Frecciarossa, Frecciargento, Frecciabianca, Intercity and night trains need a paid pass-holder reservation. Regionale and Regionale Veloce trains don't.",
  },
  ch: {
    bookingUrl: "https://www.sbb.ch/en",
    note: "Most trains need no reservation. TGV Lyria and some international EuroCity and night trains need a paid one.",
  },
  no: {
    bookingUrl: "https://www.vy.no/en",
    note: "Long-distance trains (F lines and SJ) need a paid seat reservation. Regional trains don't.",
  },
  fi: {
    bookingUrl: "https://www.vr.fi/en",
    note: "InterCity, Pendolino and night trains need a paid seat reservation. Regional trains don't.",
  },
  ie: {
    bookingUrl: "https://www.irishrail.ie/en-ie/",
    note: "No reservation needed.",
  },
  se: {
    bookingUrl: "https://www.sj.se/en",
    note: "SJ high-speed, long-distance and night trains need a paid pass-holder reservation. Regional trains don't.",
  },
  gb: {
    bookingUrl: "https://www.nationalrail.co.uk/",
    note: "No reservation needed, except on the Caledonian Sleeper.",
  },
};
