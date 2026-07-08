// Refreshes live property counts per area+operation from propertylist.es so the
// finder can honestly say "we found N homes" without hitting the portal live.
// Run daily by cron. Reads the portal's own server-rendered "N viviendas" count.
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
    const res = await fetch(`https://propertylist.es/${op}/${slug}`, { headers: { "user-agent": UA } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/([0-9][0-9.,]*)\s+viviendas/i);
    if (!m) return null;
    return parseInt(m[1].replace(/[.,]/g, ""), 10);
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
await fs.writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), areas: withStock }, null, 2));
console.error(`\nwrote ${OUT} - ${withStock.length} areas with stock`);
