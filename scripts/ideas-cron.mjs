#!/usr/bin/env node
/**
 * ideas-cron.mjs - weekly blog-idea research for info.propertylist.es.
 * Sources: Google News RSS (ES + EN property/law terms) + competitor blog feeds.
 * AI does gap analysis vs our existing posts, ranks 5 ideas, auto-queues the top 2
 * into var/admin/blog-topics-queue.json (consumed by blog-cron before its static
 * list), and posts the shortlist to Discord (DISCORD_IDEAS_WEBHOOK in .env).
 * Usage: node scripts/ideas-cron.mjs [--dry-run]
 */
import fs from 'fs';
import { gscResearch } from './gsc.mjs';

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
const QUEUE_PATH = '/opt/info-hub/var/admin/blog-topics-queue.json';
const DRY = process.argv.includes('--dry-run');

const NEWS_FEEDS = [
  ['Google News ES (ley vivienda / alquiler turistico)', 'https://news.google.com/rss/search?q=%22ley+de+vivienda%22+OR+%22alquiler+tur%C3%ADstico%22+Espa%C3%B1a+when:7d&hl=es&gl=ES&ceid=ES:es'],
  ['Google News EN (Spain property)', 'https://news.google.com/rss/search?q=Spain+property+market+OR+%22Costa+del+Sol%22+real+estate+when:7d&hl=en-GB&gl=GB&ceid=GB:en'],
  ['Google News ES (Malaga inmobiliario)', 'https://news.google.com/rss/search?q=vivienda+OR+inmobiliario+M%C3%A1laga+OR+Andaluc%C3%ADa+when:7d&hl=es&gl=ES&ceid=ES:es'],
];
const COMPETITOR_FEEDS = [
  ['Spanish Property Insight', 'https://www.spanishpropertyinsight.com/feed/'],
  ['Idealista News (EN)', 'https://www.idealista.com/en/news/rss'],
  ['Kyero blog', 'https://www.kyero.com/blog/feed'],
  ['ThinkSpain', 'https://www.thinkspain.com/rss'],
  ['SUR in English', 'https://www.surinenglish.com/rss/2.0/portada'],
  // official + regulation-focused: catch actual law/tax changes, not just market chatter
  ['Google News ES (BOE / ley alquiler / IRPF vivienda)', 'https://news.google.com/rss/search?q=(BOE+OR+%22real+decreto%22+OR+IRPF+OR+ITP+OR+plusval%C3%ADa)+(vivienda+OR+alquiler+OR+inmobiliario)+when:10d&hl=es&gl=ES&ceid=ES:es'],
  ['Google News ES (Junta de Andalucia vivienda / turistico)', 'https://news.google.com/rss/search?q=(%22Junta+de+Andaluc%C3%ADa%22+OR+BOJA)+(vivienda+OR+%22alquiler+tur%C3%ADstico%22+OR+VFT)+when:10d&hl=es&gl=ES&ceid=ES:es'],
  ['Google News EN (Spain property tax / law change)', 'https://news.google.com/rss/search?q=Spain+property+(tax+OR+law+OR+regulation+OR+%22non-resident%22)+change+when:10d&hl=en-GB&gl=GB&ceid=GB:en'],
];

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; info-hub-ideas)' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
};
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();
const parseRss = (xml, cap = 12) => {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < cap) {
    const block = m[1];
    const t = /<title>([\s\S]*?)<\/title>/.exec(block);
    const l = /<link>([\s\S]*?)<\/link>/.exec(block);
    const d = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block);
    const title = decode(t && t[1]);
    if (!title) continue;
    items.push({ title, link: decode(l && l[1]), date: decode(d && d[1]) });
  }
  return items;
};

async function aiJson(messages, maxTokens = 4000, temperature = 0.5) {
  const url = `${AI_BASE}/chat/completions`;
  const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [{ ...base, max_tokens: maxTokens, temperature }, { ...base, max_completion_tokens: maxTokens }];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
    lastErr = `${res.status}: ${text.slice(0, 200)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI failed: ${lastErr}`);
}

// ---- gather ----
const sections = [];
for (const [label, url] of NEWS_FEEDS) {
  try {
    const items = parseRss(await fetchText(url));
    if (items.length) sections.push(`## NEWS: ${label}\n` + items.map((i) => `- ${i.title} (${i.date || 'recent'})`).join('\n'));
    console.log(`news ok: ${label} (${items.length})`);
  } catch (e) { console.log(`news skip: ${label} (${e.message})`); }
}
for (const [label, url] of COMPETITOR_FEEDS) {
  try {
    const items = parseRss(await fetchText(url), 10);
    if (items.length) sections.push(`## COMPETITOR: ${label}\n` + items.map((i) => `- ${i.title}`).join('\n'));
    console.log(`competitor ok: ${label} (${items.length})`);
  } catch (e) { console.log(`competitor skip: ${label} (${e.message})`); }
}
// ---- Search Console: striking-distance keywords (our own data) ----
const gsc = await gscResearch(28);
if (gsc && gsc.striking.length) {
  sections.push('## OUR SEARCH CONSOLE DATA - STRIKING DISTANCE (we rank position 8-30; a better/dedicated post can reach page 1):\n' +
    gsc.striking.map((r) => `- "${r.query}" -> ${r.page.replace('https://info.propertylist.es', '')} (impressions ${r.impressions}, position ${r.position.toFixed(1)})`).join('\n'));
  console.log(`gsc ok: ${gsc.striking.length} striking-distance queries`);
}
if (gsc && gsc.top.length) {
  sections.push('## OUR TOP SEARCH QUERIES (28 days, by impressions):\n' +
    gsc.top.map((r) => `- "${r.query}" (impressions ${r.impressions}, clicks ${r.clicks}, position ${r.position.toFixed(1)})`).join('\n'));
}

