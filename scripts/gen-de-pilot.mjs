#!/usr/bin/env node
/**
 * gen-de-pilot.mjs - German-language pilot content for info.propertylist.es.
 * Translates 2 guides (buying, scam) + generates 5 area guides grounded in MCP data.
 * Writes src/data/de-pilot.json (consumed by src/pages/de/[...path].astro).
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
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const ORIGIN = 'https://info.propertylist.es';

async function aiJson(messages, maxTokens = 14000) {
  const res = await fetch(`${AI_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens }) });
  const t = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}: ${t.slice(0, 200)}`);
  return JSON.parse(JSON.parse(t).choices?.[0]?.message?.content || '{}');
}
async function directusBody(path) {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_eq]=${encodeURIComponent(path)}&fields=title,body,seo_description&limit=1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return (await r.json()).data?.[0] || null;
}
async function mcp(area) {
  try {
    const r = await fetch('https://mcp.propertylist.es/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'area_market_summary', arguments: { location: area, search_type: 'for-sale' } } }) });
    return (await r.json())?.result?.structuredContent || null;
  } catch { return null; }
}
const noDash = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ');

const out = {};

// ---- 2 translated guides ----
const GUIDES = [
  { de: '/de/immobilie-in-spanien-kaufen/', enPath: '/blog/buying-property-spain-non-resident-process-costs-timeline/', en: '/blog/buying-property-spain-non-resident-process-costs-timeline/', es: '/es/blog/buying-property-spain-non-resident-process-costs-timeline/' },
  { de: '/de/immobilienbetrug-in-spanien-vermeiden/', enPath: '/blog/how-to-avoid-property-scams-in-spain/', en: '/blog/how-to-avoid-property-scams-in-spain/', es: '/es/blog/como-evitar-estafas-inmobiliarias-en-espana/' },
];
for (const g of GUIDES) {
  const src = await directusBody(g.enPath);
  if (!src) { console.log('missing source', g.enPath); continue; }
  const tr = await aiJson([{ role: 'user', content: `Translate this Spanish-property guide from English into natural, professional GERMAN for international buyers on the Costa del Sol. Keep ALL HTML tags and URLs exactly; translate only visible text. Keep Spanish legal terms (e.g. nota simple, NIE, ITP) with a short German gloss the first time. Plain hyphens only, no em-dashes. Return JSON: {"title":"...","description":"max 160 chars","body":"the full translated HTML"}.\n\nTITLE:\n${src.title}\n\nBODY:\n${src.body}` }]);
  out[g.de] = { lang: 'de', title: noDash(tr.title), description: noDash(tr.description), body: noDash(tr.body), hreflang: { en: g.en, es: g.es } };
  console.log('guide DE:', g.de, `(${String(tr.body).replace(/<[^>]+>/g,' ').split(/\s+/).length} words)`);
}

// ---- 5 area guides grounded in MCP ----
const AREAS = [
  { slug: 'elviria', name: 'Elviria', enSlug: 'elviria' },
  { slug: 'golden-mile', name: 'Marbella Golden Mile', enSlug: 'golden-mile' },
  { slug: 'la-cala-de-mijas', name: 'La Cala de Mijas', enSlug: 'la-cala-de-mijas' },
  { slug: 'los-monteros', name: 'Los Monteros', enSlug: 'los-monteros' },
  { slug: 'puerto-banus', name: 'Puerto Banus', enSlug: 'puerto-banus' },
];
for (const a of AREAS) {
  const s = await mcp(a.name);
  const facts = s && s.total_listings ? `VERIFIED MARKET DATA (use ONLY these, never invent): ${s.total_listings} active for-sale listings; median price EUR ${Number(s.median_price).toLocaleString('de-DE')}; median EUR ${Number(s.median_price_per_sqm).toLocaleString('de-DE')}/m2${s.oracle?.verified ? '; notary-verified EUR ' + Number(s.oracle.verified_price_per_sqm).toLocaleString('de-DE') + '/m2 (spanisches Notarregister)' : ''}.` : 'No live market figures available; write qualitatively and do not invent numbers.';
  const res = await aiJson([{ role: 'user', content: `Write an original, genuinely useful area guide in natural, professional GERMAN about ${a.name} on the Costa del Sol, Spain, for German-speaking property buyers.
${facts}
Requirements: 500-800 words, HTML body with <h2> headings and short <p> paragraphs. Cover what the area is like, who it suits, lifestyle, and a market snapshot using ONLY the verified figures above (label them clearly as of July 2026). Be accurate and specific; no invented statistics. End with ONE call-to-action inviting readers to browse live ${a.name} listings and verified market data on PropertyList. Plain hyphens only, no em-dashes. Return JSON: {"title":"...","description":"max 160 chars","body":"HTML starting with <h1>"}.` }], 9000);
  const dePath = `/de/gebiete/${a.slug}/`;
  out[dePath] = {
    lang: 'de', title: noDash(res.title), description: noDash(res.description), body: noDash(res.body),
    hreflang: { en: `/neighbourhood/spain/malaga/${a.enSlug}/`, es: `/es/barrios/${a.enSlug}/` },
    portal: `https://www.propertylist.es/for-sale/${a.enSlug}`,
  };
  console.log('area DE:', dePath, s?.total_listings ? `(${s.total_listings} listings)` : '(no MCP data)');
}

fs.writeFileSync('/opt/info-hub/src/data/de-pilot.json', JSON.stringify(out, null, 2));
console.log('\nwrote src/data/de-pilot.json with', Object.keys(out).length, 'German pages');
