/**
 * add-area.mjs - create OR refresh a /neighbourhood + /es/barrios area page
 * with grounded (MCP) EN content + ES translation. Idempotent upsert by path,
 * so it serves both first creation and periodic regeneration.
 *
 * Usage:
 *   node scripts/add-area.mjs --name="Coín" --slug=coin
 *   node scripts/add-area.mjs --name="Marbella" --slug=marbella   (refresh)
 *   [--dry-run]
 */
const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.AREA_MODEL || 'openai/gpt-4o-mini';
const DRY = process.argv.includes('--dry-run');

import fs from 'node:fs';
try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
// re-read after .env load
const D_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const D_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const KEY = (process.env.OPENAI_API_KEY || '').trim();
const BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3).replace(/^["']|["']$/g, '') : '';
};
const NAME = argOf('name');
const SLUG = argOf('slug');
if (!NAME || !SLUG) { console.error('Usage: node scripts/add-area.mjs --name="Area Name" --slug=area-slug [--dry-run]'); process.exit(1); }
if (!KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
if (!DRY && !D_TOKEN) { console.error('Missing DIRECTUS_ADMIN_TOKEN'); process.exit(1); }

const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() : s; };
const eur = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `EUR ${Number(n).toLocaleString('en-US')}` : null);

async function aiJson(messages, maxTokens = 6000, temperature = 0.8) {
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [{ ...base, max_tokens: maxTokens, temperature }, { ...base, max_completion_tokens: maxTokens }];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) { const j = JSON.parse(text); return JSON.parse(j.choices?.[0]?.message?.content || '{}'); }
    lastErr = `${res.status}: ${text.slice(0, 200)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI failed: ${lastErr}`);
}

