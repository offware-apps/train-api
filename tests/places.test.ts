import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildStationPlaces, placeMatcher, type PlacesIndex } from "../src/places";

const index = JSON.parse(readFileSync(new URL("./fixtures/places-index.json", import.meta.url), "utf-8")) as PlacesIndex;
const match = placeMatcher(index.places);
const id = (station: string, country?: string): string | undefined => match(station, country)?.id;

describe("station to place", () => {
  it("matches the place a station name starts with", () => {
    expect(id("LYON PART DIEU", "FR")).toBe("lyon");
    expect(id("PARIS (intramuros)", "FR")).toBe("paris");
    expect(id("Frankfurt(Main)Hbf", "DE")).toBe("frankfurt");
    expect(id("Madrid-Puerta de Atocha", "ES")).toBe("madrid");
  });

  it("folds accents and abbreviations, and prefers the longest name", () => {
    expect(id("ST ETIENNE CHATEAUCREUX", "FR")).toBe("saint-etienne");
    expect(id("SAINT ETIENNE CHATEAUCREUX", "FR")).toBe("saint-etienne");
  });

  it("prefers a place in the operator's country, then the largest", () => {
    expect(id("VALENCE TGV", "FR")).toBe("valence");
    expect(id("Valencia Joaquín Sorolla", "ES")).toBe("valencia");
    expect(id("Valence Ville")).toBe("valencia");
  });

  it("never matches a place outside Europe, or a name only found inside the station's", () => {
    expect(match("Paris", "US")?.countryIso2).toBe("FR");
    expect(id("Marne-la-Vallée Chessy", "FR")).toBeUndefined();
    expect(id("Aéroport Lyon Saint-Exupéry", "FR")).toBeUndefined();
  });

  it("writes one place id per matched station, with the dataset's licence", () => {
    const out = buildStationPlaces(
      index,
      [
        { operator: "sncf", id: "lyon-part-dieu", name: "LYON PART DIEU" },
        { operator: "renfe", id: "valencia-joaquin-sorolla", name: "Valencia Joaquín Sorolla" },
        { operator: "sncf", id: "chessy", name: "MARNE LA VALLEE CHESSY" },
      ],
      "2026-10-12T00:00:00.000Z",
    );
    expect(out.stations).toEqual({ "renfe/valencia-joaquin-sorolla": "valencia", "sncf/lyon-part-dieu": "lyon" });
    expect(out.license).toBe("CC0-1.0");
    expect(out.attribution).toContain("Wikidata");
    expect(out.placeUrl).toBe("https://offware-apps.github.io/data/v1/places/{id}.json");
  });
});
