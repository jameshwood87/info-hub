#!/usr/bin/env node
/**
 * regenerate-posts.mjs - rewrite 5 thin templated blog posts with grounded, richer content.
 * Keeps existing EN path/slug/date_created; creates/updates ES twin for parity.
 */
import fs from 'fs';
try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';

async function aiJson(messages, maxTokens = 9000, temperature = 0.7) {
  const url = `${AI_BASE}/chat/completions`;
  const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [{ ...base, max_tokens: maxTokens, temperature }, { ...base, max_completion_tokens: maxTokens }];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
    lastErr = `${res.status}: ${text.slice(0, 300)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI failed: ${lastErr}`);
}
async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { method,
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Directus ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function marketData(areas) {
  const lines = [];
  for (const area of areas) {
    try {
      const res = await fetch('https://mcp.propertylist.es/mcp', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'area_market_summary', arguments: { location: area, search_type: 'for-sale' } } }) });
      const s = (await res.json())?.result?.structuredContent;
      if (!s || !s.total_listings) continue;
      let l = `- ${area}: ${s.total_listings} active for-sale listings; median EUR ${Number(s.median_price).toLocaleString('en-US')}; median EUR ${Number(s.median_price_per_sqm).toLocaleString('en-US')}/m2`;
      const o = s.oracle;
      if (o?.verified && o.verified_price_per_sqm) l += `. NOTARY-VERIFIED EUR ${Number(o.verified_price_per_sqm).toLocaleString('en-US')}/m2 (Spanish notarial register) source: ${o.attestation_url}`;
      lines.push(l);
    } catch {}
  }
  return lines.join('\n');
}
const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');

const JOBS = [
  { id: 1682, areas: ['Marbella', 'Nueva Andalucia', 'Puerto Banus', 'San Pedro Alcantara'],
    topic: 'Buying property in Marbella in 2026: costs, best areas, and the step-by-step process for international buyers' },
  { id: 1683, areas: ['Marbella', 'Estepona', 'Fuengirola', 'Mijas', 'Benahavis', 'Malaga'],
    topic: 'Spanish property market guide 2026: prices, demand trends and where to invest on the Costa del Sol' },
  { id: 1684, areas: ['Malaga', 'El Limonar', 'Marbella'],
    topic: 'Living in El Limonar, Malaga: a 2026 neighbourhood guide to lifestyle, prices and who it suits' },
  { id: 1685, areas: ['Fuengirola', 'Mijas', 'Benalmadena'],
    topic: 'Best barrios in Fuengirola: where to live in 2026, from Los Boliches to Torreblanca' },
  { id: 1686, areas: ['Marbella', 'Malaga'],
    topic: 'ITP transfer tax in Spain 2026: how much resale buyers pay, how it is calculated, and when it is due' },
];

const SYSTEM = 'You are a senior property-market editor for PropertyList, the Spanish property MLS information hub. You write authoritative, genuinely useful, original guides. Voice: calm, expert, data-led, plain-spoken, lightly persuasive. Use plain hyphens only - NEVER em-dashes or en-dashes.';

for (const job of JOBS) {
  const existing = (await directus(`/items/kb_pages/${job.id}?fields=id,path,language,status,date_created`)).data;
  const slug = existing.path.replace(/^\/blog\//, '').replace(/\/$/, '');
  const market = await marketData(job.areas);
  console.log(`\n[${job.id}] ${slug} | market lines: ${market ? market.split('\n').length : 0}`);

  const user = `Write a comprehensive, original blog article in English on: "${job.topic}".
${market ? `\nVERIFIED MARKET DATA (use ONLY these real figures; never invent numbers; when you cite a notary-verified price, link its source with an HTML <a> tag):\n${market}\n` : ''}
Requirements:
- 1,500-2,000 words. Rich, specific and genuinely useful - NOT generic filler. HTML body using <h2> headings (mix questions and statements), short paragraphs, at least one comparison <table>, and a 3-5 question FAQ section near the end.
- Ground every price/number in the verified data above or in well-established facts. For Spanish ITP transfer tax, note that Andalucia applies a flat 7% (post-2021 reform) while other regions vary and use sliding scales; tell readers to confirm the current rate for their region. Never invent region-specific figures you are unsure of.
- Be helpful first. Then, naturally and without hype, show how PropertyList helps: readers can browse live verified listings and see real, notary-verified price-per-m2 data on PropertyList (https://propertylist.es), and agents can join the MLS. Include ONE tasteful closing call-to-action paragraph.
- No invented statistics. No em-dashes or en-dashes (plain hyphens only).
Return a JSON object with keys: title, description (150-200 char excerpt), body (HTML string), seo_title (<=60 chars), seo_description (<=160 chars).`;

  const post = await aiJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], 9000);
  for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) post[k] = noDashes(post[k]);
  const words = String(post.body).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  console.log(`  EN regenerated: "${post.title}" (${words} words)`);

  // PATCH existing EN (keep path/slug/status/date_created)
  await directus(`/items/kb_pages/${job.id}`, { method: 'PATCH', body: {
    title: post.title, description: post.description, body: post.body,
    seo_title: post.seo_title, seo_description: post.seo_description } });
  console.log(`  EN #${job.id} updated`);

  // translate + upsert ES twin at /es/blog/{slug}
  const tr = await aiJson([{ role: 'user', content: `Translate this property blog from English to Spanish. Keep ALL HTML tags, attributes and URLs exactly. Translate only visible text. Use plain hyphens, no em-dashes. Return JSON with keys: title, description, body, seo_title, seo_description.\n\nTITLE:\n${post.title}\n\nDESCRIPTION:\n${post.description}\n\nBODY:\n${post.body}\n\nSEO_TITLE:\n${post.seo_title}\n\nSEO_DESCRIPTION:\n${post.seo_description}` }], 14000, 0.2);
  for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) tr[k] = noDashes(tr[k]);
  const esPath = `/es/blog/${slug}`;
  const found = (await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent(esPath)}&filter[language][_eq]=es&fields=id`)).data;
  const esBody = { status: existing.status, language: 'es', path: esPath, title: tr.title, description: tr.description,
    body: tr.body, seo_title: tr.seo_title, seo_description: tr.seo_description, date_created: existing.date_created };
  if (found && found.length) {
    await directus(`/items/kb_pages/${found[0].id}`, { method: 'PATCH', body: esBody });
    console.log(`  ES #${found[0].id} updated (${esPath})`);
  } else {
    const es = await directus('/items/kb_pages', { method: 'POST', body: esBody });
    console.log(`  ES #${es.data?.id} created (${esPath})`);
  }
}
console.log('\nDONE - 5 posts regenerated (EN updated in place + ES twins).');
