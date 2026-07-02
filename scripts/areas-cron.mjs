#!/usr/bin/env node
/**
 * areas-cron.mjs - weekly area-guide maintenance.
 *  1. DRIFT REFRESH: baseline every live area against the MCP; when a market
 *     moves materially (listings +-15% [min 5] or median +-10%), regenerate
 *     that guide via add-area.mjs (grounded EN+ES, updates date_updated ->
 *     sitemap lastmod). Max 4 regens/run; first run only records baselines.
 *  2. SCOUT: probe candidate areas without pages; when one reaches >= 15
 *     for-sale listings, create its guide. Max 2 creations/run.
 *  3. Pings IndexNow for every changed/created URL.
 * State: var/admin/areas-cron-state.json.  Usage: node scripts/areas-cron.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const STATE_PATH = '/opt/info-hub/var/admin/areas-cron-state.json';
const MAX_REGEN = 4;
const MAX_CREATE = 2;
const SCOUT_MIN_LISTINGS = 15;

// Malaga-province candidates without pages yet (multi-province deferred: no Cadiz e.g. Sotogrande)
const CANDIDATES = [
  ['Coín', 'coin'], ['El Rosario', 'el-rosario'], ['Río Real', 'rio-real'],
  ['Alhaurín el Grande', 'alhaurin-el-grande'], ['Nagüeles', 'nagueles'],
  ['La Mairena', 'la-mairena'], ['Torreblanca', 'torreblanca'], ['Istán', 'istan'],
  ['La Duquesa', 'la-duquesa'], ['Alhaurín de la Torre', 'alhaurin-de-la-torre'],
  ['Rincón de la Victoria', 'rincon-de-la-victoria'], ['Torrox', 'torrox'],
  ['Vélez-Málaga', 'velez-malaga'], ['Frigiliana', 'frigiliana'], ['Monda', 'monda'],
  ['Alora', 'alora'], ['Cártama', 'cartama'], ['Antequera', 'antequera'],
  ['Bahía de Marbella', 'bahia-de-marbella'], ['Costalita', 'costalita'],
];

const log = (...a) => console.log(`[areas-cron ${new Date().toISOString()}]`, ...a);
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { snapshots: {} }; } };
const writeState = (st) => fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));

async function mcpSale(loc) {
  try {
    const res = await fetch('https://mcp.propertylist.es/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'area_market_summary', arguments: { location: loc, search_type: 'for-sale' } } }),
    });
    const sc = (await res.json())?.result?.structuredContent || {};
    return { listings: Number(sc.total_listings) || 0, median: Number(sc.median_price) || 0 };
  } catch { return null; }
}

async function livePages() {
  const res = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=/neighbourhood/&filter[status][_eq]=published&filter[language][_eq]=en&fields=path,title&limit=-1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = ((await res.json()).data || []);
  return data
    .map((p) => {
      const parts = String(p.path || '').split('/').filter(Boolean);
      if (parts.length !== 2) return null;
      const slug = parts[1];
      const name = String(p.title || '')
        .replace(/\s+(?:neighbourhood|area)\s+guide\s*$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      return name && slug ? { name, slug } : null;
    })
    .filter(Boolean);
}

const state = readState();
const changed = [];
const areas = await livePages();
log(`live areas: ${areas.length}`);

// ---- 1. drift refresh ----
let regens = 0;
for (const a of areas) {
  const now = await mcpSale(a.name);
  if (!now || (!now.listings && !now.median)) continue; // MCP miss - leave alone
  const base = state.snapshots[a.slug];
  if (!base) {
    state.snapshots[a.slug] = { ...now, at: new Date().toISOString() };
    continue;
  }
  const dListings = base.listings ? Math.abs(now.listings - base.listings) / base.listings : 0;
  const dMedian = base.median ? Math.abs(now.median - base.median) / base.median : 0;
  const drifted = (dListings >= 0.15 && Math.abs(now.listings - base.listings) >= 5) || dMedian >= 0.1;
  if (drifted && regens < MAX_REGEN) {
    log(`drift ${a.slug}: listings ${base.listings}->${now.listings}, median ${base.median}->${now.median} - regenerating`);
    if (!DRY) {
      try {
        execFileSync('node', [new URL('./add-area.mjs', import.meta.url).pathname, `--name=${a.name}`, `--slug=${a.slug}`], { stdio: 'inherit' });
        state.snapshots[a.slug] = { ...now, at: new Date().toISOString() };
        changed.push(a.slug);
        regens++;
      } catch (e) { log(`regen FAILED ${a.slug}: ${e.message}`); }
    } else regens++;
  }
}

// ---- 2. scout new areas ----
const haveSlugs = new Set(areas.map((a) => a.slug));
const found = [];
for (const [name, slug] of CANDIDATES) {
  if (haveSlugs.has(slug)) continue;
  const now = await mcpSale(name);
  if (now && now.listings >= SCOUT_MIN_LISTINGS) found.push({ name, slug, listings: now.listings, median: now.median });
}
found.sort((x, y) => y.listings - x.listings);
for (const c of found.slice(0, MAX_CREATE)) {
  log(`scout: ${c.name} has ${c.listings} listings - creating guide`);
  if (!DRY) {
    try {
      execFileSync('node', [new URL('./add-area.mjs', import.meta.url).pathname, `--name=${c.name}`, `--slug=${c.slug}`], { stdio: 'inherit' });
      state.snapshots[c.slug] = { listings: c.listings, median: c.median, at: new Date().toISOString() };
      changed.push(c.slug);
    } catch (e) { log(`create FAILED ${c.slug}: ${e.message}`); }
  }
}
if (found.length > MAX_CREATE) log(`scout queue (next runs): ${found.slice(MAX_CREATE).map((c) => `${c.slug}(${c.listings})`).join(', ')}`);

if (!DRY) writeState(state);

// ---- 3. IndexNow ----
if (changed.length && !DRY) {
  try {
    const urls = changed.flatMap((s) => [
      `https://info.propertylist.es/neighbourhood/andalucia/malaga/${s}/`,
      `https://info.propertylist.es/es/barrios/${s}/`,
    ]);
    const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
    const r = await fetch('https://www.bing.com/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `https://info.propertylist.es/${key}.txt`, urlList: urls }),
    });
    log(`IndexNow: ${r.status} for ${urls.length} urls`);
  } catch (e) { log(`IndexNow skipped: ${e.message}`); }
}
log(`done. regens=${regens} created=${Math.min(found.length, MAX_CREATE)} changed=[${changed.join(', ')}]`);
