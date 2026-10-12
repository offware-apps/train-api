import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildOperatorApi } from "../src/api";
import { mapSncfFeed } from "../src/operators/sncf";
import { foreignCountry, sncfInterrailFee } from "../src/operators/interrail-fees";

const feed = JSON.parse(readFileSync(new URL("./fixtures/sncf-tgvmax.sample.json", import.meta.url), "utf-8")) as unknown[];

describe("Interrail reservation fees on SNCF trains", () => {
  it("tells a stop abroad from a French one", () => {
    expect(foreignCountry("MANNHEIM HBF")).toBe("DE");
    expect(foreignCountry("SAARBRUECKEN/SARREBRUCK")).toBe("DE");
    expect(foreignCountry("GENEVE CORNAVIN")).toBe("CH");
    expect(foreignCountry("OUX CESANA CLAV SESTRIERE")).toBe("IT");
    expect(foreignCountry("MODANE")).toBeUndefined();
    expect(foreignCountry("BERNAY")).toBeUndefined();
    expect(foreignCountry("PARIS (intramuros)")).toBeUndefined();
  });

  it("charges the domestic fee by axe and the international fee by the country abroad", () => {
    expect(sncfInterrailFee("SUD EST", "PARIS (intramuros)", "MARSEILLE ST CHARLES")).toEqual({ min: 10, max: 20 });
    expect(sncfInterrailFee("IC NUIT", "PARIS (intramuros)", "BRIANCON")).toEqual({ min: 10, max: 25 });
    expect(sncfInterrailFee("INTERNATIONAL", "PARIS (intramuros)", "STUTTGART HBF")).toEqual({ min: 19, max: 19 });
    expect(sncfInterrailFee("INTERNATIONAL", "PARIS (intramuros)", "ZURICH HB")).toEqual({ min: 25, max: 25 });
    expect(sncfInterrailFee("INTERNATIONAL", "LYON (intramuros)", "MILANO PORTA GARIBALDI")).toEqual({ min: 31, max: 31 });
    // A stretch of an international train inside France is a domestic trip.
    expect(sncfInterrailFee("INTERNATIONAL", "PARIS (intramuros)", "DIJON VILLE")).toEqual({ min: 10, max: 20 });
    expect(sncfInterrailFee("SUD EST", "PARIS (intramuros)", "BARCELONA SANTS")).toEqual({ min: 35, max: 35 });
    expect(sncfInterrailFee("SUD EST", "MONTPELLIER ST ROCH", "BARCELONA SANTS")).toEqual({ min: 25, max: 25 });
    expect(sncfInterrailFee("AUTOCAR SNCF", "PARIS (intramuros)", "ROUEN RIVE DROITE")).toBeUndefined();
  });

  it("publishes the fee table next to the Interrail snapshot and points to it from the index", () => {
    const { files, entry } = buildOperatorApi("sncf", "test", mapSncfFeed(feed));
    const table = files.find((f) => f.path === "v1/sncf/interrail/fees.json")?.body as { currency: string; source: string };
    expect(table.currency).toBe("EUR");
    expect(table.source).toContain("interrail.com");
    expect(entry.passes.find((p) => p.id === "interrail")?.fees).toBe("v1/sncf/interrail/fees.json");
    expect(entry.passes.find((p) => p.id === "max-jeune")?.fees).toBeUndefined();
  });
});
