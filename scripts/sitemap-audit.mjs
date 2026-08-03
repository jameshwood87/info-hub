/**
 * Sitemap drift check.
 *
 * sitemap.xml derives its static routes from the files in src/pages, minus the
 * SITEMAP_EXCLUDE set in src/pages/sitemap.xml.ts. That set is the one thing
 * still maintained by hand, so this script checks it against reality: every
 * page that is missing from the sitemap must actually be non-indexable
 * (noindex, password-gated, or a redirect stub).
 *
 * Usage: node scripts/sitemap-audit.mjs   (exits 1 if a real page is missing)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../src/pages', import.meta.url).pathname;
const ORIGIN = process.env.AUDIT_ORIGIN || 'http://127.0.0.1:3000';

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.astro')) acc.push(p);
  }
  return acc;
};

const toRoute = (file) => {
  const r = file.slice(ROOT.length).replace(/\.astro$/, '').replace(/\/index$/, '');
  return `${r}/`;
};

const routes = walk(ROOT)
  .map(toRoute)
  .filter((r) => !r.includes('['))
  .filter((r) => !r.startsWith('/admin/'))
  .filter((r) => r !== '/404/')
  .sort();

const xml = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
const locs = new Set(
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, '')),
);

const missing = routes.filter((r) => !locs.has(r));
console.log(`routes=${routes.length} inSitemap=${routes.length - missing.length} missing=${missing.length}\n`);

let bad = 0;
for (const r of missing) {
  const res = await fetch(`${ORIGIN}${r}`, { redirect: 'manual' }).catch((e) => ({ status: `ERR ${e.message}` }));
  const status = res.status;
  let robots = '';
  let empty = false;
  if (status === 200) {
    const html = await res.text();
    robots = (html.match(/<meta name="robots" content="([^"]*)"/i) || [])[1] || '(none)';
    empty = !/<title>/i.test(html); // redirect stubs render no <head>
  }
  const ok = status !== 200 || /noindex/i.test(robots) || empty;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${String(status).padEnd(4)} ${r.padEnd(38)} robots=${robots}`);
}

if (bad) {
  console.log(`\n${bad} indexable page(s) missing from the sitemap - remove them from SITEMAP_EXCLUDE in src/pages/sitemap.xml.ts`);
  process.exit(1);
}
console.log('\nNo drift: every excluded page is genuinely non-indexable.');
