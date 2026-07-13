#!/usr/bin/env node
/**
 * events-cron.mjs - "What's On" events pipeline for info.propertylist.es
 * Multi-town: ALL sources are fetched ONCE per run, then the curate step runs
 * per town in TOWNS (town-specific local/nearby framing) writing one store each:
 *   var/admin/events/{town}.json  { version:1, updated, events:[...] }
 *
 * Sources (all free):
 *   1. visitcostadelsol.com What's-On diary (province-wide, via r.jina.ai reader
 *      because the DO droplet IP is blocked by their WAF; jina renders JS too)
 *   2. marbella.es/agenda + malaga.eu/la-ciudad/agenda/ (town halls, direct fetch)
 *   3. Starlite Occident + Marbella Arena (major commercial venues)
 *   4. community feeds (approved) + submissions queue - AI-screened,
 *      never published without passing the screen
 *   NOTE estepona.es/agenda is a DEAD END: JS-rendered titles with no dates.
 *   Estepona relies on the province diary + community feeds.
 *
 * AI (gpt-5-mini via OpenRouter, same env as generate-blog-post.mjs) extracts,
 * dedupes, classifies scope (local vs nearby-worth-the-drive), fixes
 * categories and writes 1-sentence EN+ES blurbs.
 *
 * Past events are pruned. On total source failure the existing stores are kept.
 * Usage: node scripts/events-cron.mjs [--dry-run] [--town=key]
 */
import fs from 'fs';
import path from 'path';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.EVENTS_MODEL || process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const DRY = process.argv.includes('--dry-run');

const VAR_DIR = '/opt/info-hub/var/admin/events';
const QUEUE_PATH = path.join(VAR_DIR, 'queue.json');

// one store per town; curate runs per town over the same gathered source pool
const TOWNS = [
	{
		key: 'marbella', name: 'Marbella', defaultTown: 'Marbella',
		localNote: 'the Marbella municipality (Marbella town, San Pedro Alcantara, Puerto Banus, Nueva Andalucia, Las Chapas, Elviria, Guadalmina)',
		hoods: 'San Pedro Alcantara, Puerto Banus, Nueva Andalucia, Elviria, Las Chapas',
	},
	{
		key: 'estepona', name: 'Estepona', defaultTown: 'Estepona',
		localNote: 'the Estepona municipality (Estepona town and port, Cancelada, El Paraiso, Selwo area)',
		hoods: 'Estepona old town, Estepona port, Cancelada, El Paraiso',
	},
	{
		key: 'malaga', name: 'Malaga city', defaultTown: 'Malaga',
		localNote: 'the Malaga city municipality (Centro Historico, Soho, La Malagueta, Pedregalejo, El Palo, Teatinos, Huelin)',
		hoods: 'Centro Historico, Soho, La Malagueta, Pedregalejo, El Palo, Teatinos',
	},
];
const townArg = (process.argv.find((a) => a.startsWith('--town=')) || '').slice(7);

if (!AI_KEY) { console.error('Missing OPENAI_API_KEY.'); process.exit(1); }

const log = (...a) => console.log(`[events-cron ${new Date().toISOString()}]`, ...a);

async function aiJson(messages, maxTokens = 12000, temperature = 0.2) {
  const url = `${AI_BASE}/chat/completions`;
  const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
  const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
  const attempts = [
    { ...base, max_tokens: maxTokens, temperature },
    { ...base, max_completion_tokens: maxTokens },
  ];
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) {
      const j = JSON.parse(text);
      return JSON.parse(j.choices?.[0]?.message?.content || '{}');
    }
    lastErr = `${res.status}: ${text.slice(0, 300)}`;
    if (!/max_tokens|max_completion_tokens|temperature|unsupported/i.test(text)) break;
  }
  throw new Error(`AI request failed: ${lastErr}`);
}