async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${D_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${D_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Directus ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function mcp(name, args) {
  try {
    const res = await fetch('https://mcp.propertylist.es/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json())?.result?.structuredContent || null;
  } catch { return null; }
}

async function facts(loc) {
  const out = [];
  const sale = await mcp('area_market_summary', { location: loc, search_type: 'for-sale' });
  const rent = await mcp('area_market_summary', { location: loc, search_type: 'for-rent' });
  const holiday = await mcp('area_market_summary', { location: loc, search_type: 'holiday-rentals' });
  let province = '';
  const ac = await mcp('autocomplete_location', { query: loc });
  if (ac?.matches?.[0]?.province) province = ac.matches[0].province;
  if (sale?.total_listings) {
    let l = `For sale: ${sale.total_listings} active listings; median price ${eur(sale.median_price)}; median ${eur(sale.median_price_per_sqm)}/m2; range ${eur(sale.min_price)} to ${eur(sale.max_price)}.`;
    const o = sale.oracle;
    if (o?.verified && o.verified_price_per_sqm) l += ` NOTARY-VERIFIED value ${eur(o.verified_price_per_sqm)}/m2 (Spanish notarial register).`;
    const b = sale.by_bedroom_band || {};
    l += ` Bedroom mix: 1-bed ${b['1_bed'] || 0}, 2-bed ${b['2_bed'] || 0}, 3-bed ${b['3_bed'] || 0}, 4-bed ${b['4_bed'] || 0}, 5+ ${b['5_bed_plus'] || 0}.`;
    out.push(l);
  }
  if (rent?.total_listings) out.push(`Long-term rentals available: ${rent.total_listings} (do NOT state a rent figure).`);
  if (holiday?.total_listings) out.push(`Holiday/short-term properties available: ${holiday.total_listings}.`);
  return { text: out.join('\n'), province, hasSale: !!sale?.total_listings };
}

const SYSTEM = 'You are a sharp, well-travelled local property writer for PropertyList (the Spanish property MLS hub). You write area guides that are genuinely useful AND a pleasure to read: vivid, specific, honest, never generic. You never invent facts or numbers. Plain hyphens only, never em-dashes or en-dashes.';

function userPrompt(area, f) {
  return `Write an area guide for ${area}${f.province ? `, ${f.province}` : ''}.
${f.text ? `\nVERIFIED LIVE MARKET DATA (real - you may reference but must NEVER invent other numbers, and never state a rent price):\n${f.text}\n` : ''}
IMPORTANT: the page already shows the raw stats (listing counts, prices, featured listings) ABOVE your text, so do NOT just restate counts. Your job is the QUALITATIVE, entertaining, TRUE picture of the place.
Write an HTML body (about 700-1000 words) with these <h2> sections in order:
1. <h2>What ${area} is really like</h2> - vibe, character, who lives and holidays there, streets, sea, food, atmosphere, seasonality. Specific and honest (mention trade-offs).
2. <h2>For buyers</h2> - what you actually get, which micro-areas and property types, what to check locally, lifestyle fit. Reference the real median or verified EUR/m2 briefly where natural.
3. <h2>For long-term renters</h2> - what living here is like, who it suits, practical notes. Do NOT state a rent figure.
4. <h2>For holiday-makers</h2> - why come, best times of year, what to do nearby, short-stay appeal.
5. <h2>Getting around and practical</h2> - transport, drive/airport notes if you genuinely know them for this area, amenities, tips.
6. <h2>Frequently asked questions</h2> - 3 short Q&As as <h3>question</h3><p>answer</p>.
Rules: everything TRUE and specific to ${area} (no generic filler); engaging; no invented statistics; plain hyphens only.
Return JSON: { "description": "150-200 char summary", "body": "HTML string", "seo_title": "<=60 chars", "seo_description": "<=160 chars" }.`;
}

async function findByPath(path) {
  const r = await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent(path)}&fields=id&limit=1`);
  return r.data?.[0]?.id || null;
}
async function upsert(path, fields) {
  const id = await findByPath(path);
  if (id) { await directus(`/items/kb_pages/${id}`, { method: 'PATCH', body: fields }); return `updated#${id}`; }
  const r = await directus(`/items/kb_pages`, { method: 'POST', body: { ...fields, path } });
  return `created#${r.data?.id}`;
}

const f = await facts(NAME);
console.log(`Area: ${NAME} (${SLUG}) ${f.hasSale ? `- for-sale data OK, prov=${f.province || '?'}` : '- NO for-sale data'}`);
const gen = await aiJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(NAME, f) }], 6000);
for (const k of ['description', 'body', 'seo_title', 'seo_description']) gen[k] = noDashes(gen[k]);
const words = String(gen.body).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const tr = await aiJson([{ role: 'user', content: `Translate this area-guide content from English to Spanish (European Spanish). Keep ALL HTML tags, attributes and URLs exactly; translate only visible text. Plain hyphens only. Return JSON: { "description": "...", "body": "HTML", "seo_description": "..." }.\n\nDESCRIPTION:\n${gen.description}\n\nBODY:\n${gen.body}\n\nSEO_DESCRIPTION:\n${gen.seo_description}` }], 8000, 0.2);
for (const k of ['description', 'body', 'seo_description']) tr[k] = noDashes(tr[k]);
console.log(`EN ${words} words; ES translated.`);
if (DRY) { console.log('DRY RUN - no writes.'); process.exit(0); }

const en = await upsert(`/neighbourhood/${SLUG}/`, {
  status: 'published', language: 'en',
  title: `${NAME} Neighbourhood Guide`,
  seo_title: clip(gen.seo_title, 60) || `${NAME} neighbourhood guide (Costa del Sol)`,
  description: gen.description, seo_description: clip(gen.seo_description, 160), body: gen.body,
});
const es = await upsert(`/es/barrios/${SLUG}/`, {
  status: 'published', language: 'es',
  title: `Guía del barrio de ${NAME}`,
  seo_title: clip(`Guía del barrio de ${NAME}`, 60),
  description: tr.description, seo_description: clip(tr.seo_description, 160), body: tr.body,
});
console.log(`EN ${en} | ES ${es}`);
