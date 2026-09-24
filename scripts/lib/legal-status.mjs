// legal-status.mjs - the live status of every Spanish law a post cites, read from the BOE
// open-data API (www.boe.es/datosabiertos). This is the law-check procedure automated:
//   - whole-law repeal, annulment and expiry come from /metadatos
//     (RDL 8/2026: estatus_derogacion S, fecha_derogacion 20260430, vigencia_agotada S);
//   - partial annulments and repeals only appear in the later-references list of
//     /analisis (RD 1312/2024 still reads "not annulled" at law level, while the Supreme
//     Court annulled articles 2.f, 5, 8, 9, 10, 12.b and others in May and June 2026).
// Laws named without a BOE link are resolved by official number and type; when several
// laws share a number (Ley 8/2026 is three different laws) all of them are listed.
//
//   const r = await legalStatus(html);  // [{ ref, id, title, url, status, statusText, partial, mentionsDead, attention, review }]

const API = 'https://www.boe.es/datosabiertos/api/legislacion-consolidada';

const TITLE_RANK = {
  RDL: /^Real Decreto-ley\b/i,
  RD: /^Real Decreto\b(?!-ley)/i,
  LO: /^Ley Orgánica\b/i,
  L: /^Ley\b(?! Orgánica)/i,
  DL: /^Decreto-ley\b/i,
  D: /^Decreto\b(?!-ley)/i,
};
const LABEL = { RDL: 'Real Decreto-ley', RD: 'Real Decreto', LO: 'Ley Orgánica', L: 'Ley', DL: 'Decreto-ley', D: 'Decreto' };

// Longer forms first; every match blanks its span so "Real Decreto-ley 8/2026" is not
// counted again as "Decreto-ley 8/2026".
const MENTIONS = [
  ['RDL', /\b(?:Real Decreto[- ]ley|Royal Decree[- ]law|RD[- ]ley|RDL)\s*(\d{1,3}\/\d{4})\b/gi],
  ['LO', /\b(?:Ley Org[aá]nica|Organic Law|LO)\s*(\d{1,2}\/\d{4})\b/g],
  ['RD', /\b(?:Real Decreto|Royal Decree|RD)\s*(\d{1,4}\/\d{4})\b/g],
  ['DL', /\b(?:Decreto[- ]ley|Decree[- ]law)\s*(\d{1,3}\/\d{4})\b/gi],
  ['D', /\b(?:Decreto|Decree)\s*(\d{1,4}\/\d{4})\b/gi],
  ['L', /\b(?:Ley|Law)\s*(\d{1,3}\/\d{4})\b/g],
];
const ELI_RANK = { l: 'L', lo: 'LO', rdl: 'RDL', rd: 'RD', dl: 'DL', d: 'D' };

const strip = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const ddmmyy = (s) => (/^\d{8}$/.test(String(s || '')) ? `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(2, 4)}` : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the BOE API is sometimes slow: 30 s per call and one retry before giving up
async function getJson(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'info-hub-legal-check' }, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      // a law that is not in the consolidated database comes back as an XML "404" body
      if (res.status === 404 || /<code>\s*404\s*<\/code>/.test(text)) return null;
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
    } catch {}
    if (i < tries - 1) await sleep(1500);
  }
  throw new Error('BOE API did not answer');
}

// what the post cites: explicit BOE identifiers, ELI links, and laws named by type and number
export function extractNorms(html) {
  const out = new Map(); // key -> { key, ref, rank, number, id }
  const raw = String(html || '');
  for (const m of raw.matchAll(/\bBOE-A-(\d{4})-(\d{1,6})\b/g)) {
    const id = m[0];
    if (!out.has(id)) out.set(id, { key: id, ref: id, id });
  }
  for (const m of raw.matchAll(/boe\.es\/eli\/es(?:-[a-z]{2})?\/(l|lo|rdl|rd|dl|d)\/(\d{4})\/\d{2}\/\d{2}\/(\d+)/gi)) {
    const rank = ELI_RANK[m[1].toLowerCase()];
    const number = `${m[3]}/${m[2]}`;
    const key = `${rank} ${number}`;
    if (!out.has(key)) out.set(key, { key, ref: `${LABEL[rank]} ${number}`, rank, number });
  }
  let text = strip(raw);
  for (const [rank, re] of MENTIONS) {
    text = text.replace(re, (all, number) => {
      const key = `${rank} ${number}`;
      if (!out.has(key)) out.set(key, { key, ref: `${LABEL[rank]} ${number}`, rank, number });
      return ' '.repeat(all.length);
    });
  }
  return [...out.values()];
}

