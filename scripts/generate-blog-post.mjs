#!/usr/bin/env node
/**
 * generate-blog-post.mjs - AI blog generator for info.propertylist.es
 * Creates DRAFT kb_pages (EN + ES) in Directus for human review.
 * Uses an OpenAI-compatible API (OpenRouter by default) + the PropertyList MCP/Oracle.
 *
 * Env (read from process.env or ../.env):
 *   DIRECTUS_URL (default http://127.0.0.1:8055), DIRECTUS_ADMIN_TOKEN
 *   OPENAI_API_KEY  (OpenRouter or OpenAI key)
 *   OPENAI_BASE_URL (default https://openrouter.ai/api/v1)
 *   BLOG_MODEL      (default openai/gpt-5-mini)
 * Usage: node scripts/generate-blog-post.mjs ["optional topic"]  [--dry-run]
 */
import fs from 'fs';
import { legalCurrencyBlock } from './lib/legal-currency.mjs';

// ---- minimal .env loader (does not override real env) ----
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
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const DRY = process.argv.includes('--dry-run');
const PUBLISH = process.argv.includes('--publish');

if (!AI_KEY) { console.error('Missing OPENAI_API_KEY (OpenRouter key).'); process.exit(1); }
if (!DRY && !DIRECTUS_TOKEN) { console.error('Missing DIRECTUS_ADMIN_TOKEN.'); process.exit(1); }

const TOPICS = [
  'Buying property in Spain as a non-resident: the complete 2026 process',
  'Property taxes in Spain explained: ITP, IBI, plusvalia and notary costs',
  'Costa del Sol market report 2026: price per m2 by area',
  'Marbella vs Estepona vs Benahavis: where to buy and why',
  'NIE numbers and Spanish bank accounts: a step-by-step guide for buyers',
  'Renting out your Spanish property: rules, taxes and the 2026 rent-cap law',
  'How property valuation works in Spain and why verified prices matter',
];

// ---- helpers ----
// The model sometimes wraps its JSON in a markdown code fence, and sometimes it
// runs out of output tokens and stops mid-string. Both used to kill the run: an
// unterminated string at position 9423 blocked every scheduled run from
// 21-08-26 to 01-09-26. Clean the response first, then retry once if needed.
const extractJson = (raw) => {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  return s;
};

async function aiRaw(messages, maxTokens, temperature) {
  const url = `${AI_BASE}/chat/completions`;
  const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [
    { ...base, max_tokens: maxTokens, temperature },
    { ...base, max_completion_tokens: maxTokens }, // GPT-5/o style fallback
  ];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) {
      const j = JSON.parse(text);
      return { content: j.choices?.[0]?.message?.content || '', finish: j.choices?.[0]?.finish_reason || 'unknown' };
    }
    lastErr = `${res.status}: ${text.slice(0, 300)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI request failed: ${lastErr}`);
}

async function aiJson(messages, maxTokens = 8000, temperature = 0.7) {
  const first = await aiRaw(messages, maxTokens, temperature);
  try {
    return JSON.parse(extractJson(first.content));
  } catch (err) {
    console.log(`AI response was not usable JSON (${err.message}; finish_reason=${first.finish}, ${String(first.content).length} chars) - retrying once with a larger output budget.`);
  }
  const retry = messages.concat([{ role: 'user', content: 'Your previous answer was truncated or was not valid JSON, so it could not be parsed. Send the same content again as one compact valid JSON object: no code fences, no commentary before or after it, every string closed and every HTML tag closed. Keep the article complete but do not pad it.' }]);
  const second = await aiRaw(retry, Math.min(Math.round(maxTokens * 1.6), 32000), temperature);
  try {
    return JSON.parse(extractJson(second.content));
  } catch (err) {
    throw new Error(`AI returned unparseable JSON twice (${err.message}; finish_reason=${second.finish}). First 200 chars of the response: ${String(second.content).slice(0, 200)}`);
  }
}

