#!/usr/bin/env node
/**
 * blog-scorecard.mjs - the blog numbers for James's Monday note (24-09-26). Read-only: it
 * changes nothing and sends nothing.
 *   node scripts/blog-scorecard.mjs            this week: Google clicks and appearances, posts that
 *                                              turned 30 or 90 days old, title tests, button clicks
 *   node scripts/blog-scorecard.mjs --monthly  adds 90-day results by post type, for the monthly
 *                                              topic-mix decision (var/admin/topic-mix.json, read
 *                                              by ideas-cron.mjs)
 * Search Console lags about 3 days, so "this week" is the 7 days that end 3 days ago. A post
 * counts in English and Spanish together. Post types come from the English title and slug
 * (TYPES below) unless var/admin/blog-types.json names one: {"/blog/<slug>/": "<type>"}.
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
const VAR = '/opt/info-hub/var';
const MONTHLY = process.argv.includes('--monthly');
const DAY = 86400000;
const ORIGIN = 'https://info.propertylist.es';

const TYPES = [
  ['law and tax explainers', /\b(laws?|legal|ley|decrees?|decreto|tax|taxes|irpf|itp|iva|ibi|plusval[ií]a|regulations?|rules|licen[cs]e|licencia|court|tribunal|golden visa|rent[- ]cap|registration|registro|vut|vft|tenancy|lau)\b/i],
  ['local events', /\b(what'?s on|events?|festivals?|concerts?|fiestas?|ferias?)\b/i],
  ['prices and town data', /\b(prices?|premiums?|worth|values?|per m2|m2|square met|oracle|days on market|inventory|cheapest|most expensive|fastest|sold|market report|how much)\b|€/i],
  ['buyer and seller guides', /\b(guide|how to|steps?|checklist|buying|buy|selling|sell|mortgage|moving|relocat\w*|living in|cost of|nie|notary)\b/i],
];
let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(`${VAR}/admin/blog-types.json`, 'utf8')); } catch {}
const typeOf = (key, title) => overrides[key] || (TYPES.find(([, re]) => re.test(`${title} ${key.replace(/[-/]/g, ' ')}`)) || ['other'])[0];

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const dmy = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}-${m}-${y.slice(2)}`; };
const n = (x) => Math.round(x).toLocaleString('en-GB');
const keyOf = (p) => { const s = String(p || '').replace(ORIGIN, '').split('?')[0].replace(/^\/es(?=\/blog\/)/, ''); return s.endsWith('/') ? s : `${s}/`; };
const isBlog = (p) => /^\/(es\/)?blog\/[^/]/.test(String(p || '').replace(ORIGIN, ''));

async function directus(path) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Directus ${res.status}`);
  return res.json();
}
// clicks, appearances and appearance-weighted position per post (EN + ES), for a date range
async function perPost(start, end) {
  const rows = await rawQuery(['page'], { startDate: start, endDate: end, rowLimit: 5000 });
  const out = new Map();
  for (const r of rows) {
    if (!isBlog(r.keys[0])) continue;
    const k = keyOf(r.keys[0]);
    const x = out.get(k) || { clicks: 0, impressions: 0, posSum: 0 };
    x.clicks += r.clicks; x.impressions += r.impressions; x.posSum += r.position * r.impressions;
    out.set(k, x);
  }
  return out;
}
const total = (m) => [...m.values()].reduce((a, x) => ({ clicks: a.clicks + x.clicks, impressions: a.impressions + x.impressions }), { clicks: 0, impressions: 0 });
const pos = (x) => (x && x.impressions ? (x.posSum / x.impressions).toFixed(1) : '-');

// published posts, keyed by the English path; the English record gives title and date, and a
// post published only in Spanish (its English twin still a draft) counts with its Spanish title
const fields = 'fields=id,path,title,date_created&limit=1000';
const recs = (await directus(`/items/kb_pages?filter[path][_starts_with]=/blog/&filter[status][_eq]=published&${fields}`)).data || [];
const recsEs = (await directus(`/items/kb_pages?filter[path][_starts_with]=/es/blog/&filter[status][_eq]=published&${fields}`)).data || [];
const posts = new Map(recs.map((r) => [keyOf(r.path), { key: keyOf(r.path), title: r.title, created: String(r.date_created || '').slice(0, 10), type: typeOf(keyOf(r.path), r.title) }]));
for (const r of recsEs) if (!posts.has(keyOf(r.path))) posts.set(keyOf(r.path), { key: keyOf(r.path), title: `${r.title} (Spanish only)`, created: String(r.date_created || '').slice(0, 10), type: typeOf(keyOf(r.path), r.title) });

const lastDay = Date.now() - 3 * DAY;
const week = { start: iso(lastDay - 6 * DAY), end: iso(lastDay) };
const prev = { start: iso(lastDay - 13 * DAY), end: iso(lastDay - 7 * DAY) };
const [wk, pw] = [await perPost(week.start, week.end), await perPost(prev.start, prev.end)];
const tw = total(wk), tp = total(pw);
const lines = [];
lines.push(`### Blog: ${dmy(week.start)} to ${dmy(week.end)} (Google data lags 3 days)`);
lines.push(`- Google: ${n(tw.clicks)} clicks from ${n(tw.impressions)} appearances; the week before, ${n(tp.clicks)} from ${n(tp.impressions)}.`);
const top = [...wk.entries()].filter(([, x]) => x.clicks > 0).sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 3);
lines.push(`- Most clicked: ${top.length ? top.map(([k, x]) => `${(posts.get(k) || {}).title || k} (${x.clicks})`).join('; ') : 'no post had a click'}.`);
lines.push(`- Posts with at least one click this week: ${[...wk.values()].filter((x) => x.clicks > 0).length} of ${posts.size} published.`);

// posts that turned 30 or 90 days old this week, with their first 30 or 90 days
for (const age of [30, 90]) {
  const from = iso(lastDay - (age + 6) * DAY), to = iso(lastDay - age * DAY);
  const turning = [...posts.values()].filter((p) => p.created && p.created >= from && p.created <= to);
  if (!turning.length) { lines.push(`- Turned ${age} days old this week: none.`); continue; }
  lines.push(`- Turned ${age} days old this week (their first ${age} days):`);
  for (const p of turning) {
    const m = await perPost(p.created, iso(Date.parse(p.created) + (age - 1) * DAY));
    const x = m.get(p.key) || { clicks: 0, impressions: 0 };
    lines.push(`  - ${p.title} (${p.type}): ${n(x.clicks)} clicks, ${n(x.impressions)} appearances, position ${pos(x)}`);
  }
}

// blog button clicks from the site's own counter, over the same 7 days as the Google figures
try {
  const ev = JSON.parse(fs.readFileSync(`${VAR}/event-stats.json`, 'utf8'));
  const byPost = new Map();
  for (const [d, byPath] of Object.entries(ev.days || {})) {
    if (d < week.start || d > week.end) continue;
    for (const [p, kinds] of Object.entries(byPath)) {
      if (!isBlog(p)) continue;
      for (const [k, c] of Object.entries(kinds)) if (k.startsWith('cta:')) byPost.set(keyOf(p), (byPost.get(keyOf(p)) || 0) + c);
    }
  }
  const sum = [...byPost.values()].reduce((a, b) => a + b, 0);
  lines.push(`- Blog button clicks, same 7 days: ${sum}${sum ? ` (${[...byPost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => `${(posts.get(k) || {}).title || k}: ${c}`).join('; ')})` : ''}.`);
} catch {
  lines.push('- Blog button clicks: the counter file could not be read.');
}

// title tests (all content pages, not only the blog)
try {
  const ledger = JSON.parse(fs.readFileSync(`${VAR}/admin/ctr-experiments.json`, 'utf8'));
  const since = Date.now() - 7 * DAY;
  const startedNow = ledger.filter((e) => e.status === 'active' && Date.parse(e.applied || 0) >= since);
  const judgedNow = ledger.filter((e) => e.result && Date.parse(e.result.judged_at || 0) >= since);
  const failedNow = ledger.filter((e) => e.status === 'failed_checks' && Date.parse(e.attempted_at || 0) >= since);
  const running = ledger.filter((e) => e.status === 'active').length;
  const words = { better: 'better', worse: 'worse', no_clear_difference: 'no clear difference', too_little_data: 'too little traffic to tell' };
  lines.push(`- Title tests: ${startedNow.length} started, ${judgedNow.length} judged, ${running} running${failedNow.length ? `, ${failedNow.length} skipped by the checks` : ''}.`);
  for (const e of judgedNow) lines.push(`  - ${e.path}: ${words[e.result.verdict] || e.result.verdict}, ${e.result.action}`);
} catch {
  lines.push('- Title tests: the ledger could not be read.');
}

if (MONTHLY) {
  const start = iso(lastDay - 89 * DAY), end = iso(lastDay);
  const m90 = await perPost(start, end);
  const old = [...posts.values()].filter((p) => p.created && p.created <= iso(lastDay - 30 * DAY));
  const byType = new Map();
  for (const p of old) {
    const x = m90.get(p.key) || { clicks: 0, impressions: 0 };
    const t = byType.get(p.type) || { posts: 0, clicks: 0, impressions: 0, zero: 0 };
    t.posts++; t.clicks += x.clicks; t.impressions += x.impressions; if (!x.clicks) t.zero++;
    byType.set(p.type, t);
  }
  lines.push('');
  lines.push(`### Blog by post type, ${dmy(start)} to ${dmy(end)} (posts at least 30 days old)`);
  lines.push('| Post type | Posts | Clicks | Appearances | Clicks per post | Posts with no clicks |');
  lines.push('|---|---|---|---|---|---|');
  for (const [t, x] of [...byType.entries()].sort((a, b) => b[1].clicks / b[1].posts - a[1].clicks / a[1].posts)) {
    lines.push(`| ${t} | ${x.posts} | ${n(x.clicks)} | ${n(x.impressions)} | ${(x.clicks / x.posts).toFixed(1)} | ${x.zero} |`);
  }
  const best = old.map((p) => [p, m90.get(p.key) || { clicks: 0, impressions: 0 }]).sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 5);
  lines.push(`- Top posts: ${best.map(([p, x]) => `${p.title} (${p.type}, ${x.clicks} clicks)`).join('; ')}.`);
  const other = old.filter((p) => p.type === 'other');
  if (other.length) lines.push(`- Not classified (name a type in var/admin/blog-types.json): ${other.map((p) => p.key).join(', ')}.`);
  let mix = null;
  try { mix = JSON.parse(fs.readFileSync(process.env.TOPIC_MIX_PATH || `${VAR}/admin/topic-mix.json`, 'utf8')); } catch {}
  lines.push(`- Topic mix in use: ${mix ? `more [${(mix.more || []).join(', ')}], fewer [${(mix.less || []).join(', ')}]${mix.decided ? `, decided ${mix.decided}` : ''}` : 'none yet'}. To change it, write var/admin/topic-mix.json; ideas-cron reads it on Sunday.`);
}

console.log(lines.join('\n'));
