#!/usr/bin/env node
/**
 * index-check.mjs - weekly: sitemap URLs vs pages Google has shown (90d impressions).
 * Writes var/admin/indexation-report.json and IndexNow-pings unseen URLs (incl. areas).
 */
import fs from 'fs';
import { rawQuery } from './gsc.mjs';

const ORIGIN = 'https://info.propertylist.es';
const norm = (u) => {
  let p = String(u || '').replace(ORIGIN, '').split('?')[0];
  if (!p.startsWith('/')) return '';
  return p.endsWith('/') ? p : p + '/';
};

const xml = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
const sitemap = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => norm(m[1])).filter(Boolean);
const unique = [...new Set(sitemap)];
console.log('sitemap urls:', unique.length);

let seen = new Set();
try {
  const rows = await rawQuery(['page'], { days: 90, rowLimit: 5000 });
  for (const r of rows) seen.add(norm(r.keys[0]));
  console.log('pages with impressions (90d):', seen.size);
} catch (e) {
  console.log('gsc unavailable:', e.message);
  process.exit(0);
}

const unseen = unique.filter((p) => !seen.has(p));
const report = {
  checkedAt: new Date().toISOString(),
  total: unique.length,
  seen: unique.length - unseen.length,
  unseenCount: unseen.length,
  unseen: unseen.slice(0, 300),
};
fs.writeFileSync('/opt/info-hub/var/admin/indexation-report.json', JSON.stringify(report, null, 2));
console.log(`report: ${report.seen}/${report.total} seen by Google, ${report.unseenCount} not yet`);

// IndexNow ping the unseen (cap 200)
const toPing = unseen.slice(0, 200).map((p) => ORIGIN + p);
if (toPing.length) {
  try {
    const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
    const res = await fetch('https://www.bing.com/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: toPing }),
    });
    console.log('IndexNow ping:', res.status, 'for', toPing.length, 'unseen urls');
  } catch (e) {
    console.log('IndexNow failed:', e.message);
  }
}
