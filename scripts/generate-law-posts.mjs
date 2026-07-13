#!/usr/bin/env node
/**
 * generate-law-posts.mjs - 5 new law/regulation blog posts (EN+ES), grounded in
 * researched, verified facts injected below. Publishes, sets featured image via
 * the internal meta API, and staggers date_created.
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
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const META_TOKEN = (process.env.INTERNAL_META_TOKEN || '').trim();

async function aiJson(messages, maxTokens = 9000, temperature = 0.6) {
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
async function setImage(id, url, alt) {
  if (!META_TOKEN || !id) return;
  const res = await fetch('http://127.0.0.1:3000/api/internal/set-meta', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-token': META_TOKEN },
    body: JSON.stringify({ id: String(id), featuredImageUrl: url, featuredImageAlt: alt }),
  });
  console.log(`  image ${id} -> ${url} (${res.status})`);
}
const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');

const SYSTEM = 'You are a senior property-market editor for PropertyList, the Spanish property MLS information hub. You write authoritative, genuinely useful, original guides. Voice: calm, expert, data-led, plain-spoken. CRITICAL: for every legal or numerical claim use ONLY the VERIFIED FACTS provided - never invent laws, dates, thresholds or figures. Where a threshold changes annually, say "confirm the current figure". Use plain hyphens only - NEVER em-dashes or en-dashes.';

const JOBS = [
  {
    slug: 'eu-short-term-rental-rules-spain-may-2026',
    date: '2026-06-28T09:00:00',
    image: ['/blog-img/eu-regulation-flags.jpg', 'EU institution building - the EU short-term rental regulation applies from May 2026'],
    topic: 'The EU short-term rental regulation is now fully in force (20 May 2026): what every host in Spain and Andalucia must do',
    facts: `- Regulation (EU) 2024/1028 applies in full across the EU from 20 May 2026.
- Spain implemented early: Royal Decree 1312/2024 (December 2024) created the Ventanilla Unica Digital de Arrendamientos; the national registration number (NRU) is processed through the Land Registry and opened on 2 January 2025.
- Displaying the NRU on every advert and platform listing has been mandatory since 1 July 2025. More than 215,000 applications were filed by 30 June 2025; the fee is around EUR 27.
- NEW annual obligation: hosts must file an annual informative declaration with the Land Registry each February reporting the previous year's activity (Article 10.4 of RD 1312/2024 and Order VAU/1560/2025; the first cycle was February 2026).
- Platforms (Airbnb, Booking.com, Vrbo) must share host and activity data with authorities monthly via the single digital entry point; listings without a valid registration number face removal.
- Fines typically range from EUR 10,000 to EUR 60,000 depending on region and severity.
- Andalucia layer: Decreto 31/2024 (in force since 22 February 2024) governs viviendas de uso turistico: RTA registration, occupation/habitability licence, minimum equipment; two modalities (whole home, or by rooms with the owner resident).
- Since March 2025 Andalucian municipalities can suspend new tourist-rental licences for up to 3 years in saturated zones; several have used these powers.
- Since April 2025 communities of owners can approve or veto new tourist flats with a 3/5 majority.
- No Andalucia-wide tourist tax exists as of mid-2026 (Malaga and Sevilla have studied one).
- Useful internal link to include once: <a href="/docs/laws-procedures/renting-a-property/short-term-holiday/national-registration-and-eu-rules/">our NRU and EU rules guide</a>`,
  },
  {
    slug: 'spain-100-percent-tax-non-eu-buyers-what-happened',
    date: '2026-06-29T10:00:00',
    image: ['/blog-img/law-scales-decision.jpg', 'Scales of justice - the fate of Spain\'s proposed 100% tax on non-EU buyers'],
    topic: 'Spain\'s proposed 100% tax on non-EU property buyers: what actually happened (and what buyers really pay in 2026)',
    facts: `- On 13 January 2025 Prime Minister Pedro Sanchez announced a proposal to tax property purchases by non-resident, non-EU buyers at "up to 100%".
- As of July 2026 it is NOT law: the bill was never formally debated in Congress, no version has been voted on, and it was left out of the government's January 2026 housing package. In March 2026 it was widely reported as stalled for lack of parliamentary support.
- Any future revival would require parliamentary approval and would come with an effective date.
- What non-EU buyers actually pay today in Andalucia: 7% ITP on resale property, or 10% IVA plus 1.2% AJD on new builds, plus roughly 1-2% in notary and registry fees.
- Separately, Spain's Golden Visa ended on 3 April 2025 - buying property no longer grants residency. Non-EU visitors can stay 90 days in any 180 under Schengen rules.
- Non-residents remain fully entitled to buy Spanish property; foreign demand on the Costa del Sol stayed strong through 2025-2026.`,
  },
  {
    slug: 'spain-housing-rules-2026-what-applies-in-andalucia',
    date: '2026-06-30T11:00:00',
    image: ['/blog-img/andalucia-white-village.jpg', 'White Andalusian village street - which national housing rules apply in Andalucia'],
    topic: 'Which of Spain\'s 2026 housing rules actually apply in Andalucia? A guide for landlords and buyers',
    facts: `- Spain's Housing Law 12/2023 created "stressed market zones" (zonas de mercado residencial tensionado); its strictest tools only operate inside zones each region must declare.
- Andalucia has declared NO stressed zones. Therefore stressed-zone rent caps, the lowered 5-property "gran tenedor" threshold (it is 10+ properties outside stressed zones) and the 90% tax deduction for cutting rent by 5% do not currently operate in Andalucia.
- What DOES apply in Andalucia: Royal Decree-ley 8/2026 (March 2026) caps annual rent increases at 2% nationally and gives tenants a mandatory two-year extension option; the IRAV reference index (since January 2025) governs annual updates of residential rents instead of CPI; landlords pay estate agency fees on residential lets (Law 12/2023); standard LAU minimum terms of 5 years (7 if the landlord is a company).
- Town halls anywhere in Spain can apply an IBI surcharge of up to 150% on homes left vacant long-term - a municipal decision.
- Tourist rentals in Andalucia are governed by Decreto 31/2024 plus the national NRU registration regime.
- Useful internal link to include once: <a href="/blog/spain-rent-cap-law-rdl-8-2026-landlord-guide/">our RDL 8/2026 rent-cap guide</a>`,
  },
  {
    slug: 'golden-visa-spain-ended-2026-alternatives',
    date: '2026-07-02T12:00:00',
    image: ['/blog-img/passports-residency.jpg', 'Passport and travel documents - residency alternatives after Spain\'s Golden Visa ended'],
    topic: 'Spain\'s Golden Visa is gone: your realistic residency options as a property buyer in 2026',
    facts: `- Spain's Golden Visa (residency by investment, including the EUR 500,000 property route) ended on 3 April 2025 under Organic Law 1/2025. No new applications are accepted.
- Existing Golden Visa holders keep their permits and can renew under transitional rules.
- Buying property in Spain remains fully open to non-residents - ownership was never conditional on a visa. Without residency, non-EU nationals can spend 90 days in any 180-day period (Schengen).
- Main 2026 alternatives: the Non-Lucrative Visa (passive income of roughly EUR 2,400 per month for the main applicant - 400% of IPREM - plus around EUR 600 per month per dependant; working in Spain is not allowed), and the Digital Nomad Visa (remote work for non-Spanish employers or clients; income threshold around 200% of the national minimum wage, roughly EUR 2,700-2,800 per month). Work, student and family routes also exist.
- IPREM and minimum-wage figures update annually - readers should confirm the current thresholds with an immigration professional before applying.`,
  },
  {
    slug: 'tourist-rental-licence-andalucia-2026-guide',
    date: '2026-07-03T13:00:00',
    image: ['/blog-img/rental-keys-handover.jpg', 'Handing over apartment keys - getting a tourist rental licence in Andalucia'],
    topic: 'How to get (and keep) a tourist rental licence in Andalucia in 2026: Decreto 31/2024, the NRU and municipal freezes',
    facts: `- Decreto 31/2024 (in force since 22 February 2024) is the core Andalucian regulation for viviendas de uso turistico (VUT).
- Requirements include: registration in the Registro de Turismo de Andalucia (RTA) before trading, an occupation or habitability licence, climate control (cooling in the summer months and heating in winter), a first-aid kit, official complaint forms, and displaying the registration number on all advertising.
- Two modalities: complete home, or by rooms (with the owner resident).
- National layer on top: the NRU registration number from the Ventanilla Unica (display mandatory since 1 July 2025), an annual informative declaration to the Land Registry every February, and Regulation (EU) 2024/1028 fully applicable since 20 May 2026 (platforms share data monthly; unregistered listings face removal).
- Since March 2025 Andalucian town halls can suspend new VUT licences for up to three years in saturated zones, and several municipalities have restricted new licences - check the local situation before buying to let short-term.
- Since April 2025 communities of owners can authorise or veto new tourist flats by a 3/5 majority.
- Fines for operating without or with incorrect registration typically range from EUR 10,000 to EUR 60,000.
- No Andalucia-wide tourist tax exists as of mid-2026.
- Useful internal link to include once: <a href="/docs/laws-procedures/renting-a-property/short-term-holiday/national-registration-and-eu-rules/">our NRU and EU rules guide</a>`,
  },
];

for (const job of JOBS) {
  console.log(`\n=== ${job.slug} ===`);
  const user = `Write a comprehensive, original blog article in English on: "${job.topic}".

VERIFIED FACTS (the ONLY permitted source for legal/numerical claims; cite dates and law names from here; include the internal link if one is given):
${job.facts}

Requirements:
- 1,300-1,800 words. Practical and specific - NOT generic filler. HTML body using <h2> headings (mix questions and statements), short paragraphs, one comparison or checklist <table> where useful, and a 3-5 question FAQ section near the end.
- Write for property owners, buyers and estate agents on the Costa del Sol.
- Be helpful first; end with ONE tasteful call-to-action paragraph: readers can browse live listings and notary-verified market data on PropertyList (https://propertylist.es), and agents can join the MLS.
- No invented statistics or laws. No em-dashes or en-dashes (plain hyphens only).
Return a JSON object with keys: title, description (150-200 char excerpt), body (HTML string), seo_title (<=60 chars), seo_description (<=160 chars).`;

  const post = await aiJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], 9000);
  for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) post[k] = noDashes(post[k]);
  const words = String(post.body).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  console.log(`  EN: "${post.title}" (${words} words)`);

  const en = await directus('/items/kb_pages', { method: 'POST', body: {
    status: 'published', language: 'en', path: `/blog/${job.slug}`,
    title: post.title, description: post.description, body: post.body,
    seo_title: post.seo_title, seo_description: post.seo_description, date_created: job.date } });
  const enId = en.data?.id;
  console.log(`  EN published: #${enId} /blog/${job.slug}`);

  const tr = await aiJson([{ role: 'user', content: `Translate this property blog from English to Spanish. Keep ALL HTML tags, attributes and URLs exactly. Translate only visible text. Use plain hyphens, no em-dashes. Return JSON with keys: title, description, body, seo_title, seo_description.\n\nTITLE:\n${post.title}\n\nDESCRIPTION:\n${post.description}\n\nBODY:\n${post.body}\n\nSEO_TITLE:\n${post.seo_title}\n\nSEO_DESCRIPTION:\n${post.seo_description}` }], 14000, 0.2);
  for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) tr[k] = noDashes(tr[k]);
  const es = await directus('/items/kb_pages', { method: 'POST', body: {
    status: 'published', language: 'es', path: `/es/blog/${job.slug}`,
    title: tr.title, description: tr.description, body: tr.body,
    seo_title: tr.seo_title, seo_description: tr.seo_description, date_created: job.date } });
  const esId = es.data?.id;
  console.log(`  ES published: #${esId} /es/blog/${job.slug}`);

  await setImage(enId, job.image[0], job.image[1]);
  await setImage(esId, job.image[0], job.image[1]);
}
console.log('\nDONE - 5 law posts published EN+ES with images and staggered dates.');