if (!sections.length) { console.log('no sources reachable - exiting'); process.exit(0); }

// ---- our existing coverage ----
const ours = [];
for (const pfx of ['/blog/', '/general-information/', '/estate-agents/', '/lifestyle/', '/food/', '/nightlife/']) {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=${encodeURIComponent(pfx)}&filter[language][_eq]=en&fields=title&limit=-1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  for (const x of (await r.json()).data || []) ours.push(String(x.title || ''));
}

// current queue + static topics (avoid proposing what is already planned)
let queue = [];
try { queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); } catch {}
const planned = queue.map((q) => q.topic);

// ---- AI gap analysis ----
const prompt = `You are the content strategist for PropertyList (info.propertylist.es), the Spanish property MLS info hub targeting Costa del Sol buyers, owners, landlords and estate agents. Our unfair advantage: live MLS listing data and notary-verified prices (Price Oracle) that competitors cannot cite.

Below is this week's raw research: property news headlines and competitor blog posts.

${sections.join('\n\n')}

WE ALREADY COVER (do not duplicate):
${ours.map((t) => `- ${t}`).join('\n')}
${planned.length ? 'ALREADY QUEUED:\n' + planned.map((t) => `- ${t}`).join('\n') : ''}

Give extra weight to the SEARCH CONSOLE sections: a striking-distance query is the strongest possible signal (real demand where we nearly rank). Propose the 5 best NEW blog-post ideas for next week. PRIORITISE, in order: (a) breaking or recent law / tax / regulation changes affecting Spanish or Andalucian property - rental caps, tourist-licence rules, ITP/IRPF/plusvalia, non-resident tax, new decrees (ALWAYS mark these hot=true; a dated, specific regulation post is our single best SEO bet because it ranks fast and earns for months), (b) topics competitors rank on where we can write a better, data-backed version, (c) strong buyer/landlord search intent. Avoid anything we already cover or that is queued.

Write every topic, angle and keyword in ENGLISH (articles are written in English first, then translated to Spanish). Return JSON: {"ideas":[{"topic":"full working title","angle":"1 sentence: our unique angle / why we win","target_keyword":"main search phrase","hot":true|false,"source":"which headline/competitor inspired it"}]} with exactly 5 ideas, best first. Plain hyphens only, no em-dashes.`;

const out = await aiJson([{ role: 'user', content: prompt }], 4000);
const ideas = Array.isArray(out.ideas) ? out.ideas.slice(0, 5) : [];
if (!ideas.length) { console.log('AI returned no ideas - exiting'); process.exit(0); }
for (const i of ideas) console.log(`${i.hot ? '[HOT] ' : ''}${i.topic} | ${i.target_keyword}`);

if (DRY) { console.log('--- dry run: not queueing / posting ---'); process.exit(0); }

// ---- queue ALL hot (breaking law/regulation) ideas + best evergreen; cap at 4 so we do not overfill ----
const hot = ideas.filter((i) => i.hot);
const evergreen = ideas.filter((i) => !i.hot);
const toQueue = [...hot, ...evergreen].slice(0, Math.max(2, Math.min(4, hot.length + 1)));
const now = new Date().toISOString();
for (const i of toQueue) queue.push({ topic: String(i.topic), hot: Boolean(i.hot), keyword: String(i.target_keyword || ''), added: now, source: 'ideas-cron' });
fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
console.log(`queued ${toQueue.length} topics (queue length now ${queue.length})`);

// ---- Discord ----
if (WEBHOOK) {
  const line = (i, n) => `${n}. ${i.hot ? '⚡' : '📗'} **${i.topic}**\n   _${i.angle || ''}_ · kw: \`${i.target_keyword || '-'}\`${toQueue.includes(i) ? ' · **QUEUED**' : ''}`;
  const content = [`📚 **Weekly blog ideas** (${new Date().toLocaleDateString('en-GB')}) - top ${toQueue.length} auto-queued for the Tue/Fri auto-blog:`,
    ...ideas.map((i, n) => line(i, n + 1)),
    `_Reply here + tell Claude to swap/remove any of these before Tuesday._`].join('\n').slice(0, 1990);
  try {
    const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, username: 'PropertyList Ideas' }) });
    console.log('Discord post:', res.status);
  } catch (e) { console.log('Discord post failed:', e.message); }
} else console.log('no DISCORD_IDEAS_WEBHOOK configured - skipped Discord');