async function resolveByNumber(rank, number) {
  const query = JSON.stringify({ query: { query_string: { query: `numero_oficial:"${number}"` } } });
  const j = await getJson(`${API}?query=${encodeURIComponent(query)}&limit=30`);
  const rows = Array.isArray(j?.data) ? j.data : [];
  return rows
    .filter((r) => TITLE_RANK[rank] && TITLE_RANK[rank].test(String(r.titulo || '')))
    .map((r) => ({ id: String(r.identificador), title: String(r.titulo || ''), state: /estatal/i.test(String(r?.ambito?.texto || '')), dept: String(r?.departamento?.texto || '') }));
}

// Laws share numbers across regions ("Ley 5/2025" is seven laws, one of them Andalusia's
// housing law). Pick by the region named near the citation, else the single state law,
// else keep every match (and flag only if all of them are dead).
const REGIONS = [
  [/andaluc|andalus/i, /andaluc/i], [/catalu|catalonia/i, /catalu/i], [/comunidad de madrid|madrid region/i, /madrid/i],
  [/valencia/i, /valencia/i], [/balear|mallorca|ibiza|menorca/i, /balear/i], [/canari/i, /canari/i], [/galicia/i, /galicia/i],
  [/pa[ií]s vasco|basque|euskadi/i, /pa[ií]s vasco|euskadi/i], [/murcia/i, /murcia/i], [/cantabri/i, /cantabri/i],
  [/arag[oó]n/i, /arag[oó]n/i], [/navarr/i, /navarr/i], [/extremadura/i, /extremadura/i], [/asturias/i, /asturias/i],
];
function pickMatches(rows, context) {
  const hint = REGIONS.find(([near]) => near.test(context));
  if (hint) {
    const r = rows.filter((x) => hint[1].test(`${x.title} ${x.dept}`));
    if (r.length) return r;
  }
  const state = rows.filter((x) => x.state);
  if (state.length === 1) return state;
  return rows;
}

async function statusOf(id) {
  const meta = await getJson(`${API}/id/${id}/metadatos`);
  const d = meta?.data?.[0];
  if (!d) return { id, url: `https://www.boe.es/buscar/doc.php?id=${id}`, status: 'not_found', statusText: 'not in the BOE consolidated-law database yet, status not checked', partial: [] };
  const title = String(d.titulo || '');
  let status = 'in_force';
  let statusText = 'in force';
  if (d.estatus_anulacion === 'S') { status = 'annulled'; statusText = 'annulled'; }
  else if (d.estatus_derogacion === 'S') { status = 'repealed'; statusText = `repealed${ddmmyy(d.fecha_derogacion) ? ' on ' + ddmmyy(d.fecha_derogacion) : ''}`; }
  else if (d.vigencia_agotada === 'S') { status = 'expired'; statusText = 'no longer in force'; }
  let partial = [];
  if (status === 'in_force') {
    await sleep(250);
    const an = await getJson(`${API}/id/${id}/analisis`);
    // the API returns a list, a single object or an empty string depending on the law
    const toArr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : []);
    const later = toArr(an?.data?.[0]?.referencias?.posteriores).flatMap((p) => toArr(p?.posterior));
    // only changes from the last three years: every old law has decades of routine partial
    // repeals (the LAU lost arts. 38 to 40 in 2000), which are history, not news
    const minYear = new Date().getUTCFullYear() - 2;
    const yearOf = (p) => {
      const m = String(p?.id_norma || '').match(/-(\d{4})-/);
      if (m) return Number(m[1]);
      const ys = String(p?.texto || '').match(/\b(19|20)\d{2}\b/g);
      return ys ? Number(ys[ys.length - 1]) : 0;
    };
    partial = later
      .filter((p) => yearOf(p) >= minYear)
      .map((p) => `${String(p?.relacion?.texto || '').trim()} ${String(p?.texto || '').trim()}`.replace(/\s+/g, ' ').trim())
      .filter((s) => /\b(DEROGA|ANULA|DECLARA|DEJA SIN EFECTO)\b/i.test(s) && /nulidad|derog|anula|sin efecto|inconstitucional/i.test(s))
      .filter((s, i, a) => a.indexOf(s) === i)
      .slice(0, 3)
      .map((s) => s.slice(0, 260));
    if (partial.length) { status = 'partly_void'; statusText = 'in force, but parts have been annulled or repealed'; }
  }
  return { id, title, url: `https://www.boe.es/buscar/act.php?id=${id}`, status, statusText, partial };
}