async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Directus ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function marketData() {
  const areas = ['Marbella', 'Estepona', 'Benahavis', 'Nueva Andalucia', 'Puerto Banus', 'San Pedro Alcantara', 'Sotogrande', 'Mijas'];
  const lines = [];
  for (const area of areas) {
    try {
      const res = await fetch('https://mcp.propertylist.es/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'area_market_summary', arguments: { location: area, search_type: 'for-sale' } } }),
      });
      const s = (await res.json())?.result?.structuredContent;
      if (!s || !s.total_listings) continue;
      let l = `- ${area}: ${s.total_listings} active for-sale listings; median EUR ${Number(s.median_price).toLocaleString('en-US')}; median EUR ${Number(s.median_price_per_sqm).toLocaleString('en-US')}/m2`;
      const o = s.oracle;
      if (o?.verified && o.verified_price_per_sqm) {
        l += `. NOTARY-VERIFIED EUR ${Number(o.verified_price_per_sqm).toLocaleString('en-US')}/m2 (Spanish notarial register) source: ${o.attestation_url}`;
      }
      lines.push(l);
    } catch {}
  }
  return lines.length >= 3 ? lines.join('\n') : '';
}

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
// Also strips NUL and other C0 control characters: Postgres refuses 0x00 in
// text, and one NUL in a translation killed the whole 25-08-26 run.
const noDashes = (s) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');
const decodeEntities = (s) => {
  let out = String(s || '');
  for (let i = 0; i < 3; i++) {
    const prev = out;
    out = out
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&#8217;|&rsquo;/g, '\u2019').replace(/&#8216;|&lsquo;/g, '\u2018')
      .replace(/&nbsp;/g, ' ');
    if (out === prev) break;
  }
  return out;
};

// ---- main ----
const topic = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || TOPICS[Math.floor(Math.random() * TOPICS.length)];
console.log(`Topic: ${topic}\nModel: ${MODEL} @ ${AI_BASE}`);

const market = await marketData();
console.log(market ? `Market data: ${market.split('\n').length} areas (incl. Oracle-verified)` : 'Market data: unavailable (continuing without)');

const system = 'You are a senior property-market editor for PropertyList, the Spanish property MLS information hub. You write authoritative, genuinely useful, original guides for buyers, sellers and agents. Voice: calm, expert, data-led, plain-spoken. Use plain hyphens only - NEVER em-dashes or en-dashes.\n\n'
  + legalCurrencyBlock()
  + '\nIf the topic refers to one of the retired laws above, write about the current position instead and say plainly that the decree was repealed on 30-04-26. Never present it as in force.';
const user = `Write a comprehensive, original blog article in English on: "${topic}".
${market ? `\nVERIFIED MARKET DATA (use ONLY these real figures; never invent numbers; when you cite a notary-verified price, link its source as an HTML <a> tag):\n${market}\n` : ''}
Requirements:
- 1,500-2,000 words. HTML body using <h2> headings (mix questions and statements), short paragraphs, a comparison <table> where useful, and a short FAQ section (3-5 Q&As) near the end.
- Information-first and accurate; practical for a real buyer/seller. Cite the verified figures above where relevant.
- No invented statistics. No em-dashes or en-dashes (plain hyphens only).
- Sources: when citing, prefer PRIMARY sources (BOE, ministries, INE, notarial bodies) and major news wires. NEVER link competitor property portals or their blogs (Idealista, Fotocasa, Kyero, ThinkSpain and similar).
Return a JSON object with keys: title, slug, description (a 150-200 character excerpt), body (HTML string), seo_title (<=60 chars), seo_description (<=160 chars).`;

