#!/usr/bin/env node
/**
 * ctr-experiments.mjs - weekly CTR optimization loop.
 * 1) Reports active experiments >=14 days old (before vs after) to Discord.
 * 2) Starts ONE new experiment: worst high-impression/low-CTR page, AI-rewrites
 *    title/seo to match its real queries, applies, logs baseline in the ledger.
 */
import fs from 'fs';
import { rawQuery } from './gsc.mjs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const WEBHOOK = (process.env.DISCORD_IDEAS_WEBHOOK || '').trim();
const LEDGER = '/opt/info-hub/var/admin/ctr-experiments.json';
const ORIGIN = 'https://info.propertylist.es';
const DRY = process.argv.includes('--dry-run');

const norm = (u) => { let p = String(u || '').replace(ORIGIN, '').split('?')[0]; return p.endsWith('/') ? p : p + '/'; };
const discord = async (content) => {
  if (!WEBHOOK) return;
  try { await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1990), username: 'PropertyList CTR Lab' }) }); } catch {}
};
async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Directus ${res.status}`);
  return res.json();
}
async function aiJson(messages) {
  const res = await fetch(`${AI_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: 6000 }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}`);
  return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
}

let ledger = [];
try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch {}

// ---- 1) report matured experiments ----
const now = Date.now();
const rows14 = await rawQuery(['page'], { days: 14, rowLimit: 2000 });
const cur = {};
for (const r of rows14) cur[norm(r.keys[0])] = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
for (const e of ledger) {
  if (e.status !== 'active') continue;
  if (now - Date.parse(e.applied) < 14 * 86400000) continue;
  const after = cur[e.path] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  e.after = after;
  e.status = 'reported';
  const b = e.before || {};
  const emoji = after.ctr > (b.ctr || 0) ? '✅' : '➖';
  await discord(`${emoji} **CTR experiment result** ${ORIGIN}${e.path}\nBefore: ${((b.ctr || 0) * 100).toFixed(1)}% CTR (${b.impressions} imp, pos ${b.position})\nAfter (14d): ${(after.ctr * 100).toFixed(1)}% CTR (${after.impressions} imp, pos ${after.position.toFixed(1)})`);
  console.log('reported:', e.path);
}

// ---- 2) start one new experiment ----
const rows28 = await rawQuery(['page'], { days: 28, rowLimit: 2000 });
const CONTENT = /^\/(blog|general-information|estate-agents|lifestyle|food|nightlife|neighbourhood|docs)\//;
const recent = new Set(ledger.filter((e) => now - Date.parse(e.applied) < 60 * 86400000).map((e) => e.path));
const candidates = rows28
  .map((r) => ({ path: norm(r.keys[0]), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
  .filter((r) => CONTENT.test(r.path) && r.impressions >= 100 && r.ctr < 0.015 && !recent.has(r.path))
  .sort((a, b) => b.impressions - a.impressions);

if (!candidates.length) {
  console.log('no new experiment candidates');
} else {
  for (const c of candidates.slice(0, 3)) {
  const rec = (await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent(c.path)}&filter[language][_eq]=en&fields=id,title,seo_title,seo_description`)).data?.[0];
  if (!rec) { console.log('no directus record for', c.path); continue; }
    const slug = c.path.split('/').filter(Boolean).pop();
    const qRows = await rawQuery(['query', 'page'], { days: 28, rowLimit: 500, pageContains: slug });
    const topQ = qRows.sort((a, b) => b.impressions - a.impressions).slice(0, 6).map((r) => `"${r.keys[0]}" (${r.impressions} imp, pos ${r.position.toFixed(1)})`);
    console.log('candidate:', c.path, `imp=${c.impressions} ctr=${(c.ctr * 100).toFixed(1)}% pos=${c.position.toFixed(1)}`);

    const out = await aiJson([{ role: 'user', content: `You are an SEO title optimiser. This page ranks but almost nobody clicks it.

PAGE: ${ORIGIN}${c.path}
CURRENT TITLE: ${rec.title}
CURRENT SEO TITLE: ${rec.seo_title || '-'}
CURRENT META DESCRIPTION: ${rec.seo_description || '-'}
28-DAY STATS: ${c.impressions} impressions, ${(c.ctr * 100).toFixed(1)}% CTR, avg position ${c.position.toFixed(1)}
REAL QUERIES IT APPEARS FOR: ${topQ.join('; ') || 'unknown'}

Write a replacement that matches the query language, answers the searcher's question in the description first sentence, and earns the click without clickbait. Plain hyphens only, no em-dashes. Return JSON: {"title": "...", "seo_title": "max 60 chars", "seo_description": "max 158 chars"}` }]);
    const clean = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').trim();
    const title = clean(out.title), seoT = clean(out.seo_title), seoD = clean(out.seo_description);
    if (title && seoT && seoD && !DRY) {
      const isDocsPath = c.path.startsWith('/docs/');
      // docs titles appear in the manual nav - only touch SERP-facing fields there
      await directus(`/items/kb_pages/${rec.id}`, { method: 'PATCH', body: isDocsPath ? { seo_title: seoT, seo_description: seoD } : { title, seo_title: seoT, seo_description: seoD } });
      ledger.push({ path: c.path, id: String(rec.id), applied: new Date().toISOString(), before: { ctr: c.ctr, impressions: c.impressions, position: c.position, title: rec.title }, newTitle: title, status: 'active', source: 'auto' });
      try {
        const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
        await fetch('https://www.bing.com/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: [ORIGIN + c.path] }) });
      } catch {}
      await discord(`🧪 **New CTR experiment started** ${ORIGIN}${c.path}\nBaseline: ${c.impressions} imp, ${(c.ctr * 100).toFixed(1)}% CTR, pos ${c.position.toFixed(1)}\nOld: ${rec.title}\nNew: **${title}**\nResults in 14 days.`);
      console.log('applied:', title);
    } else {
      console.log(DRY ? 'dry-run: would apply -> ' + title : 'AI output incomplete, skipped');
    }
  }
}

if (!DRY) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
console.log('ledger size:', ledger.length);