// does the post itself say the law is dead or partly annulled, near where it cites it?
// English and Spanish, any tense: "anul" covers anuló, anulado and anulación
const DEAD_WORDS = /repeal|derog|annul|\banul|nulidad|null and void|no longer in force|ceased to|ceased having|expired|struck down|rejected by congress|rechaz|decay|deca[ií]d|dej[oó] de|sin efecto|no convalid|not ratified|not validated|tumb[oóa]|invalid|ya no est[aá] en vigor|no est[aá] vigente/i;
function mentionsDead(text, norm) {
  const needles = [norm.id, norm.number, norm.ref].filter(Boolean);
  for (const n of needles) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(n, from);
      if (i < 0) break;
      if (DEAD_WORDS.test(text.slice(Math.max(0, i - 400), i + 400))) return true;
      from = i + n.length;
    }
  }
  return false;
}

export async function legalStatus(html, { cache = new Map() } = {}) {
  const norms = extractNorms(html);
  const text = strip(html);
  const results = [];
  for (const n of norms.slice(0, 12)) {
    try {
      let ids;
      if (n.id) ids = [n.id];
      else {
        let rows = cache.get(`resolve:${n.key}`);
        if (!rows) { rows = await resolveByNumber(n.rank, n.number); cache.set(`resolve:${n.key}`, rows); await sleep(250); }
        const at = text.indexOf(n.number);
        const context = at >= 0 ? text.slice(Math.max(0, at - 160), at + 160) : '';
        ids = pickMatches(rows, context).map((r) => r.id);
      }
      if (!ids.length) {
        results.push({ ref: n.ref, status: 'not_found', statusText: 'not found on the BOE under that type and number (regional or EU law, or a typo)', partial: [], attention: false });
        continue;
      }
      const found = [];
      for (const id of ids.slice(0, 4)) {
        if (!cache.has(id)) { cache.set(id, await statusOf(id)); await sleep(250); }
        found.push(cache.get(id));
      }
      // several possible laws and at least one in force: list them, but do not flag
      const ambiguousAlive = found.length > 1 && found.some((f) => f.status === 'in_force' || f.status === 'partly_void');
      for (const f of found) {
        // attention (red): the whole law is repealed, annulled or expired and the post does
        // not say so. review (amber): the law stands but parts were annulled or repealed
        // (Ley 12/2023, RD 1312/2024), so the post must not rely on those parts.
        const wholeDead = ['repealed', 'annulled', 'expired'].includes(f.status);
        const partly = f.status === 'partly_void';
        const said = wholeDead || partly ? mentionsDead(text, { ...n, id: f.id }) : null;
        results.push({
          ref: ids.length > 1 ? `${n.ref} (one of ${ids.length} laws with this number)` : n.ref,
          id: f.id, title: f.title, url: f.url, status: f.status, statusText: f.statusText, partial: f.partial || [],
          mentionsDead: said, attention: wholeDead && !said && !ambiguousAlive, review: partly && !said && !ambiguousAlive,
        });
      }
    } catch (e) {
      results.push({ ref: n.ref, status: 'error', statusText: `BOE check failed: ${String(e && e.message || e).slice(0, 80)}`, partial: [], attention: false });
    }
  }
  // one row per law: a post that links BOE-A-2026-6545 and also names Real Decreto-ley
  // 8/2026 cites one law, not two. Keep the named reference.
  const byId = new Map();
  const out = [];
  for (const r of results) {
    if (!r.id) { out.push(r); continue; }
    const prev = byId.get(r.id);
    if (!prev) { byId.set(r.id, r); out.push(r); continue; }
    if (/^BOE-A-/.test(prev.ref) && !/^BOE-A-/.test(r.ref)) prev.ref = r.ref;
    prev.mentionsDead = prev.mentionsDead || r.mentionsDead;
    prev.attention = prev.attention && r.attention;
    prev.review = prev.review && r.review;
  }
  return out;
}