// 9,000 output tokens was not enough for a 2,000 word HTML article once the
// model spent part of the budget on reasoning: the body came back cut in half
// and the JSON would not parse. 20,000 leaves headroom.
let post;
try {
  post = await aiJson([{ role: 'system', content: system }, { role: 'user', content: user }], 20000);
} catch (err) {
  console.error('generate-blog-post: EN article generation failed.', err.message);
  process.exit(1);
}
for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) post[k] = noDashes(post[k]);
for (const k of ['title', 'description', 'seo_title', 'seo_description']) post[k] = decodeEntities(post[k]);
const slug = slugify(post.slug || post.title);
console.log(`Generated EN: "${post.title}" (${String(post.body).replace(/<[^>]+>/g, ' ').split(/\s+/).length} words, slug=${slug})`);

if (DRY) { console.log('\n--- DRY RUN: not writing to Directus ---'); console.log(String(post.body).slice(0, 600)); process.exit(0); }

const en = await directus('/items/kb_pages', { method: 'POST', body: {
  status: PUBLISH ? 'published' : 'draft', language: 'en', path: `/blog/${slug}`,
  title: post.title, description: post.description, body: post.body,
  seo_title: post.seo_title, seo_description: post.seo_description,
} });
console.log(`EN draft created: id=${en.data?.id} path=/blog/${slug}`);

// translate to ES
let tr;
try {
  tr = await aiJson([{ role: 'user', content: `Translate this property blog content from English to Spanish. Keep ALL HTML tags, attributes and URLs exactly. Translate only visible text. Use plain hyphens, no em-dashes. Return JSON with keys: title, description, body, seo_title, seo_description.\n\nTITLE:\n${post.title}\n\nDESCRIPTION:\n${post.description}\n\nBODY:\n${post.body}\n\nSEO_TITLE:\n${post.seo_title}\n\nSEO_DESCRIPTION:\n${post.seo_description}` }], 24000, 0.2);
} catch (err) {
  console.error('generate-blog-post: ES translation failed.', err.message);
  console.error(`The EN draft was already created at /blog/${slug}; delete or rename it before this topic is retried.`);
  process.exit(1);
}
for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) tr[k] = noDashes(tr[k]);
for (const k of ['title', 'description', 'seo_title', 'seo_description']) tr[k] = decodeEntities(tr[k]);
const es = await directus('/items/kb_pages', { method: 'POST', body: {
  status: PUBLISH ? 'published' : 'draft', language: 'es', path: `/es/blog/${slug}`,
  title: tr.title, description: tr.description, body: tr.body,
  seo_title: tr.seo_title, seo_description: tr.seo_description,
} });
console.log(`ES draft created: id=${es.data?.id} path=/es/blog/${slug}`);

