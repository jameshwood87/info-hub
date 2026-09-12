// Daily data for /budget/ ("What does your budget actually buy?").
// Pulls EVERY live for-sale listing per town from the portal's own
// /portal/listings JSON API (the same universe the page's deep links open, so
// the counts always match what the visitor sees when they click through), then
// computes per town:
//   - m2eur: median asking EUR/m2 across listings with a sane build size
//   - counts: homes at-or-under each budget point of a fixed grid (the page
//     interpolates between points for typed budgets and marks those "~")
//   - minPrice: for the "nothing under this budget, cheapest is X" zero state
// Plus the Oracle notary-verified EUR/m2 via the MCP for the honesty strip.
// Towns with fewer than MIN_N listings are excluded from the comparison (a
// median over 11 homes is a coin flip) but recorded under "thin".
// Run daily by cron at 04:50, after finder-counts.
import fs from "fs/promises";

const OUT = "/opt/info-hub/var/admin/budget-data.json";
const MIN_N = 25;
const UA = "Mozilla/5.0 (compatible; PropertyListBudget/1.0; +https://info.propertylist.es)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same curated portal city slugs as the finder, plus Puerto Banus (the
// expensive anchor that makes the comparison land). mcpName feeds the Oracle.
const TOWNS = [
  ["marbella", "Marbella", "Marbella"],
  ["puerto-banus", "Puerto Banús", "Puerto Banus"],
  ["estepona", "Estepona", "Estepona"],
  ["mijas", "Mijas", "Mijas"],
  ["fuengirola", "Fuengirola", "Fuengirola"],
  ["benalmadena", "Benalmádena", "Benalmadena"],
  ["torremolinos", "Torremolinos", "Torremolinos"],
  ["san-pedro-alcantara", "San Pedro de Alcántara", "San Pedro de Alcantara"],
  ["benahavis", "Benahavís", "Benahavis"],
  ["sotogrande", "Sotogrande", "Sotogrande"],
  ["manilva", "Manilva", "Manilva"],
  ["casares", "Casares", "Casares"],
  ["malaga", "Málaga", "Malaga"],
  ["nerja", "Nerja", "Nerja"],
  ["la-cala-de-mijas", "La Cala de Mijas", "La Cala de Mijas"],
  ["istan", "Istán", "Istan"],
  ["ojen", "Ojén", "Ojen"],
];

// Budget grid. Preset chips on the page are grid members, so chip counts are
// exact; typed budgets in between interpolate and display with "~".
const GRID = [
  100000, 150000, 200000, 250000, 300000, 350000, 400000, 450000, 500000,
  600000, 700000, 750000, 800000, 900000, 1000000, 1250000, 1500000, 1750000, 2000000,
  2500000, 3000000, 4000000, 5000000, 7500000, 10000000,
];

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function fetchAllListings(slug) {
  const all = [];
  let total = null;
  for (let page = 1; page <= 30; page++) {
    try {
      const url = `https://propertylist.es/portal/listings?search_type=for-sale&city=${slug}&page=${page}&results_count=100`;
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.total_count === "number") total = data.total_count;
      const rows = Array.isArray(data.results) ? data.results : [];
      for (const r of rows) {
        const price = Number(r.price);
        if (!Number.isFinite(price) || price < 20000) continue; // junk guard
        const build = Number(r.build_size);
        all.push({
          price,
          build: Number.isFinite(build) && build >= 25 && build <= 3000 ? build : null,
        });
      }
      if (!rows.length || (total != null && all.length >= total)) break;
      await sleep(700);
    } catch {
      return null;
    }
  }
  return { listings: all, total };
}

async function oracleFor(mcpName, key) {
  if (!key) return null;
  try {
    const res = await fetch("https://mcp.propertylist.es/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": UA,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "area_market_summary", arguments: { location: mcpName, search_type: "for-sale" } },
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const o = d?.result?.structuredContent?.oracle;
    if (!o || !o.verified) return null;
    const m2 = Number(o.verified_price_per_sqm);
    const n = Number(o.sample_size);
    return Number.isFinite(m2) ? { m2: Math.round(m2), n: Number.isFinite(n) ? n : null } : null;
  } catch {
    return null;
  }
}

const env = await fs.readFile("/opt/info-hub/.env", "utf8").catch(() => "");
// Anchored to the start of a line, or a commented-out key wins. The .env
// keeps dead keys as comments for the record, and an unanchored match took
// the first one it saw anywhere in the file: from 21 Aug 2026 that was
// "#EXPIRED-2026-08-21 PROPERTYLIST_MCP_KEY=...", sitting twelve lines above
// the live key. Every Oracle call 401d, oracleFor swallowed it, and the
// notary-verified column on /budget/ was empty for three weeks with nothing
// in the logs to say why.
const mcpKey = env.match(/^PROPERTYLIST_MCP_KEY=(\S+)/m)?.[1] || "";
if (!mcpKey) console.error("WARN: no PROPERTYLIST_MCP_KEY in .env - the notary-verified column will be empty");

const towns = [];
const thin = [];
for (const [slug, name, mcpName] of TOWNS) {
  const got = await fetchAllListings(slug);
  if (!got) { console.error(`${name}: fetch failed, skipped`); continue; }
  const { listings, total } = got;
  const n = listings.length;
  if (n < MIN_N) {
    thin.push({ slug, name, n });
    console.error(`${name}: ${n} listings (thin, excluded)`);
    await sleep(1200);
    continue;
  }
  const perM2 = listings.filter((l) => l.build).map((l) => l.price / l.build);
  const m2eur = Math.round(median(perM2));
  const prices = listings.map((l) => l.price).sort((a, b) => a - b);
  const counts = GRID.map((g) => prices.filter((p) => p <= g).length);
  const oracle = await oracleFor(mcpName, mcpKey);
  towns.push({
    slug, name, n,
    apiTotal: total,
    m2eur,
    medPrice: Math.round(median(prices)),
    minPrice: prices[0],
    counts,
    sized: perM2.length, // how many listings had a usable build size
    oracle,
  });
  console.error(`${name}: n=${n} m2eur=${m2eur} min=${prices[0]} oracle=${oracle ? oracle.m2 : "-"}`);
  await sleep(1200);
}

// A key that has expired or been revoked fails exactly like a town with no
// notarial coverage: quietly, one town at a time. Losing every one of them
// at once is a broken credential, not the market, so say so.
if (mcpKey && towns.length && !towns.some((t) => t.oracle)) {
  console.error("WARN: no town returned an Oracle figure - check PROPERTYLIST_MCP_KEY is live");
}

// Cheapest EUR/m2 first: the "your money goes furthest" order the page renders.
towns.sort((a, b) => a.m2eur - b.m2eur);

// A collapse to nothing means the portal API changed or is down, not that the
// coast sold out overnight. Keep the last good cache rather than blanking.
if (towns.length < 5) {
  console.error(`only ${towns.length} towns fetched - keeping existing cache untouched`);
  process.exit(1);
}

await fs.mkdir("/opt/info-hub/var/admin", { recursive: true });
await fs.writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), grid: GRID, towns, thin }, null, 1));
console.error(`wrote ${OUT}: ${towns.length} towns, ${thin.length} thin`);