async function fetchText(url, { timeoutMs = 60000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

const stripHtml = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, ' [LINK:$1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{3,}/g, '\n')
    .trim();

const slugify = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// events are in Spain - "today" must be Madrid time, not server UTC
const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

const EXTRACT_PROMPT = (sourceName, text) => `You are extracting real-world events from the ${sourceName} events listing below.
Return JSON: {"events":[{"title":"...","start":"YYYY-MM-DD","time":"HH:MM or null (24h start time if stated)","end":"YYYY-MM-DD or null","town":"...","venue":"... or null","category":"...","url":"absolute URL or null"}]}
Rules:
- Only actual events with at least a start date. No nav items, ads, newsletters or venue descriptions.
- Dates: convert to ISO. If a range is given use both start and end. Year is ${new Date().getFullYear()} unless stated.
- town = the municipality (e.g. Marbella, Estepona, Malaga, San Pedro Alcantara). If unknown, null.
- Keep original event titles (Spanish is fine). Extract [LINK:...] urls where they belong to the event.
- No invented data. If unsure about a field, use null.

LISTING:
${text}`;

// r.jina.ai free tier rate-limits aggressively; retry once after a pause
async function fetchJina(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchText(`https://r.jina.ai/${url}`, { timeoutMs: 90000 });
    } catch (e) {
      if (attempt === 2 || !/429/.test(String(e.message))) throw e;
      log(`jina 429 for ${url}, retrying in 90s...`);
      await new Promise((r) => setTimeout(r, 90000));
    }
  }
  return '';
}

async function sourceProvinceDiary() {
  const md = await fetchJina('https://www.visitcostadelsol.com/what-s-on');
  const clipped = md.slice(0, 60000);
  const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT('Costa del Sol tourism board (visitcostadelsol.com)', clipped) }]);
  return (out.events || []).map((e) => ({ ...e, source: 'visitcostadelsol' }));
}

