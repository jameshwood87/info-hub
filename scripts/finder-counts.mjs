// Refreshes live property counts per area+operation from propertylist.es so the
// finder can honestly say "we found N homes" without hitting the portal live.
// Run daily by cron. Uses the portal's own /portal/listings JSON API (the same
// endpoint the portal-ssr v3 frontend calls) - the count is no longer present
// in the server-rendered HTML since the 2026-07 portal rebuild.
import fs from "fs/promises";

const OUT = "/opt/info-hub/var/admin/finder-counts.json";
const OPS = ["for-sale", "for-rent", "holiday-rentals"];
// Curated main Costa del Sol towns buyers/renters actually search (slug = portal area slug).
const TOWNS = [
  ["marbella", "Marbella"],
  ["estepona", "Estepona"],
  ["mijas", "Mijas"],
  ["fuengirola", "Fuengirola"],
  ["benalmadena", "Benalmádena"],
  ["torremolinos", "Torremolinos"],
  ["san-pedro-alcantara", "San Pedro de Alcántara"],
  ["benahavis", "Benahavís"],
  ["sotogrande", "Sotogrande"],
  ["manilva", "Manilva"],
  ["casares", "Casares"],
  ["malaga", "Málaga"],
  ["nerja", "Nerja"],
  ["la-cala-de-mijas", "La Cala de Mijas"],
  ["istan", "Istán"],
  ["ojen", "Ojén"],
];

const UA = "Mozilla/5.0 (compatible; PropertyListFinder/1.0; +https://info.propertylist.es)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function countFor(op, slug) {
  try {
    const url = `https://propertylist.es/portal/listings?search_type=${op}&city=${slug}&page=1&results_count=1`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.total_count === "number" ? data.total_count : null;
  } catch { return null; }
}

const areas = [];
for (const [slug, name] of TOWNS) {
  const counts = {};
  let total = 0;
  for (const op of OPS) {
    const n = await countFor(op, slug);
    if (n != null) { counts[op] = n; total += n; }
    await sleep(1500);
  }
  areas.push({ slug, name, counts, total });
  console.error(`${name}: ${JSON.stringify(counts)}`);
}
// Keep only areas with any inventory, biggest first (nicer default order).
const withStock = areas.filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
// A fully-empty result means the portal changed or is down, not that every town
// has zero stock - keep the last good cache rather than blanking the finder.
if (withStock.length === 0) {
  console.error("\nno counts fetched - keeping existing cache untouched");
  process.exit(1);
}
await fs.writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), areas: withStock }, null, 2));
console.error(`\nwrote ${OUT} - ${withStock.length} areas with stock`);
