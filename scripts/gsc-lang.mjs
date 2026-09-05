// Search demand by country for the Website Builder pages, and for the whole
// hub, over 90 days. Impressions are the honest signal here: a bot scraping the
// page does not generate one, so this is not polluted the way raw pageviews are.
import { rawQuery } from './gsc.mjs';

const pct = (n, t) => ((n / (t || 1)) * 100).toFixed(1) + '%';

const report = async (label, pageContains) => {
  const rows = await rawQuery(['country'], { days: 90, rowLimit: 40, pageContains });
  const imp = rows.reduce((a, r) => a + r.impressions, 0);
  const clk = rows.reduce((a, r) => a + r.clicks, 0);
  console.log(`\n===== ${label}   impressions ${imp}, clicks ${clk}`);
  rows
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 14)
    .forEach((r) =>
      console.log(
        `  ${String(r.keys[0]).toUpperCase().padEnd(6)} imp ${String(r.impressions).padStart(6)} ${pct(r.impressions, imp).padStart(7)}   clicks ${String(r.clicks).padStart(4)}`,
      ),
    );
};

await report('WEBSITE BUILDER pages', 'website-builder');
await report('WHOLE HUB', '');

// Which language do the queries themselves come in? A crude but useful proxy:
// non-ASCII or known Spanish stopwords in the top queries for the builder pages.
const q = await rawQuery(['query'], { days: 90, rowLimit: 60, pageContains: 'website-builder' });
console.log(`\n===== top builder queries (${q.length})`);
q.sort((a, b) => b.impressions - a.impressions)
  .slice(0, 15)
  .forEach((r) => console.log(`  ${String(r.keys[0]).slice(0, 52).padEnd(54)} imp ${String(r.impressions).padStart(5)} clicks ${r.clicks}`));
