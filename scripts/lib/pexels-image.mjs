// pexels-image.mjs - find an unused, on-topic Pexels photo for a post when the local image library has none left.
//
// Why: blog featured images were reused across different articles until 13-09-26, and the
// local library in public/blog-img runs dry within weeks at two posts a week. This asks
// the Pexels API for photos, skips any photo already used anywhere on the site, and has a
// vision model reject the kinds of image a human caught by eye on 13-09-26 (a US 1040 tax
// form on the ITP guide, a map reading VALENCIA on a Costa del Sol post, the Congress
// building on a Council of Ministers decree, American suburban houses).
//
// The chosen photo is hotlinked from the Pexels CDN (the post templates already build
// responsive srcsets for images.pexels.com) so no deploy is needed per post. Pexels API
// guidelines ask for a credit, so the result carries "Photo by X on Pexels" plus the
// photo page URL, which the templates render under the hero image.
//
// Returns { id, url, alt, credit, creditUrl } or null. Never throws.
import fs from 'node:fs';

const ROOT = '/opt/info-hub';
const envText = (() => { try { return fs.readFileSync(ROOT + '/.env', 'utf8'); } catch { return ''; } })();
const cfg = (k) => String(process.env[k] || envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');

const AI_BASE = (cfg('OPENAI_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
// gpt-5-mini was tested on 13-09-26 against the known bad images: it rejected the 1040
// form and the Congress facade, and passed the law book and the laptop charts.
const VISION_MODEL = cfg('VISION_MODEL') || 'openai/gpt-5-mini';

// Pexels photos downloaded into public/blog-img on 13-09-26. They are served from our
// own host, so their Pexels id never appears in kb-meta and has to be listed here.
const LOCAL_IDS_PATH = new URL('./pexels-local-ids.json', import.meta.url);

// Cheap first filter on the Pexels alt text. The vision check is the real gate.
const BLOCKED_ALT = /\b(dollars?|usd|irs|1040|w-?4|w-?9|american|usa|united states|u\.s\.|british|pounds? sterling|london|new york|dubai|turkish|flags?|parliament|congress|capitol|senate|courthouse|police|protest|election|voting|church|mosque|christmas)\b/i;

// Pexels alt text is written like marketing copy; the brand voice bans these words.
const HYPE = /\b(stunning|beautiful|breathtaking|picturesque|gorgeous|lovely|amazing|vibrant|charming|lively|sparkling|scenic|idyllic|luxurious|perfect)\b/i;

// en dash and em dash, built from char codes so this file stays plain ASCII
const LONG_DASHES = new RegExp('[' + String.fromCharCode(8211, 8212) + ']', 'g');
const noDashes = (s) => String(s || '').replace(LONG_DASHES, '-');
const plainAlt = (s) => {
  const t = noDashes(String(s || '').split(/[;.]\s/)[0]).replace(/[.;]\s*$/, '').trim().slice(0, 140);
  return t && !HYPE.test(t) ? t : '';
};

const norm = (u) => {
  let s = String(u || '');
  const h = s.indexOf('.propertylist.es');
  if (h >= 0) s = s.slice(h + '.propertylist.es'.length);
  return s.split('?')[0];
};

const takenState = () => {
  const items = JSON.parse(fs.readFileSync(ROOT + '/var/admin/kb-meta.json', 'utf8')).items || {};
  const urls = Object.values(items).map((m) => m && m.featuredImageUrl).filter(Boolean);
  const ids = new Set();
  for (const u of urls) { const m = String(u).match(/images\.pexels\.com\/photos\/(\d+)/); if (m) ids.add(m[1]); }
  try { for (const id of JSON.parse(fs.readFileSync(LOCAL_IDS_PATH, 'utf8'))) ids.add(String(id)); } catch {}
  return { urls: new Set(urls.map(norm)), ids };
};

const parseJson = (txt) => {
  const s = String(txt || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
};

const aiChat = async (content, maxTokens = 2000) => {
  const res = await fetch(AI_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg('OPENAI_API_KEY') },
    body: JSON.stringify({ model: VISION_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error('AI http ' + res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
};

const searchQueries = async (title) => {
  const prompt = `Suggest 3 stock-photo search queries for the featured image of this article on a Spanish property website (Costa del Sol, Andalucia):
"${title}"

Each query is 2 to 4 English words describing a concrete visual scene, for example: whitewashed Andalusian street, Mediterranean villa terrace, house keys euro banknotes, calculator euro coins, open air concert crowd, family moving boxes, apartment construction crane.
Never ask for documents, tax forms, flags, maps, signs, government buildings, courts, or a named city outside Spain.
Reply with JSON only: {"queries": ["...", "...", "..."]}`;
  const out = parseJson(await aiChat(prompt, 1500));
  return Array.isArray(out?.queries) ? out.queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3) : [];
};

const RUBRIC = (title) => `You vet stock photos for a Spanish property website (Costa del Sol, Andalucia). The photo will be the featured image of this article:
"${title}"

REJECT the photo if ANY of these is true:
1. It shows a tax form, official document, banknote, coin, flag, sign, map or text that belongs to a country other than Spain (US dollars, IRS forms such as 1040 or W-4, UK pounds, a US flag, English-language official paperwork, Turkish or other non-Spanish law books).
2. Readable text names a place, company or institution that is wrong for the article (for example a map or sign reading a different Spanish city than the article covers).
3. It shows an identifiable government building, parliament, court or official institution (it would imply that institution is involved).
4. The architecture or setting is clearly not Spanish or Mediterranean when the article is about a Spanish place or home (American suburban houses, Dubai-style interiors, northern European towns).
5. It is unrelated to the article's subject, or a visible watermark, logo or brand dominates it.

Look carefully at any paperwork, text and currency in the image before answering.
Reply with JSON only: {"ok": true|false, "reasons": ["..."], "seen": "one sentence describing what is actually in the photo, including any text you can read", "alt": "plain factual alt text for the photo, at most 110 characters, with no adjectives such as stunning, beautiful, picturesque, vibrant or lively"}`;

const visionCheck = async (photo, title) => {
  const img = await fetch(photo.src.original.split('?')[0] + '?auto=compress&cs=tinysrgb&w=1024', { signal: AbortSignal.timeout(60000) });
  if (!img.ok) return { ok: false, reasons: ['image download http ' + img.status] };
  const b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
  const verdict = parseJson(await aiChat([
    { type: 'text', text: RUBRIC(title) },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
  ]));
  if (!verdict || typeof verdict.ok !== 'boolean') return { ok: false, reasons: ['vision check gave no usable verdict'] };
  return verdict;
};

export async function pickPexelsImage({ title, log = console.log, maxChecks = 6 } = {}) {
  try {
    const key = cfg('PEXELS_API_KEY');
    if (!key) { log('pexels: no PEXELS_API_KEY in .env, skipping'); return null; }
    if (!cfg('OPENAI_API_KEY')) { log('pexels: no AI key for the vision check, skipping (never assign an unchecked photo)'); return null; }
    const taken = takenState();
    const queries = await searchQueries(title);
    if (!queries.length) { log('pexels: no search queries came back, skipping'); return null; }
    log('pexels: queries ' + JSON.stringify(queries));

    const seen = new Set();
    let checks = 0;
    for (const q of queries) {
      const res = await fetch('https://api.pexels.com/v1/search?per_page=15&orientation=landscape&query=' + encodeURIComponent(q), {
        headers: { Authorization: key }, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { log('pexels: search http ' + res.status + ' for "' + q + '"'); continue; }
      const photos = (await res.json()).photos || [];
      for (const p of photos) {
        const id = String(p.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const url = p.src.original.split('?')[0] + '?auto=compress&cs=tinysrgb&fit=crop&w=1600&h=1067';
        if (taken.ids.has(id) || taken.urls.has(norm(url))) continue;
        if (p.width < 1600) continue;
        if (BLOCKED_ALT.test(p.alt || '')) { log('pexels: skip ' + id + ' on alt text: ' + String(p.alt).slice(0, 80)); continue; }
        if (checks >= maxChecks) { log('pexels: ' + maxChecks + ' photos checked, none passed - assigning none'); return null; }
        checks++;
        const v = await visionCheck(p, title);
        if (!v.ok) { log('pexels: REJECTED ' + id + ' - ' + (v.reasons || []).join('; ').slice(0, 220)); continue; }
        const alt = plainAlt(v.alt) || plainAlt(v.seen) || plainAlt(p.alt) || noDashes(title).slice(0, 140);
        log('pexels: accepted ' + id + ' by ' + p.photographer + ' - seen: ' + String(v.seen || '').slice(0, 200) + ' | alt: ' + alt);
        return {
          id,
          url,
          alt,
          credit: noDashes('Photo by ' + p.photographer + ' on Pexels'),
          creditUrl: p.url,
        };
      }
    }
    log('pexels: no photo passed after ' + checks + ' check(s) - assigning none');
    return null;
  } catch (e) {
    log('pexels: failed, assigning none: ' + e.message);
    return null;
  }
}
