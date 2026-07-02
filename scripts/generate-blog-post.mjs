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
async function aiJson(messages, maxTokens = 8000, temperature = 0.7) {
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
      const content = j.choices?.[0]?.message?.content || '';
      return JSON.parse(content);
    }
    lastErr = `${res.status}: ${text.slice(0, 300)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI request failed: ${lastErr}`);
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
const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');

// ---- main ----
const topic = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || TOPICS[Math.floor(Math.random() * TOPICS.length)];
console.log(`Topic: ${topic}\nModel: ${MODEL} @ ${AI_BASE}`);

const market = await marketData();
console.log(market ? `Market data: ${market.split('\n').length} areas (incl. Oracle-verified)` : 'Market data: unavailable (continuing without)');

const system = 'You are a senior property-market editor for PropertyList, the Spanish property MLS information hub. You write authoritative, genuinely useful, original guides for buyers, sellers and agents. Voice: calm, expert, data-led, plain-spoken. Use plain hyphens only - NEVER em-dashes or en-dashes.';
const user = `Write a comprehensive, original blog article in English on: "${topic}".
${market ? `\nVERIFIED MARKET DATA (use ONLY these real figures; never invent numbers; when you cite a notary-verified price, link its source as an HTML <a> tag):\n${market}\n` : ''}
Requirements:
- 1,500-2,000 words. HTML body using <h2> headings (mix questions and statements), short paragraphs, a comparison <table> where useful, and a short FAQ section (3-5 Q&As) near the end.
- Information-first and accurate; practical for a real buyer/seller. Cite the verified figures above where relevant.
- No invented statistics. No em-dashes or en-dashes (plain hyphens only).
Return a JSON object with keys: title, slug, description (a 150-200 character excerpt), body (HTML string), seo_title (<=60 chars), seo_description (<=160 chars).`;

const post = await aiJson([{ role: 'system', content: system }, { role: 'user', content: user }], 9000);
for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) post[k] = noDashes(post[k]);
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
const tr = await aiJson([{ role: 'user', content: `Translate this property blog content from English to Spanish. Keep ALL HTML tags, attributes and URLs exactly. Translate only visible text. Use plain hyphens, no em-dashes. Return JSON with keys: title, description, body, seo_title, seo_description.\n\nTITLE:\n${post.title}\n\nDESCRIPTION:\n${post.description}\n\nBODY:\n${post.body}\n\nSEO_TITLE:\n${post.seo_title}\n\nSEO_DESCRIPTION:\n${post.seo_description}` }], 14000, 0.2);
for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) tr[k] = noDashes(tr[k]);
const es = await directus('/items/kb_pages', { method: 'POST', body: {
  status: PUBLISH ? 'published' : 'draft', language: 'es', path: `/es/blog/${slug}`,
  title: tr.title, description: tr.description, body: tr.body,
  seo_title: tr.seo_title, seo_description: tr.seo_description,
} });
console.log(`ES draft created: id=${es.data?.id} path=/es/blog/${slug}`);
console.log(PUBLISH ? '\nDONE - both pages PUBLISHED.' : '\nDONE - both drafts are status=draft; review and publish in the admin.');
