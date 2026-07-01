/**
 * generate-area-guide.mjs
 * Generate an entertaining, TRUE area guide grounded in live PropertyList MCP
 * market data, and update the area's kb_page BODY (EN + ES). The AreaGuide
 * component already renders the raw stats/listings above the body, so this
 * writes the QUALITATIVE narrative (character, lifestyle, buyer/renter/holiday
 * lenses, practical facts) - never inventing numbers, plain hyphens only.
 *
 * Env: DIRECTUS_URL (default 127.0.0.1:8055), DIRECTUS_ADMIN_TOKEN,
 *      OPENAI_API_KEY (OpenRouter), OPENAI_BASE_URL, AREA_MODEL (default gpt-4o-mini)
 * Usage: node scripts/generate-area-guide.mjs "Marbella" [--dry-run] [--no-es]
 */
const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.AREA_MODEL || 'openai/gpt-4o-mini';
const DRY = process.argv.includes('--dry-run');
const NO_ES = process.argv.includes('--no-es');
const area = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));

if (!area) { console.error('Usage: node scripts/generate-area-guide.mjs "Area Name" [--dry-run] [--no-es]'); process.exit(1); }
if (!AI_KEY) { console.error('Missing OPENAI_API_KEY.'); process.exit(1); }
if (!DRY && !DIRECTUS_TOKEN) { console.error('Missing DIRECTUS_ADMIN_TOKEN.'); process.exit(1); }

const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);

async function aiJson(messages, maxTokens = 6000, temperature = 0.8) {
  const url = `${AI_BASE}/chat/completions`;
  const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [{ ...base, max_tokens: maxTokens, temperature }, { ...base, max_completion_tokens: maxTokens }];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) { const j = JSON.parse(text); return JSON.parse(j.choices?.[0]?.message?.content || '{}'); }
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

async function mcp(name, args) {
  try {
    const res = await fetch('https://mcp.propertylist.es/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json())?.result?.structuredContent || null;
  } catch { return null; }
}

const eur = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `EUR ${Number(n).toLocaleString('en-US')}` : null);

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
    if (o?.verified && o.verified_price_per_sqm) l += ` NOTARY-VERIFIED value ${eur(o.verified_price_per_sqm)}/m2 (Spanish notarial register), source ${o.attestation_url}.`;
    const b = sale.by_bedroom_band || {};
    l += ` Bedroom mix: 1-bed ${b['1_bed'] || 0}, 2-bed ${b['2_bed'] || 0}, 3-bed ${b['3_bed'] || 0}, 4-bed ${b['4_bed'] || 0}, 5+ ${b['5_bed_plus'] || 0}.`;
    out.push(l);
  }
  if (rent?.total_listings) out.push(`Long-term rentals available: ${rent.total_listings} (rental prices vary; do NOT state a rent figure).`);
  if (holiday?.total_listings) out.push(`Holiday/short-term properties available: ${holiday.total_listings}.`);
  return { text: out.join('\n'), province, hasSale: !!sale?.total_listings };
}

// ---- resolve kb_pages ----
async function findPage(lang, prefix) {
  const s = slugify(area);
  const r = await directus(`/items/kb_pages?filter[language][_eq]=${lang}&filter[path][_contains]=${encodeURIComponent(s)}&filter[path][_starts_with]=${encodeURIComponent(prefix)}&limit=1&fields=id,path,title,body,description,seo_description`);
  return r.data?.[0] || null;
}

// ---- main ----
console.log(`Area: ${area}\nModel: ${MODEL} @ ${AI_BASE}`);
const f = await facts(area);
console.log(f.hasSale ? `Market facts (${f.province || 'province?'}):\n${f.text}` : 'No for-sale market data for this area (guide will be lifestyle-only).');