async function sourceStarlite() {
  // Starlite Occident (Cantera de Nagueles, Marbella) - THE Marbella summer
  // festival; commercial, so absent from the town hall and tourism diary.
  const md = await fetchJina('https://www.starliteoccident.com/en/');
  const clipped = md.slice(0, 60000);
  const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT('Starlite Occident festival official site (each named artist/concert with a date is one event; they all take place at Starlite Occident, Cantera de Nagueles, Marbella; category music)', clipped) }]);
  const events = (out.events || []).map((e) => ({
    ...e,
    town: 'Marbella',
    venue: e.venue || 'Starlite Occident, Cantera de Nagueles',
    category: e.category || 'music',
    // per-concert pages live on starlitefestival.com (e.g. /en/eventoconcierto/rick-astley-2/)
    url: e.url && /starlitefestival\.com|starliteoccident\.com/.test(String(e.url)) ? e.url : 'https://www.starliteoccident.com/en/',
    source: 'starlite',
  }));

  // enrich with showtimes from the per-concert pages ("EVENT TIME: 10:00 pm").
  // Direct fetch works for starlitefestival.com; results cached so repeat runs
  // only fetch concerts we have not seen before.
  const TIMES_CACHE = path.join(VAR_DIR, 'starlite-times.json');
  const cache = readJson(TIMES_CACHE, {});
  let fetched = 0;
  for (const e of events) {
    const u = String(e.url || '');
    if (!/eventoconcierto/.test(u)) continue;
    if (Object.prototype.hasOwnProperty.call(cache, u)) { e.time = cache[u]; continue; }
    try {
      const html = await fetchText(u, { timeoutMs: 30000 });
      const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const m = flat.match(/EVENT TIME:\s*(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
      let tm = null;
      if (m) {
        let hh = parseInt(m[1], 10) % 12;
        if (m[3].toLowerCase() === 'p') hh += 12;
        tm = `${String(hh).padStart(2, '0')}:${m[2]}`;
      }
      cache[u] = tm;
      e.time = tm;
      fetched++;
      await new Promise((r) => setTimeout(r, 150));
    } catch { cache[u] = null; }
  }
  try { fs.writeFileSync(TIMES_CACHE, JSON.stringify(cache, null, 2)); } catch {}
  log(`starlite showtimes: ${events.filter((e) => e.time).length}/${events.length} (fetched ${fetched} new pages)`);
  return events;
}

async function sourceMarbellaArena() {
  // Marbella Arena (Puerto Banus) runs WP Events Calendar with a public JSON API
  const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/&#[0-9]+;/g, ' ').trim();
  const all = [];
  for (const base of ['https://marbellaarena.com/en/wp-json/tribe/events/v1/events?per_page=50', 'https://marbellaarena.com/wp-json/tribe/events/v1/events?per_page=50']) {
    try {
      const raw = await fetchText(base, { timeoutMs: 30000 });
      const d = JSON.parse(raw);
      for (const e of d.events || []) {
        const start = String(e.start_date || '').slice(0, 10);
        if (!start) continue;
        const end = String(e.end_date || '').slice(0, 10);
        const tm = String(e.start_date || '').slice(11, 16); // API sends real showtimes
        all.push({
          title: decode(e.title),
          start,
          time: /^\d{2}:\d{2}$/.test(tm) && tm !== '00:00' ? tm : null,
          end: end && end !== start ? end : null,
          town: 'Puerto Banus',
          venue: 'Marbella Arena',
          category: 'music',
          url: e.url || 'https://marbellaarena.com/en/',
          source: 'marbella-arena',
        });
      }
    } catch (err) { log(`marbella-arena fetch failed (${base.includes('/en/') ? 'en' : 'es'}): ${err.message}`); }
  }
  const seen = new Set();
  return all.filter((e) => { const k = slugify(e.title) + e.start; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function sourceMarbellaTownHall() {
  // Joomla pagination: fetch several pages so a fresh area starts FULL,
  // not scarce (the homepage alone only surfaces ~25 events)
  const all = [];
  for (const start of [0, 20, 40]) {
    try {
      const html = await fetchText(`https://www.marbella.es/agenda${start ? `?start=${start}` : ''}`, { timeoutMs: 60000 });
      const text = stripHtml(html).slice(0, 60000);
      const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT(`Marbella town hall agenda (marbella.es, page ${start / 20 + 1})`, text) }]);
      all.push(...(out.events || []));
    } catch (e) { log(`marbella.es page start=${start} failed: ${e.message}`); }
  }
  const events = all.map((e) => ({ ...e, town: e.town || 'Marbella', source: 'marbella.es' }));

  // enrich with start times from the detail pages ("Sabado, 11 de Julio de 2026 22:00 h.")
  // Same cached pattern as Starlite: each page fetched once, ever.
  const TIMES_CACHE = path.join(VAR_DIR, 'marbella-times.json');
  const cache = readJson(TIMES_CACHE, {});
  let fetched = 0;
  for (const e of events) {
    const u = String(e.url || '');
    if (e.time || !/marbella\.es\/agenda\//.test(u)) continue;
    if (Object.prototype.hasOwnProperty.call(cache, u)) { e.time = cache[u]; continue; }
    try {
      const html = await fetchText(u, { timeoutMs: 30000 });
      const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const m = flat.match(/de 20\d{2}\s+(\d{1,2}):(\d{2})\s*h/i);
      const tm = m ? `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}` : null;
      cache[u] = tm;
      e.time = tm;
      fetched++;
      await new Promise((r) => setTimeout(r, 150));
    } catch { cache[u] = null; }
  }
  try { fs.writeFileSync(TIMES_CACHE, JSON.stringify(cache, null, 2)); } catch {}
  log(`marbella.es times: ${events.filter((e) => e.time).length}/${events.length} (fetched ${fetched} new pages)`);
  return events;
}

async function sourceMalagaTownHall() {
  // malaga.eu city agenda: direct fetch works, listing text carries dates and
  // times inline ("12 de julio de 2026 - 20:00 horas"), ?pagina=N paginates
  const all = [];
  for (const pagina of [1, 2, 3]) {
    try {
      const html = await fetchText(`https://www.malaga.eu/la-ciudad/agenda/${pagina > 1 ? `?pagina=${pagina}` : ''}`, { timeoutMs: 60000 });
      const text = stripHtml(html).slice(0, 60000);
      const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT(`Malaga city council agenda (malaga.eu, page ${pagina}; events are in Malaga city unless stated otherwise; detail links look like /la-ciudad/agenda/detalle-actividad/?id=N and belong to https://www.malaga.eu)`, text) }]);
      all.push(...(out.events || []));
    } catch (e) { log(`malaga.eu page ${pagina} failed: ${e.message}`); }
  }
  const events = all.map((e) => ({
    ...e,
    town: e.town || 'Malaga',
    url: e.url && /^https?:\/\//.test(String(e.url)) ? e.url : e.url ? `https://www.malaga.eu${String(e.url).startsWith('/') ? '' : '/'}${e.url}` : null,
    source: 'malaga.eu',
  }));

  // enrich with start times from detalle-actividad pages ("13:30 a 03:00 horas");
  // same cached pattern as marbella.es - each detail page fetched once, ever.
  const TIMES_CACHE = path.join(VAR_DIR, 'malaga-times.json');
  const cache = readJson(TIMES_CACHE, {});
  let fetched = 0;
  for (const e of events) {
    const u = String(e.url || '');
    if (e.time || !/malaga\.eu\/la-ciudad\/agenda\/detalle-actividad/.test(u)) continue;
    if (Object.prototype.hasOwnProperty.call(cache, u)) { e.time = cache[u]; continue; }
    try {
      const html = await fetchText(u, { timeoutMs: 30000 });
      const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const m = flat.match(/(\d{1,2}):(\d{2})(?:\s*(?:a|hasta)\s*\d{1,2}:\d{2})?\s*horas/i);
      const tm = m ? `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}` : null;
      cache[u] = tm;
      e.time = tm;
      fetched++;
      await new Promise((r) => setTimeout(r, 150));
    } catch { cache[u] = null; }
  }
  try { fs.writeFileSync(TIMES_CACHE, JSON.stringify(cache, null, 2)); } catch {}
  log(`malaga.eu times: ${events.filter((e) => e.time).length}/${events.length} (fetched ${fetched} new pages)`);
  return events;
}

