#!/usr/bin/env node
/**
 * ctr-experiments.mjs - weekly CTR optimization loop.
 * 1) Reports active experiments >=14 days old (before vs after) to Discord.
 * 2) PROPOSES new titles for the worst high-impression/low-CTR pages (up to 3), written
 *    by the model from their real queries, and emails James one-click approve / reject
 *    links. Nothing changes on the site until he approves (24-09-26: the titles used to
 *    be applied straight to live pages). Approve applies it and starts the 14-day
 *    measurement: src/pages/api/seo/ctr-approve.ts.
 */
import fs from 'fs';
import { createHmac, randomBytes } from 'node:crypto';
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
  if (!DRY) await discord(`${emoji} **CTR experiment result** ${ORIGIN}${e.path}\nBefore: ${((b.ctr || 0) * 100).toFixed(1)}% CTR (${b.impressions} imp, pos ${b.position})\nAfter (14d): ${(after.ctr * 100).toFixed(1)}% CTR (${after.impressions} imp, pos ${after.position.toFixed(1)})`);
  console.log('reported:', e.path);
}

// ---- 2) start one new experiment ----
// Language guard (04-09-26): a page is only rewritten from queries in its own language,
// and always in its own language. Other-language impressions belong to the twin page.
const EN_WORDS = /\b(the|and|of|in|your|what|how|to|for|guide|with|is|a|do|does|can|spain|spanish)\b/i;
const ES_WORDS = /\b(de|la|el|y|que|qu\u00e9|como|c\u00f3mo|en|para|del|los|las|gu\u00eda|una|un|es|cuanto|cu\u00e1nto|espa\u00f1a)\b/i;
const queryLang = (q) => { const e = (q.match(new RegExp(EN_WORDS.source, 'gi')) || []).length; const s = (q.match(new RegExp(ES_WORDS.source, 'gi')) || []).length; return e > s ? 'en' : s > e ? 'es' : '?'; };
const pageLang = (p) => (p.startsWith('/es/') ? 'es' : 'en');
const NOT_OURS = /property\s*finder|idealista|fotocasa|kyero|rightmove|zoopla|bayut|dubizzle/i;

const rows28 = await rawQuery(['page'], { days: 28, rowLimit: 2000 });
const CONTENT = /^\/(blog|general-information|estate-agents|lifestyle|food|nightlife|neighbourhood|docs)\//;
// a page with a proposal, rejection or experiment in the last 60 days is left alone
const recent = new Set(ledger.filter((e) => now - Date.parse(e.applied || e.proposed_at || 0) < 60 * 86400000).map((e) => e.path));
const proposals = [];
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
    const qRowsAll = await rawQuery(['query', 'page'], { days: 28, rowLimit: 500, pageContains: slug });
    const lang = pageLang(c.path);
    const totalImp = qRowsAll.reduce((a, r) => a + r.impressions, 0) || 1;
    const qRows = qRowsAll.filter((r) => queryLang(r.keys[0]) !== (lang === 'en' ? 'es' : 'en') && !NOT_OURS.test(r.keys[0]));
    const ownImp = qRows.reduce((a, r) => a + r.impressions, 0);
    if (ownImp / totalImp < 0.4) { console.log('skip (other-language or third-party queries dominate, belongs to the twin page):', c.path); continue; }
    const topQ = qRows.sort((a, b) => b.impressions - a.impressions).slice(0, 6).map((r) => `"${r.keys[0]}" (${r.impressions} imp, pos ${r.position.toFixed(1)})`);
    console.log('candidate:', c.path, `imp=${c.impressions} ctr=${(c.ctr * 100).toFixed(1)}% pos=${c.position.toFixed(1)}`);

    const out = await aiJson([{ role: 'user', content: `You are an SEO title optimiser. This page ranks but almost nobody clicks it.

PAGE: ${ORIGIN}${c.path}
CURRENT TITLE: ${rec.title}
CURRENT SEO TITLE: ${rec.seo_title || '-'}
CURRENT META DESCRIPTION: ${rec.seo_description || '-'}
28-DAY STATS: ${c.impressions} impressions, ${(c.ctr * 100).toFixed(1)}% CTR, avg position ${c.position.toFixed(1)}
REAL QUERIES IT APPEARS FOR: ${topQ.join('; ') || 'unknown'}

Write the replacement in ${lang === 'es' ? 'SPANISH' : 'ENGLISH'}, the language of the page, whatever language the queries are in, answers the searcher's question in the description first sentence, and earns the click without clickbait. Plain hyphens only, no em-dashes. Return JSON: {"title": "...", "seo_title": "max 60 chars", "seo_description": "max 158 chars"}` }]);
    const clean = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').trim();
    const title = clean(out.title), seoT = clean(out.seo_title), seoD = clean(out.seo_description);
    const isDocsPath = c.path.startsWith('/docs/');
    if (!title || !seoT || !seoD) { console.log('AI output incomplete, skipped'); continue; }
    if (title === rec.title && seoT === (rec.seo_title || '') && seoD === (rec.seo_description || '')) { console.log('proposal identical to the current title, skipped'); continue; }
    // docs titles appear in the manual nav - approve only touches SERP-facing fields there
    const entry = {
      pid: randomBytes(6).toString('hex'), path: c.path, id: String(rec.id), isDocs: isDocsPath, status: 'proposed', source: 'auto',
      proposed_at: new Date().toISOString(),
      before: { ctr: c.ctr, impressions: c.impressions, position: c.position, title: rec.title, seo_title: rec.seo_title || '', seo_description: rec.seo_description || '' },
      proposed: isDocsPath ? { seo_title: seoT, seo_description: seoD } : { title, seo_title: seoT, seo_description: seoD },
      queries: topQ.slice(0, 4),
    };
    proposals.push(entry);
    if (!DRY) ledger.push(entry);
    console.log(DRY ? `dry-run: would propose -> ${title}` : `proposed (${entry.pid}): ${title}`);
  }
}

