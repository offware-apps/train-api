import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildArchive, writeArchive } from "../scripts/archive-max";
import fixture from "./fixtures/sncf-tgvmax.sample.json";

const row = (date: string, train: string, seat: string) => ({
  date,
  origine: "PARIS (intramuros)",
  destination: "LYON (intramuros)",
  heure_depart: "8:00",
  heure_arrivee: "10:00",
  train_no: train,
  od_happy_card: seat,
});

describe("MAX seat archive", () => {
  it("stores each service once with a flag per day", () => {
    const a = buildArchive(
      [row("2026-10-05", "6601", "OUI"), row("2026-10-07", "6601", "NON"), row("2026-10-06", "6605", "OUI")],
      "2026-10-05",
    );
    expect(a.start).toBe("2026-10-05");
    expect(a.days).toBe(3);
    expect(a.services).toEqual([
      ["PARIS (intramuros)", "LYON (intramuros)", "6601", "08:00", "1.0"],
      ["PARIS (intramuros)", "LYON (intramuros)", "6605", "08:00", ".1."],
    ]);
  });

  it("keeps a free seat when the feed lists a service twice on one day", () => {
    const a = buildArchive([row("2026-10-05", "6601", "NON"), row("2026-10-05", "6601", "OUI")], "2026-10-05");
    expect(a.services[0]?.[4]).toBe("1");
  });

  it("archives the whole fixture and never overwrites a day", () => {
    const a = buildArchive(fixture, "2026-06-25");
    expect(a.services.length).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), "archive-"));
    const path = writeArchive(a, dir);
    expect(path).toBe(join(dir, "2026", "2026-06-25.json.gz"));
    expect(JSON.parse(gunzipSync(readFileSync(path!)).toString())).toEqual(a);
    expect(writeArchive(a, dir)).toBeNull();
  });
});