// ---- auto-assign a featured image (deduped against recent posts) ----
// Each rule offers MULTIPLE candidates so consecutive posts in the same
// theme don't collapse onto one image. Selection skips any image used in
// the last N posts (tracked in blog-image-state.json).
const IMAGE_RULES = [
  [/itp|\btax|impuesto|plusvalia|notary|valuation|per m2|market report/i, [
    ['/blog-img/itp-tax-euros.jpg', 'Taxes and paperwork for Spanish property buyers'],
    ['/blog-img/eu-regulation-flags.jpg', 'EU and Spanish regulation affecting property buyers'],
    ['/blog-img/law-scales-decision.jpg', 'Legal scales representing Spanish property tax rules'],
    ['/blog-img/court-fine-signing.jpg', 'A judge signs documents beside a gavel'],
  ]],
  [/rent-cap|landlord|tenant|renting|rental|\brent\b|alquiler|housing law|ley de vivienda/i, [
    ['/blog-img/rent-law-signing.jpg', 'Signing a Spanish rental agreement'],
    ['/blog-img/rental-contract.jpg', 'A Spanish rental contract'],
    ['/blog-img/rental-keys-handover.jpg', 'Handing over the keys to a Spanish rental'],
    ['/blog-img/holiday-rental-apartments.jpg', 'Holiday rental apartments on the Costa del Sol'],
    ['/blog-img/holiday-apartments-sea.jpg', 'Mediterranean seafront holiday apartments in Spain'],
    ['/blog-img/law-scales-decision.jpg', 'Legal scales representing Spanish housing law'],
    ['/blog-img/court-fine-signing.jpg', 'A judge signs documents beside a gavel'],
  ]],
  [/invest/i, [
    ['/blog-img/property-investment.jpg', 'Property investment in Spain'],
    ['/blog-img/luxury-villa-pool.jpg', 'A luxury villa with a pool on the Costa del Sol'],
    ['/blog-img/sustainable-home-solar.jpg', 'A sustainable Spanish home with solar panels'],
  ]],
  [/nie|bank|non-resident|buying|purchase|process|mortgage/i, [
    ['/blog-img/nie-application-form.jpg', 'A Spanish NIE application form'],
    ['/blog-img/passports-residency.jpg', 'Passports and Spanish residency paperwork'],
    ['/blog-img/rental-contract.jpg', 'Property paperwork in Spain'],
  ]],
  [/marbella/i, [['/area-images/marbella.jpg', 'Marbella, Costa del Sol']]],
  [/estepona/i, [['/area-images/estepona.jpg', 'Estepona, Costa del Sol']]],
  [/fuengirola/i, [['/area-images/fuengirola.jpg', 'Fuengirola, Costa del Sol']]],
  [/malaga/i, [['/area-images/malaga-centre.jpg', 'Malaga city centre']]],
];
const FALLBACK_IMAGES = [
  ['/blog-img/luxury-villa-pool.jpg', 'A luxury villa with a pool on the Costa del Sol'],
  ['/area-images/puerto-banus.jpg', 'Puerto Banus marina, Costa del Sol'],
  ['/area-images/nerja.jpg', 'Nerja, Costa del Sol'],
  ['/blog-img/sustainable-home-solar.jpg', 'A sustainable Spanish home with solar panels'],
  ['/blog-img/andalucia-white-village.jpg', 'A white village in Andalucia'],
];
const IMG_STATE_PATH = '/opt/info-hub/var/admin/blog-image-state.json';
const recentImages = () => { try { return JSON.parse(fs.readFileSync(IMG_STATE_PATH, 'utf8')).recent || []; } catch { return []; } };
const pushRecent = (url) => {
  const recent = [url, ...recentImages().filter((u) => u !== url)].slice(0, 10);
  try { fs.writeFileSync(IMG_STATE_PATH, JSON.stringify({ recent }, null, 2)); } catch {}
};
async function setFeaturedImage(id, url, alt) {
  const token = (process.env.INTERNAL_META_TOKEN || '').trim();
  if (!token || !id) { console.log('featured image: skipped (no token or id)'); return; }
  try {
    const res = await fetch('http://127.0.0.1:3000/api/internal/set-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ id: String(id), featuredImageUrl: url, featuredImageAlt: alt }),
    });
    console.log(`featured image ${id} -> ${url} (${res.status})`);
  } catch (e) { console.log('featured image failed:', e.message); }
}
const hayImg = `${slug} ${post.title}`.toLowerCase();
let candidates = null;
for (const [re, arr] of IMAGE_RULES) { if (re.test(hayImg)) { candidates = arr; break; } }
if (!candidates) candidates = FALLBACK_IMAGES;
const recent = recentImages();
const chosenImg =
  candidates.find((c) => !recent.includes(c[0])) ||
  FALLBACK_IMAGES.find((c) => !recent.includes(c[0])) ||
  candidates[0];
pushRecent(chosenImg[0]);
await setFeaturedImage(en.data?.id, chosenImg[0], chosenImg[1]);
await setFeaturedImage(es.data?.id, chosenImg[0], chosenImg[1]);

console.log(PUBLISH ? '\nDONE - both pages PUBLISHED.' : '\nDONE - both drafts are status=draft; review and publish in the admin.');
