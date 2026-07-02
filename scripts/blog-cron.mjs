#!/usr/bin/env node
/**
 * blog-cron.mjs - scheduled wrapper around generate-blog-post.mjs.
 * Deterministic, non-repeating topics tracked in a state file; generates
 * + PUBLISHES (EN + ES), then pings IndexNow for the fresh URLs.
 *
 * Topic scheme:
 *  - Fri: next unused evergreen guide from GUIDES (state-tracked).
 *  - Other days (cron runs Tue): month-stamped area market post rotating
 *    through AREAS; each area at most once per calendar month (state-tracked).
 * Usage: node scripts/blog-cron.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const STATE_PATH = '/opt/info-hub/var/admin/blog-cron-state.json';

const AREAS = ['Marbella', 'Estepona', 'Benahavis', 'Mijas', 'Fuengirola', 'Benalmadena', 'Nueva Andalucia', 'Puerto Banus', 'Casares', 'Manilva', 'Calahonda', 'Torremolinos'];
const GUIDES = [
  { key: 'non-resident-buying', topic: 'Buying property in Spain as a non-resident: the complete process, costs and timeline' },
  { key: 'taxes-itp-ibi', topic: 'Property taxes in Spain explained: ITP, IBI, plusvalia and notary costs by region' },
  { key: 'nie-bank', topic: 'NIE numbers and Spanish bank accounts: a step-by-step guide for property buyers' },
  { key: 'rent-out-rules', topic: 'Renting out your Spanish property: rules, taxes and licences explained' },
  { key: 'valuation-oracle', topic: 'How property valuation works in Spain and why notary-verified prices matter' },
  { key: 'marbella-micro-areas', topic: 'Golden Mile vs Puerto Banus vs Nueva Andalucia: where to buy in Marbella' },
  { key: 'off-plan', topic: 'Buying off-plan new developments in Spain: protections, payments and pitfalls' },
  { key: 'community-fees', topic: 'Community fees and comunidad rules in Spain: what owners actually pay for' },
];

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { usedGuides: [], areaMonths: [] }; }
};
const writeState = (st) => fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));

const now = new Date();
const monthName = now.toLocaleString('en-GB', { month: 'long' });
const year = now.getFullYear();
const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const isoWeek = Math.ceil(((now - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
const dow = now.getUTCDay(); // 5 = Fri

const state = readState();
let topic = null;
let commit = () => {};

if (dow === 5) {
  const g = GUIDES.find((x) => !state.usedGuides.includes(x.key));
  if (g) {
    topic = g.topic;
    commit = () => { state.usedGuides.push(g.key); writeState(state); };
  }
}
if (!topic) {
  for (let i = 0; i < AREAS.length; i++) {
    const a = AREAS[(isoWeek + i) % AREAS.length];
    const areaMonth = `${a.toLowerCase().replace(/\s+/g, '-')}:${monthKey}`;
    if (!state.areaMonths.includes(areaMonth)) {
      topic = `${a} property market ${monthName} ${year}: live prices, listings and notary-verified values`;
      commit = () => { state.areaMonths.push(areaMonth); writeState(state); };
      break;
    }
  }
}

if (!topic) { console.log('blog-cron: all topics covered for now - exiting.'); process.exit(0); }
console.log(`blog-cron [${new Date().toISOString()}] topic:`, topic);
if (DRY) process.exit(0);

const before = await (async () => {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=/blog/&fields=path&limit=-1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return ((await r.json()).data || []).map((x) => String(x.path || ''));
})();

const genPath = new URL('./generate-blog-post.mjs', import.meta.url).pathname;
execFileSync('node', [genPath, topic, '--publish'], { stdio: 'inherit' });
commit();

// ping IndexNow for the fresh URLs (best effort)
try {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=/blog/&fields=path&limit=-1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const after = ((await r.json()).data || []).map((x) => String(x.path || ''));
  const fresh = after.filter((p) => !before.includes(p));
  const urls = fresh.flatMap((p) => [`https://info.propertylist.es${p}`, `https://info.propertylist.es/es${p}`]);
  if (urls.length) {
    const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
    const res = await fetch('https://www.bing.com/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `https://info.propertylist.es/${key}.txt`, urlList: urls }),
    });
    console.log('IndexNow ping:', res.status, 'for', urls.length, 'urls');
  }
} catch (e) { console.log('IndexNow ping skipped:', e.message); }
