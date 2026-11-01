import type { Timetable } from "./format";
import { SAME_NAME_APART_KM, km } from "./gtfs";

/**
 * Several feeds of one country as one timetable. A station name two feeds both use is one
 * station when they place it within a few km of each other (a regional feed and the
 * national one), and two otherwise: the later one takes a number, "Gare SNCF (2)", as
 * {@link readGtfsTimetable} does inside one feed.
 */
export function mergeTimetables(list: Timetable[]): Timetable {
  const out: Timetable = { trains: [], trips: [], coords: new Map(), sameName: new Map() };
  // Every place each name stands for so far, with the name it was given.
  const places = new Map<string, { at: [number, number]; label: string }[]>();
  const seen = (label: string, at: [number, number]): void => {
    const base = label.replace(/ \(\d+\)$/, "");
    const list = places.get(base) ?? [];
    if (!list.some((p) => p.label === label)) list.push({ at, label });
    places.set(base, list);
  };
  for (const tt of list) {
    const rename = new Map<string, string>();
    for (const [name, at] of tt.coords) {
      const base = name.replace(/ \(\d+\)$/, "");
      const known = places.get(base) ?? [];
      const near = known.find((p) => km(p.at, at) <= SAME_NAME_APART_KM);
      let label = near?.label;
      if (!label) {
        let n = known.length + 1;
        label = n === 1 ? base : `${base} (${n})`;
        while (out.coords.has(label)) label = `${base} (${++n})`;
      }
      if (label !== name) rename.set(name, label);
      if (!out.coords.has(label)) out.coords.set(label, at);
      seen(label, at);
    }
    const to = (s: string): string => rename.get(s) ?? s;
    for (const t of tt.trips) out.trips.push(rename.size ? { ...t, stops: t.stops.map((s) => ({ ...s, station: to(s.station) })) } : t);
    for (const t of tt.trains) out.trains.push(rename.size ? { ...t, origin: to(t.origin), destination: to(t.destination) } : t);
  }
  for (const [base, list] of places) if (list.length > 1) out.sameName?.set(base, list.map((p) => p.at));
  return out;
}
