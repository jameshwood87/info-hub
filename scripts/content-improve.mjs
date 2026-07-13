#!/usr/bin/env node
/**
 * content-improve.mjs - weekly: draft a content improvement for the top
 * striking-distance page and QUEUE it for human approval (never auto-publishes).
 * Proposals land in var/admin/content-proposals.json (status:pending) and are
 * approved/discarded from /admin/analytics. Posts a heads-up to Discord.
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
const PROPOSALS = '/opt/info-hub/var/admin/content-proposals.json';
const ORIGIN = 'https://info.propertylist.es';
const DRY = process.argv.includes('--dry-run');

// Only pages whose body renders live from Directus (NOT /general-information/ WP-import snapshots).
const RENDERABLE = /^\/(blog|estate-agents|lifestyle|food|nightlife|docs)\//;
const norm = (u) => { let p = String(u || '').replace(ORIGIN, '').split('?')[0]; return p.endsWith('/') ? p : p + '/'; };

const discord = async (content) => {
  if (!WEBHOOK) return;
  try { await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1990), username: 'PropertyList Content Lab' }) }); } catch {}
};
async function directus(path) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Directus ${res.status}`);
  return res.json();
}
async function aiJson(messages) {
  const res = await fetch(`${AI_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: 6000 }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}`);
  return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
}

let proposals = [];
try { proposals = JSON.parse(fs.readFileSync(PROPOSALS, 'utf8')); } catch {}
const now = Date.now();
const recentPaths = new Set(proposals.filter((p) => now - Date.parse(p.created) < 30 * 86400000).map((p) => p.path));

// find the best striking-distance page
const qRows = await rawQuery(['query', 'page'], { days: 28, rowLimit: 1000 });
const byPage = new Map();
for (const r of qRows) {
  const p = norm(r.keys[1]);
  if (!RENDERABLE.test(p) || recentPaths.has(p)) continue;
  if (r.position < 8 || r.position > 30 || r.impressions < 5 || /propertylist/i.test(r.keys[0])) continue;
  const cur = byPage.get(p) || { path: p, impressions: 0, queries: [] };
  cur.impressions += r.impressions;
  cur.queries.push({ q: r.keys[0], imp: r.impressions, pos: r.position });
  byPage.set(p, cur);
}
const ranked = [...byPage.values()].sort((a, b) => b.impressions - a.impressions);
if (!ranked.length) { console.log('no striking-distance pages to improve'); process.exit(0); }

const target = ranked[0];
target.queries.sort((a, b) => b.imp - a.imp);
const rec = (await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent(target.path)}&filter[language][_eq]=en&fields=id,title,body`)).data?.[0];
if (!rec) { console.log('no record for', target.path); process.exit(0); }

const bodyText = String(rec.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);
console.log(`target: ${target.path} (${target.impressions} imp) top query "${target.queries[0].q}" pos ${target.queries[0].pos.toFixed(1)}`);

const out = await aiJson([{ role: 'user', content: `You improve existing property articles for PropertyList (Costa del Sol MLS info hub). This page ALREADY ranks on page 2-3 for real searches but could reach page 1 with a focused addition that answers those searches directly.

PAGE: ${ORIGIN}${target.path}
TITLE: ${rec.title}
SEARCHES IT NEARLY RANKS FOR: ${target.queries.slice(0, 6).map((q) => `"${q.q}" (pos ${q.pos.toFixed(1)}, ${q.imp} impressions)`).join('; ')}
EXISTING CONTENT (excerpt): ${bodyText}

Write ONE new self-contained section (an <h2> plus 2-4 short <p> paragraphs, optionally a 2-3 question FAQ with <h3> questions) that directly and accurately answers the top searches above and adds genuine value not already covered. Rules: factual and specific to Spain/Costa del Sol; NEVER invent statistics, laws or figures - if you are unsure of a number, speak qualitatively; plain hyphens only, no em-dashes; do NOT repeat what the excerpt already says. Return JSON: {"heading": "the h2 text", "html": "the full HTML section starting with <h2>", "rationale": "one sentence on why this wins the click"}` }]);
const heading = String(out.heading || '').trim();
let html = String(out.html || '').replace(/\s*[—–]\s*/g, ' - ').trim();
if (!heading || !html || !/^<h2/i.test(html)) { console.log('AI output unusable, skipped'); process.exit(0); }

const proposal = {
  id: 'cp_' + Date.now().toString(36),
  path: target.path,
  pageId: String(rec.id),
  query: target.queries[0].q,
  position: Math.round(target.queries[0].pos * 10) / 10,
  impressions: target.impressions,
  heading,
  html,
  rationale: String(out.rationale || ''),
  created: new Date().toISOString(),
  status: 'pending',
};
console.log('\n--- proposed section ---\n' + html.slice(0, 500));
if (DRY) { console.log('\ndry-run: not queued'); process.exit(0); }

proposals.push(proposal);
fs.writeFileSync(PROPOSALS, JSON.stringify(proposals, null, 2));
await discord(`📝 **Content improvement proposed** ${ORIGIN}${target.path}\nTargets "${proposal.query}" (currently position ${proposal.position}, ${proposal.impressions} impressions).\nAdds section: **${heading}**\n_${proposal.rationale}_\n**Review & approve/discard in the dashboard:** ${ORIGIN}/admin/analytics`);
console.log('queued proposal', proposal.id);