const system = 'You are a sharp, well-travelled local property writer for PropertyList (the Spanish + Portuguese property MLS hub). You write area guides that are genuinely useful AND a pleasure to read: vivid, specific, honest, never generic. You never invent facts or numbers. Plain hyphens only, never em-dashes or en-dashes.';
const user = `Write an area guide for ${area}${f.province ? `, ${f.province}` : ''}.
${f.text ? `\nVERIFIED LIVE MARKET DATA (real - you may reference but must NEVER invent other numbers, and never state a rent price):\n${f.text}\n` : ''}
IMPORTANT: the page already shows the raw stats (listing counts, prices, featured listings) ABOVE your text, so do NOT just restate counts. Your job is the QUALITATIVE, entertaining, TRUE picture of the place.
Write an HTML body (about 700-1000 words) with these <h2> sections in order:
1. <h2>What ${area} is really like</h2> - the vibe, character, who lives and holidays there, the streets, sea, food, atmosphere, seasonality. Specific and honest (mention trade-offs, not just praise).
2. <h2>For buyers</h2> - what you actually get, which micro-areas and property types, what to check locally, lifestyle fit. Reference the real median or verified EUR/m2 briefly where natural.
3. <h2>For long-term renters</h2> - what living here is like, who it suits, practical notes. Do NOT state a rent figure.
4. <h2>For holiday-makers</h2> - why come, best times of year, what to do nearby, short-stay appeal.
5. <h2>Getting around and practical</h2> - transport, drive/airport notes if you genuinely know them for this area, amenities, tips.
6. <h2>Frequently asked questions</h2> - 3 short Q&As as <h3>question</h3><p>answer</p>.
Rules: everything TRUE and specific to ${area} (no generic filler that could apply anywhere); engaging to read; no invented statistics; plain hyphens only (no em/en dashes).
Return a JSON object: { "description": "150-200 char summary", "body": "HTML string", "seo_title": "<=60 chars", "seo_description": "<=160 chars" }.`;

const gen = await aiJson([{ role: 'system', content: system }, { role: 'user', content: user }], 6000);
for (const k of ['description', 'body', 'seo_title', 'seo_description']) gen[k] = noDashes(gen[k]);
const words = String(gen.body).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
console.log(`Generated EN body: ${words} words.`);

if (DRY) { console.log('\n--- DRY RUN (no writes) ---\n' + String(gen.body).slice(0, 1200)); process.exit(0); }

const enPage = await findPage('en', '/neighbourhood');
if (!enPage) { console.error(`No EN neighbourhood kb_page found for "${area}".`); process.exit(1); }
// backup
const fs = await import('node:fs');
fs.writeFileSync(`/tmp/area-backup-en-${slugify(area)}.html`, String(enPage.body || ''), 'utf8');
await directus(`/items/kb_pages/${enPage.id}`, { method: 'PATCH', body: { body: gen.body, description: gen.description, seo_description: gen.seo_description } });
console.log(`EN updated: id=${enPage.id} path=${enPage.path} (old body backed up to /tmp/area-backup-en-${slugify(area)}.html)`);

if (!NO_ES) {
  const esPage = await findPage('es', '/es/barrios');
  if (esPage) {
    const tr = await aiJson([{ role: 'user', content: `Translate this area-guide content from English to Spanish for European Spanish readers. Keep ALL HTML tags, attributes and URLs exactly; translate only visible text. Plain hyphens only, no em-dashes. Return JSON: { "description": "...", "body": "HTML", "seo_description": "..." }.\n\nDESCRIPTION:\n${gen.description}\n\nBODY:\n${gen.body}\n\nSEO_DESCRIPTION:\n${gen.seo_description}` }], 8000, 0.2);
    for (const k of ['description', 'body', 'seo_description']) tr[k] = noDashes(tr[k]);
    fs.writeFileSync(`/tmp/area-backup-es-${slugify(area)}.html`, String(esPage.body || ''), 'utf8');
    await directus(`/items/kb_pages/${esPage.id}`, { method: 'PATCH', body: { body: tr.body, description: tr.description, seo_description: tr.seo_description } });
    console.log(`ES updated: id=${esPage.id} path=${esPage.path}`);
  } else {
    console.log('No ES barrios kb_page found - skipped ES.');
  }
}
console.log('\nDONE.');
