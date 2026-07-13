#!/usr/bin/env node
/**
 * rewrite-mls-post.mjs - replace the thin 2024 "best MLS/CRM/portal in Spain" post
 * (EN kb 51) with a hand-written, feature-accurate version; AI-translate to ES (kb 52).
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

async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Directus ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function aiJson(messages, maxTokens = 14000, temperature = 0.2) {
  const res = await fetch(`${AI_BASE}/chat/completions`, { method: 'POST',
    headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
}

const TITLE = 'What is the best MLS, CRM and property portal in Spain? (2026 guide)';
const DESCRIPTION = 'MLS, CRM or portal - which does your agency actually need in 2026? An honest comparison of the options in Spain and why a free all-in-one is winning on the Costa del Sol.';
const SEO_TITLE = 'Best MLS, CRM & Property Portal in Spain (2026 Guide)';
const SEO_DESC = 'Compare Spain\'s MLS platforms, CRMs and property portals in 2026 - costs, coverage and features - and see why agents are switching to a free all-in-one.';

const BODY = `
<h2>Three tools, one job: winning and closing property deals</h2>
<p>Ask ten Spanish estate agents what software they use and you will hear ten different stacks: one tool to share inventory with other agencies, another to manage clients, and a third (or fourth) to advertise to the public. Each has a different login, a different monthly bill, and none of them talk to each other. In 2026 that fragmentation is the single biggest drag on a small agency's productivity.</p>
<p>So the real question is not "which MLS?", "which CRM?" or "which portal?" in isolation. It is: what combination gives you shared inventory, client management and public exposure with the least cost and double-typing?</p>

<h2>What each tool actually does</h2>
<p><strong>An MLS</strong> (multiple listing service) is a shared database between professional agencies: you list a property once, every member can bring their buyer, and commissions are shared on collaboration deals. On the Costa del Sol, where most sales involve two agencies, the MLS is the engine of the market.</p>
<p><strong>A CRM</strong> manages your contacts, viewings, tasks and deal pipeline. Standalone property CRMs typically charge per user per month.</p>
<p><strong>A portal</strong> advertises to the public. The national giants sell visibility: you pay to list, and you pay more to stand out. They bring consumer leads but do nothing for agent-to-agent collaboration.</p>

<h2>The options in Spain, honestly compared</h2>
<table>
<thead><tr><th>Option</th><th>What you get</th><th>Cost model</th><th>What is missing</th></tr></thead>
<tbody>
<tr><td>National advertising portals (Idealista, Fotocasa...)</td><td>Large consumer audiences, lead flow</td><td>Pay per listing plus paid boosts; costs scale with inventory</td><td>No shared MLS, no CRM, no collaboration between agencies</td></tr>
<tr><td>Subscription MLS platforms (the Costa del Sol incumbents)</td><td>Shared professional inventory, some CRM features</td><td>Monthly subscription per agency, often hundreds of euros a year</td><td>Public exposure usually limited or costs extra; contracts and lock-in</td></tr>
<tr><td>Standalone CRMs</td><td>Contact and pipeline management</td><td>Per user per month</td><td>No inventory sharing, no public exposure - you still need the other two</td></tr>
<tr><td><strong>PropertyList (MLS + CRM + portal)</strong></td><td>Shared MLS, full CRM with pipelines, and free syndication to the public portal</td><td><strong>Free for agents</strong>; optional credits for extras like featuring</td><td>Consumer brand reach still growing (portal launched Feb 2026) - most agents run it alongside portal advertising</td></tr>
</tbody>
</table>

<h2>Why an all-in-one changes the economics</h2>
<p>PropertyList was built to collapse the stack into one system, free at the point of use:</p>
<ul>
<li><strong>The MLS:</strong> more than 6,000 active listings shared between verified agencies across Spain, with commission-sharing collaboration built in. Listing data is protected by member terms - no scraping, no bulk export.</li>
<li><strong>The CRM:</strong> contacts, notes, documents, viewings, calendar, tasks and a visual sales pipeline - included, not an upsell.</li>
<li><strong>The portal:</strong> every MLS listing can appear on the public portal at propertylist.es (launched February 2026), including a dedicated New Developments section, at no cost. Featuring a listing for extra visibility uses credits (from 10 credits for 3 days).</li>
<li><strong>Verified market data:</strong> agents can generate a CMA market report for a valuation appointment in minutes, backed by Market Intelligence and the Price Oracle's notary-verified prices - figures you can defend in front of a seller, not portal asking-price averages.</li>
<li><strong>Marketing tools:</strong> agent microsites, a website builder, one-click listing sharing, WhatsApp community groups and property-alert automation that emails you when a matching listing hits the market.</li>
<li><strong>No migration pain:</strong> XML import brings your existing listings in from any CRM, and XML export keeps feeding the portals you already advertise on.</li>
</ul>

<h2>When you still need the big portals</h2>
<p>If your strategy depends on mass consumer advertising, the national portals remain the biggest audiences in Spain and it makes sense to keep them - as paid advertising channels. The point of an all-in-one MLS is that the professional side of your business (inventory, collaboration, clients, valuations) stops costing money and stops living in three disconnected tools. Many PropertyList agencies run both: the MLS as the operating system, the portals as an advertising expense they can now measure properly.</p>

<h2>Frequently asked questions</h2>
<h3>Is PropertyList really free?</h3>
<p>Yes - joining, listing on the MLS, the CRM and syndication to the public portal are free for verified agencies. Optional extras (featuring listings, CMA market reports, private listings) use a credit system, so you only pay for the boosts you choose.</p>
<h3>Do I still need a separate CRM?</h3>
<p>For most independent agencies, no. Contacts, pipelines, documents, calendar and lead tracking are built in. If you love your current CRM, XML import/export means you are not locked in either direction.</p>
<h3>Can I keep advertising on Idealista or Fotocasa?</h3>
<p>Yes. PropertyList exports your listings via XML feed, so your existing portal advertising keeps working unchanged.</p>
<h3>How do commissions work on MLS deals?</h3>
<p>Collaboration terms are agreed between the two agencies on each deal, as is standard on the Costa del Sol. The MLS gives you the shared inventory and the rules of engagement; the deal remains yours.</p>

<p>The fastest way to judge an MLS is to look at the live inventory. Browse the shared listings and notary-verified market data at <a href="https://propertylist.es" target="_blank" rel="noopener">propertylist.es</a>, or <a href="https://agents.propertylist.es/new-agent-signup/new" target="_blank" rel="noopener">create your free agency account</a> and see your pipeline, listings and market reports in one place - for free, in an afternoon.</p>
`.trim();

// ---- EN update ----
await directus('/items/kb_pages/51', { method: 'PATCH', body: {
  title: TITLE, description: DESCRIPTION, body: BODY, seo_title: SEO_TITLE, seo_description: SEO_DESC } });
const words = BODY.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
console.log(`EN #51 updated (${words} words)`);

// ---- ES translation ----
const tr = await aiJson([{ role: 'user', content: `Translate this property-industry blog post from English to Spanish (neutral peninsular Spanish, professional tone). Keep ALL HTML tags, attributes and URLs exactly. Translate only visible text. Use plain hyphens, no em-dashes. Return JSON with keys: title, description, body, seo_title (<=60 chars), seo_description (<=160 chars).\n\nTITLE:\n${TITLE}\n\nDESCRIPTION:\n${DESCRIPTION}\n\nBODY:\n${BODY}\n\nSEO_TITLE:\n${SEO_TITLE}\n\nSEO_DESCRIPTION:\n${SEO_DESC}` }]);
const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ');
for (const k of ['title', 'description', 'body', 'seo_title', 'seo_description']) tr[k] = noDashes(tr[k]);
await directus('/items/kb_pages/52', { method: 'PATCH', body: {
  title: tr.title, description: tr.description, body: tr.body, seo_title: tr.seo_title, seo_description: tr.seo_description } });
console.log('ES #52 updated:', tr.title);
