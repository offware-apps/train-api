// Find the trains a pass holder can take between two stations on one day.
// Node 18+ or any modern browser, no dependencies.
//
//   node examples/search.mjs sncf max-jeune paris-intramuros lyon-intramuros 2026-10-20
//
// Set TRAIN_API to use a mirror or a local build (e.g. http://localhost:8000/v1).

const BASE = process.env.TRAIN_API ?? "https://offware-apps.github.io/train-api/v1";

/** Expand a compact snapshot to one row per train per date (same as src/compact.ts). */
export function decodeCompact(c) {
  const rows = [];
  for (const [o, d, depart, arrive, trainNo, axe, mask] of c.trains) {
    for (let j = 0; j < mask.length; j++) {
      const n = parseInt(mask[j], 16);
      for (let b = 0; b < 4; b++) {
        if (!(n & (1 << b))) continue;
        const date = c.dates[j * 4 + b];
        if (date === undefined) continue;
        const row = { date, origin: c.stations[o], destination: c.stations[d], depart, arrive, trainNo };
        if (axe >= 0) row.category = c.axes[axe];
        rows.push(row);
      }
    }
  }
  return rows;
}

/** Parsed JSON, or null when the file doesn't exist (404). */
async function getJson(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return res.json();
}

export async function search(operator, pass, fromId, toId, date) {
  const stations = await getJson(`${operator}/stations.json`);
  if (!stations) throw new Error(`no operator "${operator}"; see ${BASE}/index.json`);
  const to = stations.find((s) => s.id === toId);
  if (!to) throw new Error(`no station "${toId}" for ${operator}; see ${BASE}/${operator}/stations.json`);
  // No file: no bookable train leaves this station with this pass.
  const snapshot = await getJson(`${operator}/${pass}/from/${fromId}.json`);
  if (!snapshot) return [];
  return decodeCompact(snapshot)
    .filter((t) => t.destination === to.name && t.date === date)
    .sort((a, b) => a.depart.localeCompare(b.depart));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [operator, pass, from, to, date] = process.argv.slice(2);
  if (!date) {
    console.error("usage: node examples/search.mjs <operator> <pass> <fromId> <toId> <YYYY-MM-DD>");
    process.exit(2);
  }
  const trains = await search(operator, pass, from, to, date);
  if (trains.length === 0) console.log("No bookable train.");
  for (const t of trains) console.log(`${t.depart} → ${t.arrive}  ${t.trainNo}  ${t.origin} → ${t.destination}`);
}