if (!DRY) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
console.log('ledger size:', ledger.length);

// ---- 3) email the proposals to James with signed approve / reject links ----
if (proposals.length && !DRY) {
  const envText = fs.readFileSync('/opt/info-hub/.env', 'utf8');
  const cfg = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const KEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es', SECRET = cfg('BLOG_APPROVE_SECRET');
  if (!KEY || !TO || !SECRET) {
    console.log('ctr-experiments: proposals saved but NOT emailed (missing MANDRILL_API_KEY / NOTIFY_TO / BLOG_APPROVE_SECRET)');
  } else {
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    const link = (pid, action) => `${ORIGIN}/api/seo/ctr-approve?pid=${pid}&exp=${exp}&action=${action}&sig=${createHmac('sha256', SECRET).update(`ctr|${pid}|${exp}|${action}`).digest('hex')}`;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const btn = (href, label, bg) => `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:999px;margin:6px 8px 6px 0">${label}</a>`;
    const row = (label, before, after) => (before === after ? '' : `<tr><td style="padding:4px 8px 4px 0;color:#667085;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0"><span style="color:#98a2b3;text-decoration:line-through">${esc(before) || '(empty)'}</span><br><b>${esc(after)}</b></td></tr>`);
    const blocks = proposals.map((p) => `<div style="border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px;margin:0 0 14px">
<p style="margin:0 0 6px"><a href="${ORIGIN}${esc(p.path)}">${esc(p.path)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#667085">Last 28 days: ${p.before.impressions} impressions, ${(p.before.ctr * 100).toFixed(1)}% click rate, average position ${Number(p.before.position).toFixed(1)}. Top searches: ${esc(p.queries.join('; ')) || 'unknown'}</p>
<table style="border-collapse:collapse;font-size:14px">${p.proposed.title ? row('Title', p.before.title, p.proposed.title) : ''}${row('Search title', p.before.seo_title, p.proposed.seo_title)}${row('Description', p.before.seo_description, p.proposed.seo_description)}</table>
<p style="margin:8px 0 0">${btn(link(p.pid, 'approve'), 'Approve and apply', '#0a6d61')}${btn(link(p.pid, 'reject'), 'Reject', '#b42318')}</p></div>`).join('');
    const html = `<div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;color:#101828">
<h2 style="margin:0 0 6px;font-size:21px">New search titles to approve</h2>
<p style="margin:0 0 14px;color:#667085;font-size:14px">These pages show up in Google but few people click. Nothing has changed on the site: approving applies the new title and starts a 14-day before and after measurement.</p>
${blocks}<p style="font-size:12px;color:#98a2b3">Links expire in 7 days. A page with a pending or rejected proposal is not proposed again for 60 days.</p></div>`;
    const text = proposals.map((p) => `${ORIGIN}${p.path}\nNow: ${p.before.seo_title || p.before.title}\nProposed: ${p.proposed.seo_title}\nApprove: ${link(p.pid, 'approve')}\nReject: ${link(p.pid, 'reject')}`).join('\n\n');
    const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: KEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO, type: 'to' }], subject: `[SEO] ${proposals.length} search title${proposals.length === 1 ? '' : 's'} to approve`, html, text } }),
    });
    console.log('proposal email:', res.status, (await res.text()).slice(0, 100));
  }
}
