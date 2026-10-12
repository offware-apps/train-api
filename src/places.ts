/**
 * Which town or city each station is in, so an app can show a station's guides and sights.
 * The places themselves come from the Offware shared data
 * (https://github.com/offware-apps/data, Wikidata, CC0); this API only links stations to
 * them, in one file:
 *
 *   v1/places.json   { "<operator>/<station id>": "<place id>" }, plus where to read a place
 *
 * See docs/format.md.
 */

export const PLACES_BASE = "https://offware-apps.github.io/data/v1";

/** Country each operator's stations are in first; a station abroad still matches by name. */
export const OPERATOR_COUNTRY: Record<string, string> = {
  sncf: "FR",
  renfe: "ES",
  nl: "NL",
  de: "DE",
  it: "IT",
  ch: "CH",
  no: "NO",
  fi: "FI",
  ie: "IE",
  se: "SE",
  gb: "GB",
};

/** Countries a train in this API can reach. A place elsewhere never matches ("Paris", Texas). */
export const EUROPE = new Set([
  "AD", "AL", "AT", "BA", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "ME", "MK", "MT",
  "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "TR", "XK",
]);

/** A town or city as the shared data's places/index.json lists it. */
export interface IndexPlace {
  id: string;
  name: string;
  names: string[];
  countryIso2: string;
  wikidata: string;
  population: number;
}

/** The shared data's places/index.json. */
export interface PlacesIndex {
  license: string;
  attribution: string;
  places: IndexPlace[];
}

export interface StationRef {
  operator: string;
  id: string;
  name: string;
}

/** v1/places.json. */
export interface StationPlaces {
  version: 1;
  updatedAt: string;
  /** A place's file: replace {id} with the place id. */
  placeUrl: string;
  license: string;
  attribution: string;
  /** "<operator>/<station id>" → place id. A station no place matched is left out. */
  stations: Record<string, string>;
}

/** Abbreviations operators use in station names ("ST ETIENNE"), read the same on both sides. */
const ABBREVIATIONS: Record<string, string> = { st: "saint", ste: "sainte" };

/** Words of a name, accents folded: "Bruxelles-Midi" → ["bruxelles", "midi"]. */
export function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => ABBREVIATIONS[w] ?? w);
}

/**
 * The place a station is in, from its name: the place whose name the station name starts
 * with, word for word ("LYON PART DIEU" → Lyon, "Frankfurt(Main)Hbf" → Frankfurt). The
 * longest name wins ("Saint-Etienne" over "Saint"); then a place in the operator's own
 * country; then the largest. A name only found inside the station name doesn't count.
 */
export function placeMatcher(places: IndexPlace[]): (station: string, country?: string) => IndexPlace | undefined {
  const byFirst = new Map<string, { words: string[]; place: IndexPlace }[]>();
  for (const place of places) {
    if (!EUROPE.has(place.countryIso2)) continue;
    for (const n of new Set([place.name, ...(place.names ?? [])])) {
      const w = words(n);
      if (w.length === 0) continue;
      const list = byFirst.get(w[0]!) ?? [];
      list.push({ words: w, place });
      byFirst.set(w[0]!, list);
    }
  }
  return (station, country) => {
    const sw = words(station);
    let best: { len: number; place: IndexPlace } | undefined;
    const home = (p: IndexPlace): number => Number(p.countryIso2 === country);
    const better = (len: number, place: IndexPlace): boolean => {
      if (!best) return true;
      if (len !== best.len) return len > best.len;
      if (home(place) !== home(best.place)) return home(place) > home(best.place);
      return place.population > best.place.population;
    };
    for (const cand of byFirst.get(sw[0] ?? "") ?? []) {
      if (cand.words.length > sw.length || !cand.words.every((w, i) => sw[i] === w)) continue;
      if (better(cand.words.length, cand.place)) best = { len: cand.words.length, place: cand.place };
    }
    return best?.place;
  };
}

export function buildStationPlaces(index: PlacesIndex, stations: StationRef[], updatedAt: string, base = PLACES_BASE): StationPlaces {
  const match = placeMatcher(index.places);
  const out: Record<string, string> = {};
  for (const s of stations) {
    const place = match(s.name, OPERATOR_COUNTRY[s.operator]);
    if (place) out[`${s.operator}/${s.id}`] = place.id;
  }
  return {
    version: 1,
    updatedAt,
    placeUrl: `${base}/places/{id}.json`,
    license: index.license,
    attribution: index.attribution,
    stations: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
  };
}
