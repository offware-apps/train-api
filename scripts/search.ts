/**
 * Search journeys from the command line, on the published bundles or on a folder of them:
 *   npm run search -- madrid amsterdam 2026-10-12 [08:00]
 *   TRAIN_API=public/v2 npm run search -- paris madrid 2026-10-12
 * OPERATORS=sncf,renfe loads only those. Prints how each name matched, then the journeys.
 */
import { DEFAULT_API, loadBundles } from "../src/load";
import { Network } from "../src/search";

const [fromQ = "", toQ = "", date = new Date().toISOString().slice(0, 10), time] = process.argv.slice(2);
const operators = process.env.OPERATORS?.split(",").map((s) => s.trim()).filter(Boolean);
const t0 = Date.now();
const { index, bundles } = await loadBundles(process.env.TRAIN_API ?? DEFAULT_API, { operators });
const t1 = Date.now();
const network = new Network(bundles);
console.log(
  `timetables ${index.updatedAt}: ${bundles.map((b) => b.operator).join(", ")}; ${network.places.length} places ` +
    `(loaded in ${t1 - t0} ms, indexed in ${Date.now() - t1} ms)`,
);
const from = network.resolve(fromQ);
const to = network.resolve(toQ);
for (const [q, m] of [[fromQ, from], [toQ, to]] as const) {
  const names = m ? m.places.map((i) => network.places[i]?.name).join("; ") : "";
  console.log(`"${q}" → ${m ? `${m.kind} ${m.name} (${names})` : "no match"}`);
}
if (!from || !to) process.exit(1);
for (const round of ["first search", "again"]) {
  const t2 = Date.now();
  const journeys = network.journeys(from, to, date, { time });
  console.log(`${round}: ${journeys.length} journeys in ${Date.now() - t2} ms`);
  if (round !== "first search") break;
  for (const j of journeys) {
    console.log(`\n${j.departure} → ${j.arrival}  ${Math.floor(j.duration / 60)}h${String(j.duration % 60).padStart(2, "0")}, ${j.changes} change(s)`);
    for (const l of j.legs) {
      console.log(`  ${l.departure.slice(11)} ${l.from} → ${l.arrival.slice(11)} ${l.to}   [${l.operator} ${l.category ?? ""} ${l.trainNo}]`);
    }
  }
  console.log();
}