async function sourceEsteponaTownHall() {
  // ayuntamiento.estepona.es/agenda: the listing is modal-driven, but every
  // card carries data-remote='...doActionData.asp?show=Event&idE=N' and the
  // detail endpoint (direct fetch OK) has title, venue and "Fecha y Hora"
  // (DD/MM/YYYY, ranges as "Del X al Y"). Details cached; one AI extract call.
  const CACHE = path.join(VAR_DIR, 'estepona-details.json');
  const cache = readJson(CACHE, {});
  const html = await fetchText('https://ayuntamiento.estepona.es/agenda', { timeoutMs: 60000 });
  const ids = [...new Set([...html.matchAll(/idE=(\d+)/g)].map((m) => m[1]))];
  let fetched = 0;
  for (const id of ids) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) continue;
    try {
      const d = await fetchText(`https://ayuntamiento.estepona.es/includes/doActionData.asp?show=Event&idE=${id}`, { timeoutMs: 30000 });
      cache[id] = stripHtml(d).replace(/^[\s\S]*?Cerrar/, '').slice(0, 1200);
      fetched++;
      await new Promise((r) => setTimeout(r, 200));
    } catch { /* not cached - retried next run */ }
  }
  try { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2)); } catch {}
  const texts = ids.filter((id) => cache[id]).map((id) => `EVENT idE=${id}:\n${cache[id]}`).join('\n\n');
  log(`estepona.es: ${ids.length} ids on the agenda (${fetched} new detail pages)`);
  if (!texts) return [];
  const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT('Estepona town hall agenda detail pages (each EVENT block is one event in the Estepona municipality; "Fecha y Hora" holds the date or range - "Del X al Y" is a range; dates are DD/MM/YYYY; include the 24h start time when one is stated)', texts.slice(0, 60000)) }]);
  return (out.events || []).map((e) => ({ ...e, town: e.town || 'Estepona', url: e.url && /^https?:\/\//.test(String(e.url)) ? e.url : 'https://www.estepona.es/agenda', source: 'estepona.es' }));
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// community-registered feeds (feeds.json, status must be "approved" - flipped
// manually after review). iCal feeds are parsed directly (no AI); anything
// else is fetched (jina fallback) and AI-extracted like the other sources.
const FEEDS_PATH = path.join(VAR_DIR, 'feeds.json');
function parseIcs(text, feedName, town) {
  const events = [];
  for (const block of String(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const f = (name) => (body.match(new RegExp(`^${name}[^:]*:(.+)$`, 'm')) || [])[1]?.trim().replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ');
    const dt = f('DTSTART') || '';
    const m = dt.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m || !f('SUMMARY')) continue;
    events.push({
      title: f('SUMMARY'), start: `${m[1]}-${m[2]}-${m[3]}`,
      time: m[4] ? `${m[4]}:${m[5]}` : null, end: null,
      town, venue: f('LOCATION') || null, category: null, url: f('URL') || null,
    });
  }
  return events.slice(0, 20);
}
async function sourceCommunityFeeds() {
  const feeds = readJson(FEEDS_PATH, []).filter((x) => x && x.status === 'approved' && x.url);
  const all = [];
  for (const feed of feeds) {
    try {
      let text = '';
      try { text = await fetchText(feed.url, { timeoutMs: 45000 }); }
      catch { text = await fetchJina(feed.url); }
      const tag = `feed:${slugify(feed.organizer || 'community')}`;
      if (/BEGIN:VCALENDAR/.test(text)) {
        const evs = parseIcs(text, tag, feed.town || 'Marbella');
        all.push(...evs.map((e) => ({ ...e, source: tag })));
        log(`${tag}: ${evs.length} events (ics)`);
      } else {
        const clipped = (text.startsWith('Title:') ? text : stripHtml(text)).slice(0, 40000);
        const out = await aiJson([{ role: 'user', content: EXTRACT_PROMPT(`${feed.organizer} (community-registered feed)`, clipped) }]);
        const evs = (out.events || []).slice(0, 20).map((e) => ({ ...e, town: e.town || feed.town || 'Marbella', source: tag }));
        all.push(...evs);
        log(`${tag}: ${evs.length} events (ai)`);
      }
    } catch (e) { log(`feed ${feed.url} failed: ${e.message}`); }
  }
  return all;
}

async function curateForTown(town, gathered) {
  const curatePrompt = `You curate a "What's On in ${town.name}" page for a Costa del Sol property portal (audience: home buyers, renters, expats, holiday-makers).
Today is ${todayIso}. Below is a raw merged list of events from the whole Malaga province (may contain duplicates and events irrelevant to ${town.name}).
Return JSON: {"events":[{"title":"...","titleEn":"...","titleEs":"...","start":"YYYY-MM-DD","time":"HH:MM or null","end":"YYYY-MM-DD or null","town":"...","venue":"... or null","category":"music|festival|culture|sport|family|food|market|nightlife|other","scope":"local|nearby","url":"... or null","source":"...","blurbEn":"one short sentence in English","blurbEs":"one short sentence in Spanish"}]}
Rules:
- DEDUPE: merge duplicates (same event from several sources); prefer the entry with the most detail; keep one url (prefer the event's own page).
- SOURCE HINTS (trust these): source "marbella.es", "starlite" and "marbella-arena" events are IN the Marbella municipality; "malaga.eu" events are IN Malaga city; "estepona.es" events are IN the Estepona municipality.
- scope "local" = in ${town.localNote}.
- For local events, set town to the most specific neighbourhood you can infer from the venue or text (${town.hoods}); use "${town.defaultTown}" only when nothing more specific is known.
- scope "nearby" = elsewhere in Malaga province but genuinely worth a trip for a ${town.name} resident (major ferias, big concerts/festivals like Starlite Occident, notable cultural events). DROP small village events that are not worth the drive, and DROP nearby events that would not tempt someone based in ${town.name}.
- DROP anything with start AND end before ${todayIso}, anything that is not a real event, and anything that looks like spam or an advert.
- For source "community" entries be strict: drop if the event does not look real/specific (needs plausible title, date, venue or place).
- Blurbs: factual, inviting, one sentence, no em-dashes, no invented details.
- Clean ALL title fields (title, titleEn, titleEs): drop administrative codes and suffixes like "jmd2", "JMD", district codes or reference numbers that leaked from the source.
- time: keep the source's 24h start time when one is given; null otherwise. NEVER invent times.
- titleEn = the title in natural English (translate descriptive words; keep proper nouns like venue or festival names recognizable). titleEs = the title in natural Spanish (usually the original). title = the original as published.
- Keep at most 60 events, local ones first in priority. Named-artist concerts at major venues are high value - keep each as its own event.

RAW EVENTS:
${JSON.stringify(gathered)}`;

  const curated = await aiJson([{ role: 'user', content: curatePrompt }], 30000, 0.3);
  let events = (curated.events || []).filter((e) => e && e.title && e.start);

  // hard prune past events + normalize + ids
  events = events
    .filter((e) => String(e.end || e.start) >= todayIso)
    .map((e) => ({
      id: `${slugify(e.title)}-${String(e.start).replace(/-/g, '')}`,
      title: String(e.title).trim(),
      titleEn: String(e.titleEn || e.title).trim(),
      titleEs: String(e.titleEs || e.title).trim(),
      start: String(e.start),
      time: /^\d{2}:\d{2}$/.test(String(e.time || '')) ? String(e.time) : null,
      end: e.end ? String(e.end) : null,
      town: e.town ? String(e.town).trim() : town.defaultTown,
      venue: e.venue ? String(e.venue).trim() : null,
      category: ['music', 'festival', 'culture', 'sport', 'family', 'food', 'market', 'nightlife'].includes(e.category) ? e.category : 'other',
      scope: e.scope === 'nearby' ? 'nearby' : 'local',
      url: e.url && /^https?:\/\//.test(String(e.url)) ? String(e.url) : null,
      source: String(e.source || 'unknown'),
      blurbEn: String(e.blurbEn || '').replace(/[‒-―−]/g, '-').trim(),
      blurbEs: String(e.blurbEs || '').replace(/[‒-―−]/g, '-').trim(),
    }));

  // dedupe by id (belt and braces after AI dedupe)
  const seen = new Set();
  events = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));

  // hard caps the AI sometimes ignores: all local, at most 15 nearby, 60 total
  const locals = events.filter((e) => e.scope === 'local');
  const nearby = events.filter((e) => e.scope === 'nearby').sort((a, b) => a.start.localeCompare(b.start)).slice(0, 15);
  events = [...locals, ...nearby].slice(0, 60);
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

async function main() {
  fs.mkdirSync(VAR_DIR, { recursive: true });

  // ---- gather ALL sources once; each town curates from the same pool ----
  const gathered = [];
  for (const [name, fn] of [['visitcostadelsol', sourceProvinceDiary], ['marbella.es', sourceMarbellaTownHall], ['estepona.es', sourceEsteponaTownHall], ['malaga.eu', sourceMalagaTownHall], ['starlite', sourceStarlite], ['marbella-arena', sourceMarbellaArena], ['community-feeds', sourceCommunityFeeds]]) {
    try {
      const evs = await fn();
      log(`${name}: ${evs.length} events extracted`);
      gathered.push(...evs);
    } catch (e) { log(`${name} FAILED: ${e.message}`); }
  }

  // ---- community queue (screened below alongside everything else) ----
  const queue = readJson(QUEUE_PATH, []);
  const pending = Array.isArray(queue) ? queue.filter((q) => q && q.status === 'pending') : [];
  log(`community queue: ${pending.length} pending`);
  for (const q of pending) {
    gathered.push({
      title: q.title, start: q.start, end: q.end || null, town: q.town || 'Marbella',
      venue: q.venue || null, category: q.category || null, url: q.link || null,
      source: 'community', _queueId: q.id,
    });
  }

  if (!gathered.length) { log('no events gathered from any source - keeping existing stores, exiting.'); return; }

  // cheap pre-dedupe (exact title+start) so the AI curate input/output stays small
  const seenRaw = new Set();
  const deduped = gathered.filter((e) => {
    const k = `${slugify(e.title || '')}|${e.start || ''}`;
    if (seenRaw.has(k)) return false;
    seenRaw.add(k);
    return true;
  });
  log(`pre-dedupe: ${gathered.length} -> ${deduped.length}`);

  // ---- curate + write per town ----
  const publishedTitles = new Set();
  for (const town of TOWNS) {
    if (townArg && town.key !== townArg) continue;
    const storePath = path.join(VAR_DIR, `${town.key}.json`);
    const prev = readJson(storePath, { version: 1, events: [] });
    let events;
    try {
      events = await curateForTown(town, deduped);
    } catch (e) { log(`${town.key} curate FAILED: ${e.message} - keeping previous store.`); continue; }

    log(`${town.key}: curated ${events.length} events (${events.filter((e) => e.scope === 'local').length} local, ${events.filter((e) => e.scope === 'nearby').length} nearby)`);
    for (const e of events) publishedTitles.add(slugify(e.title));

    if (DRY) { console.log(JSON.stringify(events.slice(0, 8), null, 2)); continue; }

    // sanity: never replace a healthy store with a drastically smaller one
    if (prev.events?.length >= 8 && events.length < 3) {
      log(`${town.key} SAFETY: refusing to shrink store from ${prev.events.length} to ${events.length} - keeping previous.`);
      continue;
    }
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, updated: new Date().toISOString(), events }, null, 2));
    log(`store written: ${storePath}`);
  }

  // mark queue entries as processed (approved if they made any town's cut)
  if (pending.length && !DRY) {
    const updatedQueue = queue.map((q) => {
      if (!q || q.status !== 'pending') return q;
      const ok = publishedTitles.has(slugify(q.title || ''));
      return { ...q, status: ok ? 'approved' : 'rejected', processedAt: new Date().toISOString() };
    });
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(updatedQueue, null, 2));
    log(`queue updated: ${updatedQueue.filter((q) => q.status === 'approved').length} approved total`);
  }
}

main().catch((e) => { console.error('events-cron fatal:', e); process.exit(1); });
