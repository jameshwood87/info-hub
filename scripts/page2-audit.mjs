/**
 * page2-audit.mjs - Page-2 SEO opportunity audit for info.propertylist.es.
 *
 * Finds queries already ranking on page 2 (positions 11-20.99) with real
 * impressions and almost no clicks, works out which of OUR pages ranks for
 * each, flags cannibalization (two of our pages splitting one query), audits
 * the ranking page's title / meta / H1 against the query, and ranks it all by
 * click upside rather than raw volume.
 *
 * Pulls Search Console through the API (scripts/gsc.mjs) - no browser, no
 * finicky rows-per-page dropdown, runs unattended.
 *
 * Usage:
 *   node scripts/page2-audit.mjs            # report + dashboard, no email
 *   node scripts/page2-audit.mjs --email    # also email the summary (NOTIFY_TO)
 *
 * Outputs (var/admin/page2-audit/):
 *   YYYY-MM-DD.json   full report, kept per run so the next run can diff
 *   latest.json       copy of the newest report
 *   latest.html       dashboard
 */
import fs from 'node:fs';
import path from 'node:path';
import { rawQuery } from './gsc.mjs';

const ORIGIN = 'https://info.propertylist.es';
const LOCAL = 'http://127.0.0.1:3000';
const OUT = '/opt/info-hub/var/admin/page2-audit';
const ENV = fs.readFileSync('/opt/info-hub/.env', 'utf8');
const cfg = (k) => (ENV.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const SEND_EMAIL = process.argv.includes('--email');

// Planning constant: a conservative stand-in for CTR at roughly position 5, the
// realistic landing spot for a page-2 query that gets attention. It orders the
// list; it is not a forecast.
const TARGET_CTR = 0.06;
const DAYS = 28;

const today = new Date();
const stamp = today.toISOString().slice(0, 10);
const ddmmyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (q) => fold(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const pct = (n) => (n * 100).toFixed(1) + '%';
const rel = (u) => String(u || '').replace(ORIGIN, '') || '/';

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 1. pull
const [siteRows, qRows, qpRows, prevQRows] = await Promise.all([
  rawQuery([], { days: DAYS }),
  rawQuery(['query'], { days: DAYS, rowLimit: 1000 }),
  rawQuery(['query', 'page'], { days: DAYS, rowLimit: 5000 }),
  rawQuery(['query'], { days: DAYS, endOffsetDays: DAYS, rowLimit: 1000 }),
]);
const site = siteRows[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
const queries = qRows.map((r) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
const prevByQ = new Map(prevQRows.map((r) => [r.keys[0], { position: r.position, clicks: r.clicks, impressions: r.impressions }]));

// query -> pages (for cannibalization + "which page ranks")
const pagesByQ = new Map();
for (const r of qpRows) {
  const [q, page] = r.keys;
  if (!pagesByQ.has(q)) pagesByQ.set(q, []);
  pagesByQ.get(q).push({ page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
}
for (const list of pagesByQ.values()) list.sort((a, b) => b.impressions - a.impressions);

// ---------------------------------------------------------------- 2. bands
const band = queries
  .filter((r) => r.position >= 11 && r.position < 21 && r.impressions >= 10)
  .map((r) => ({ ...r, gain: Math.max(0, Math.round(r.impressions * (TARGET_CTR - r.ctr))) }))
  .sort((a, b) => b.gain - a.gain);
const top = band.slice(0, 20);
const snippet = queries.filter((r) => r.position >= 8 && r.position < 11 && r.impressions >= 50 && r.ctr < 0.02).sort((a, b) => b.impressions - a.impressions);
const farBack = queries.filter((r) => r.position >= 21 && r.impressions >= 50).sort((a, b) => b.impressions - a.impressions).slice(0, 15);

// ---------------------------------------------------------------- 2b. question queries
// The GSC question filter. English question words alone miss most of our
// demand (roughly a quarter of our named queries are Spanish), so the Spanish
// set runs alongside. Reported at ANY position: the job these surface is not a
// new post, it is opening the ranking page and checking it answers the
// question in its first 100 words, which is also what earns an AI Overview
// citation.
const Q_EN = /^(\S+\s+)*(who|what|when|where|why|how|which|can|do|does|did|is|are|should|will)\b(\s+\S+){4,}$/i;
const Q_ES = /^(\S+\s+)*(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|cu[aá]l|cu[aá]nto|cu[aá]ntos|puedo|puede|hay|necesito|debo|sirve|vale)\b(\s+\S+){4,}$/i;
const questions = queries
  .filter((r) => r.impressions >= 3 && (Q_EN.test(r.q) || Q_ES.test(r.q)))
  .map((r) => {
    const p = (pagesByQ.get(r.q) || [])[0];
    return { ...r, lang: Q_ES.test(r.q) ? 'es' : 'en', page: p ? rel(p.page) : null };
  })
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 25);

// ---------------------------------------------------------------- 2c. intent clusters
// One intent is often typed five different ways, each too small on its own to
// clear the page-2 threshold, which is how a cannibalized commercial query can
// sit invisible for months. Cluster on shared stemmed content words so the
// intent's real size shows and any split across our pages becomes visible.
const STOP = new Set(['the','and','for','are','can','how','what','which','with','you','your','from','that','this','does','did','was','were','has','have','get','not','all','any','its','who','when','where','why','will','should','que','los','las','del','por','para','como','una','uno','con','sobre','mas','muy','hay','ser','son']);
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w);
const keyset = (q) => new Set(words(q).filter((w) => !STOP.has(w)).map(stem));
// Terms so common on this site that two queries sharing one tell us nothing.
// Keeping them out of the MATCHING set stops them bridging unrelated intents.
const WEAK = new Set(['prope','porta','list','listi','spain','spani','espan','inmob','marbe','malag','estep','casa','home','house','agent','agenc','costa','sol','del']);
const clusters = [];
for (const r of queries.filter((x) => x.impressions >= 3).sort((a, b) => b.impressions - a.impressions)) {
  const ks = keyset(r.q);
  const strong = new Set([...ks].filter((k) => !WEAK.has(k)));
  if (ks.size < 2) continue;
  let hit = null;
  for (const c of clusters) {
    // Match against the SEED only. Matching the accumulated union let A-B and
    // B-C chain A and C together even when A and C share nothing.
    let shared = 0, sharedStrong = 0;
    for (const k of ks) if (c.seed.has(k)) { shared++; if (!WEAK.has(k)) sharedStrong++; }
    // Two shared terms, at least one of them distinctive.
    if (shared >= 2 && sharedStrong >= 1) { hit = c; break; }
  }
  if (hit) hit.queries.push(r);
  else clusters.push({ seed: ks, strong, queries: [r] });
}
const intents = clusters
  .filter((c) => c.queries.length >= 3)
  .map((c) => {
    const qs = c.queries.slice().sort((a, b) => b.impressions - a.impressions);
    const impressions = qs.reduce((s2, r) => s2 + r.impressions, 0);
    const clicks = qs.reduce((s2, r) => s2 + r.clicks, 0);
    const position = +(qs.reduce((s2, r) => s2 + r.position * r.impressions, 0) / (impressions || 1)).toFixed(1);
    const pageImpr = new Map();
    for (const r of qs) for (const p of pagesByQ.get(r.q) || []) {
      const k = rel(p.page);
      pageImpr.set(k, (pageImpr.get(k) || 0) + p.impressions);
    }
    // Normalise against the page totals themselves, not the separately fetched
    // query total: the two come from different API calls and do not reconcile,
    // which let shares sum past 100% and flag spurious splits.
    const pageTotal = [...pageImpr.values()].reduce((s2, v) => s2 + v, 0) || 1;
    const pages = [...pageImpr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([path, impr]) => ({ path, impr, share: impr / pageTotal }));
    return {
      label: qs[0].q, n: qs.length, impressions, clicks, position,
      split: pages.filter((p) => p.share >= 0.15).length >= 2,
      queries: qs.slice(0, 6), pages,
    };
  })
  .filter((c) => c.impressions >= 20)
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 12);

// ---------------------------------------------------------------- 3. pages + cannibalization
const pageCache = new Map();
async function auditPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const out = { url, path: rel(url), title: '', meta: '', h1: '', h2: [], ok: false };
  try {
    const html = await (await fetch(LOCAL + out.path, { headers: { 'User-Agent': 'page2-audit/1' }, signal: AbortSignal.timeout(25000) })).text();
    const head = html.split('</head>')[0] || html;
    out.title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
    out.meta = (head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || head.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '').trim();
    const body = html.split('</head>')[1] || html;
    out.h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    out.h2 = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
    out.ok = true;
  } catch (e) { out.error = String(e).slice(0, 80); }
  pageCache.set(url, out);
  return out;
}
const coverage = (q, text) => {
  const w = words(q); if (!w.length) return 1;
  const t = fold(text);
  return w.filter((x) => t.includes(x)).length / w.length;
};

for (const r of top) {
  const pages = pagesByQ.get(r.q) || [];
  const total = pages.reduce((s, p) => s + p.impressions, 0) || 1;
  const significant = pages.filter((p) => p.impressions / total >= 0.15);
  r.pages = pages.slice(0, 4).map((p) => ({ ...p, path: rel(p.page), share: p.impressions / total }));
  r.cannibal = significant.length >= 2;
  const primary = pages[0];
  r.page = primary ? rel(primary.page) : null;
  if (primary) {
    const a = await auditPage(primary.page);
    r.audit = a;
    r.inTitle = coverage(r.q, a.title);
    r.inH1 = coverage(r.q, a.h1);
    r.inMeta = coverage(r.q, a.meta);
  }
  const d = [];
  if (r.cannibal) d.push('cannibalization');
  if (r.audit && !r.audit.meta) d.push('no-meta');
  if (r.audit && r.inTitle < 0.6) d.push('metadata');
  if (r.audit && r.inTitle >= 0.6 && r.inH1 < 0.6) d.push('h1');
  if (!d.length) d.push(r.position > 15 ? 'depth' : 'near-miss');
  r.diagnosis = d;
  const prev = prevByQ.get(r.q);
  r.prevPosition = prev ? prev.position : null;
  r.delta = prev ? +(prev.position - r.position).toFixed(1) : null; // + = moved up
}

// week-over-week vs the LAST STORED RUN (not the GSC previous window)
const runs = fs.readdirSync(OUT).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${stamp}.json`).sort();
const lastRun = runs.length ? JSON.parse(fs.readFileSync(path.join(OUT, runs[runs.length - 1]), 'utf8')) : null;
const lastTop = new Map((lastRun?.top || []).map((r) => [r.q, r]));
for (const r of top) {
  const l = lastTop.get(r.q);
  r.sinceLastRun = l ? { position: +(l.position - r.position).toFixed(1), clicks: r.clicks - l.clicks, gain: r.gain - l.gain } : null;
  r.isNew = !l && !!lastRun;
}

// ---------------------------------------------------------------- 4. fixes (mechanical, honest)
const fixFor = (r) => {
  const a = r.audit; if (!a) return 'Page could not be fetched - check the URL.';
  const parts = [];
  if (r.cannibal) parts.push(`Two or more of our pages rank for this: ${r.pages.filter((p) => p.share >= 0.15).map((p) => `${p.path} (pos ${p.position.toFixed(1)}, ${Math.round(p.share * 100)}%)`).join(' vs ')}. Keep the one ranking best and 301 the other(s) into it.`);
  if (!a.meta) parts.push('No meta description - Google is writing the snippet. Add one that contains the query phrase.');
  if (r.inTitle < 0.6) parts.push(`Query words are missing from the title ("${a.title.slice(0, 70)}"). Put the phrase "${r.q}" in it.`);
  if (r.inTitle >= 0.6 && r.inH1 < 0.6) parts.push(`Title says it, H1 does not ("${a.h1.slice(0, 60)}"). Align the H1 with the query.`);
  if (!parts.length) parts.push(r.position > 15 ? 'Title, H1 and meta already match. This is content depth or authority, not a metadata tweak - a dedicated section or a better page.' : 'On-page already aligned and close to page 1 - internal links to this page from related posts are the cheapest push left.');
  return parts.join(' ');
};
for (const r of top) r.fix = fixFor(r);

// ---------------------------------------------------------------- 5. report
const report = {
  generatedAt: today.toISOString(), days: DAYS, targetCtr: TARGET_CTR,
  site: { clicks: site.clicks, impressions: site.impressions, ctr: site.ctr, position: site.position },
  bandCount: band.length, bandImpressions: band.reduce((s, r) => s + r.impressions, 0),
  clicksInPlay: top.reduce((s, r) => s + r.gain, 0),
  top, snippet, farBack, questions, intents, previousRun: runs.length ? runs[runs.length - 1] : null,
};
fs.writeFileSync(path.join(OUT, `${stamp}.json`), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(report, null, 2));

// ---------------------------------------------------------------- 6. dashboard
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const chip = (d) => ({ cannibalization: 'Cannibalization', metadata: 'Metadata', h1: 'H1 mismatch', 'no-meta': 'No meta', depth: 'Content depth', 'near-miss': 'Near miss' })[d] || d;
const scale = (p) => { const x = Math.max(0, Math.min(100, (30 - p) / 30 * 100)); return `<div class="sc"><i style="left:${(30 - 10) / 30 * 100}%"></i><b style="width:${x}%"></b></div>`; };
const rows = top.map((r, i) => `<tr>
<td class="n">${i + 1}</td>
<td><div class="q">${esc(r.q)}</div><div class="pg">${esc(r.page || '?')}</div></td>
<td class="num">${r.impressions.toLocaleString('en-GB')}</td>
<td class="num">${r.clicks}</td>
<td class="num">${r.position.toFixed(1)}${r.delta != null ? `<span class="d ${r.delta > 0 ? 'up' : r.delta < 0 ? 'dn' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</span>` : ''}</td>
<td>${scale(r.position)}</td>
<td class="num g">+${r.gain}</td>
<td>${r.diagnosis.map((d) => `<span class="ch ${d}">${chip(d)}</span>`).join(' ')}</td>
</tr>`).join('');
const fixes = top.slice(0, 10).map((r, i) => `<div class="fx"><div class="fxh"><span class="n">${i + 1}</span><b>${esc(r.q)}</b><span class="meta">${r.impressions.toLocaleString('en-GB')} impr · pos ${r.position.toFixed(1)} · +${r.gain} clicks/mo</span></div>
<div class="fxp">${esc(r.page)}</div>
<div class="fxb">${esc(r.fix)}</div>
${r.audit ? `<div class="fxa"><span>Title</span>${esc(r.audit.title) || '<em>none</em>'}<span>H1</span>${esc(r.audit.h1) || '<em>none</em>'}<span>Meta</span>${esc(r.audit.meta) || '<em>none</em>'}</div>` : ''}</div>`).join('');
const side = (list, label, note) => `<section><h2>${label}</h2><p class="lede">${note}</p>${list.length ? `<div class="tw"><table><tr><th>Query</th><th class="num">Impr</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">Pos</th></tr>${list.slice(0, 15).map((r) => `<tr><td>${esc(r.q)}</td><td class="num">${r.impressions.toLocaleString('en-GB')}</td><td class="num">${r.clicks}</td><td class="num">${pct(r.ctr)}</td><td class="num">${r.position.toFixed(1)}</td></tr>`).join('')}</table></div>` : '<p class="lede">None this period.</p>'}</section>`;

// optional hand-written rewrites (var/admin/page2-audit/notes.json)
let notesHtml = '';
try {
  const notes = JSON.parse(fs.readFileSync(path.join(OUT, 'notes.json'), 'utf8'));
  const row = (k, v) => v ? `<span>${k}</span><div>${esc(v)}</div>` : '';
  const block = (label, o) => o ? `<div class="ba"><div class="bal">${label}</div><div class="bag">${row('Title', o.title)}${row('H1', o.h1)}${row('Meta', o.meta)}${row('H2 / links', o.h2)}</div></div>` : '';
  notesHtml = `<section><h2>Analyst rewrites</h2><p class="lede">Exact changes, written by hand from the data below and kept until updated (notes.json, last updated ${esc(notes.updated || '?')}). ${esc(notes.context || '')}</p>` +
    (notes.items || []).map((n, i) => `<div class="fx"><div class="fxh"><span class="n">${i + 1}</span><b>${esc(n.label)}</b></div><div class="fxp">${esc(n.page)}</div>${n.impressions ? `<div class="fxm">${esc(n.impressions)}</div>` : ''}${block('Before', n.before)}${block('After', n.after)}<div class="fxb">${esc(n.why)}</div></div>`).join('') + `</section>`;
} catch {}

const qHtml = `<section><h2>Question queries</h2><p class="lede">Long-tail questions people actually typed, English and Spanish, at any position. The job is not a new blog post: open the ranking page and check it answers the question in its first 100 words.</p>${questions.length ? `<div class="tw"><table><tr><th>Question</th><th class="num">Impr</th><th class="num">Clicks</th><th class="num">Pos</th><th>Ranking page</th></tr>${questions.map((r) => `<tr><td>${esc(r.q)}</td><td class="num">${r.impressions}</td><td class="num">${r.clicks}</td><td class="num">${r.position.toFixed(1)}</td><td>${esc(r.page || '?')}</td></tr>`).join('')}</table></div>` : '<p class="lede">None this period.</p>'}</section>`;
const iHtml = `<section><h2>Intent clusters</h2><p class="lede">Queries grouped by shared terms, so an intent typed several ways shows its real size. Clustering is a heuristic on shared terms, so read the phrasings first and confirm they really are one intent. Where they are, a cluster marked SPLIT has two or more of our pages each taking 15% or more of it, and the question is which page should own it.</p>${intents.length ? intents.map((c) => `<div class="fx"><div class="fxh"><b>${esc(c.label)}</b><span class="meta">${c.n} phrasings · ${c.impressions.toLocaleString('en-GB')} impr · ${c.clicks} clicks · pos ${c.position}${c.split ? ' · SPLIT' : ''}</span></div><div class="fxb">${c.queries.map((r) => esc(r.q) + ' (' + r.impressions + ')').join(' · ')}</div><div class="fxp">${c.pages.map((p) => esc(p.path) + ' ' + Math.round(p.share * 100) + '%').join('   |   ')}</div></div>`).join('') : '<p class="lede">None this period.</p>'}</section>`;

const html = `<title>Page-2 SEO Audit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Atkinson+Hyperlegible:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root{--paper:#f7f8f6;--card:#fff;--ink:#17211d;--muted:#5c6b64;--line:#dfe5e1;--acc:#0a6d61;--acc2:#e3efec;--warn:#a8632a;--warn2:#f4ece2;--bad:#a8322e;--bad2:#f6e5e4}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#101613;--card:#18211c;--ink:#e6ece8;--muted:#93a49b;--line:#2a352e;--acc:#3fae9c;--acc2:#1c2f2a;--warn:#d69054;--warn2:#2c231a;--bad:#d0605c;--bad2:#2e1c1b}}
:root[data-theme=dark]{--paper:#101613;--card:#18211c;--ink:#e6ece8;--muted:#93a49b;--line:#2a352e;--acc:#3fae9c;--acc2:#1c2f2a;--warn:#d69054;--warn2:#2c231a;--bad:#d0605c;--bad2:#2e1c1b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 "Atkinson Hyperlegible",system-ui,sans-serif}
.w{max-width:1100px;margin:0 auto;padding:36px 20px 70px}h1{font:800 clamp(26px,4.6vw,38px)/1.1 "Bricolage Grotesque",sans-serif;margin:0}h2{font:700 20px "Bricolage Grotesque",sans-serif;margin:0 0 4px}
.sub{color:var(--muted);font:12px "IBM Plex Mono",monospace;margin-top:8px}.lede{color:var(--muted);font-size:14px;margin:0 0 14px;max-width:72ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0}.st{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}.st .l{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);font-weight:700}.st .v{font:800 28px "Bricolage Grotesque",sans-serif;font-variant-numeric:tabular-nums}.st .s{font-size:12px;color:var(--muted)}
section{margin-top:36px}.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-family:"IBM Plex Mono",monospace;font-size:13px;white-space:nowrap}td.n{color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:12px}.g{color:var(--acc);font-weight:700}
.q{font-weight:700}.pg{font:12px "IBM Plex Mono",monospace;color:var(--muted);word-break:break-all}
.d{margin-left:6px;font-size:11px;color:var(--muted)}.d.up{color:var(--acc)}.d.dn{color:var(--bad)}
.sc{position:relative;width:120px;height:8px;background:var(--line);border-radius:4px;margin-top:6px}.sc b{position:absolute;left:0;top:0;bottom:0;background:var(--acc);border-radius:4px;opacity:.75}.sc i{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink);opacity:.5}
.ch{display:inline-block;font:600 11px "IBM Plex Mono",monospace;padding:2px 7px;border-radius:4px;background:var(--acc2);color:var(--acc);white-space:nowrap}.ch.cannibalization{background:var(--bad2);color:var(--bad)}.ch.metadata,.ch.h1,.ch.no-meta{background:var(--warn2);color:var(--warn)}
.fx{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}.fxh{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}.fxh .n{font:600 12px "IBM Plex Mono",monospace;color:var(--muted)}.fxh .meta{font:12px "IBM Plex Mono",monospace;color:var(--muted)}.fxp{font:12px "IBM Plex Mono",monospace;color:var(--acc);margin:3px 0 8px;word-break:break-all}.fxb{font-size:14.5px}.fxa{display:grid;grid-template-columns:52px 1fr;gap:4px 10px;margin-top:10px;font-size:13px;color:var(--muted);border-top:1px dashed var(--line);padding-top:10px}.fxa span{font:600 11px "IBM Plex Mono",monospace;text-transform:uppercase}
.fxm{font:12px "IBM Plex Mono",monospace;color:var(--muted);margin-bottom:8px}.ba{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}.bal{font:700 11px "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px}.bag{display:grid;grid-template-columns:78px 1fr;gap:5px 10px;font-size:13.5px}.bag span{font:600 11px "IBM Plex Mono",monospace;text-transform:uppercase;color:var(--muted)}.ba+.ba .bal{color:var(--acc)}
.note{border-left:3px solid var(--warn);background:var(--warn2);padding:10px 14px;border-radius:0 8px 8px 0;font-size:14px;margin-top:14px}footer{margin-top:40px;font:11.5px "IBM Plex Mono",monospace;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
</style>
<div class="w"><h1>Page-2 SEO Audit</h1><div class="sub">info.propertylist.es · last ${DAYS} days to ${ddmmyy(today)} · Search Console API · scale marker = page-1 threshold (position 10)</div>
<div class="stats"><div class="st"><div class="l">Clicks in play</div><div class="v">+${report.clicksInPlay}</div><div class="s">per month, top 20, at ${Math.round(TARGET_CTR * 100)}% CTR planning figure</div></div><div class="st"><div class="l">Queries in band</div><div class="v">${band.length}</div><div class="s">pos 11-20 · 10+ impr</div></div><div class="st"><div class="l">Band impressions</div><div class="v">${report.bandImpressions.toLocaleString('en-GB')}</div><div class="s">${DAYS} days</div></div><div class="st"><div class="l">Site clicks</div><div class="v">${site.clicks.toLocaleString('en-GB')}</div><div class="s">${site.impressions.toLocaleString('en-GB')} impr · ${pct(site.ctr)} CTR · avg pos ${site.position.toFixed(1)}</div></div></div>
<p class="note">The gain column is <b>impressions × (${TARGET_CTR} − current CTR)</b>. ${TARGET_CTR} stands in for CTR at about position 5, the realistic landing spot for a page-2 query that gets attention. It orders the list; it is not a forecast.</p>
<section><h2>Top 20 by click upside</h2><p class="lede">Position 11-20.99, 10+ impressions, ranked by estimated clicks gained rather than by volume. Position delta is against the previous ${DAYS}-day window.</p><div class="tw"><table><tr><th></th><th>Query · ranking page</th><th class="num">Impr</th><th class="num">Clicks</th><th class="num">Pos</th><th>To page 1</th><th class="num">Gain</th><th>Diagnosis</th></tr>${rows}</table></div></section>
${notesHtml}
<section><h2>Fixes, by return</h2><p class="lede">Exact on-page state and what to change. Where title, H1 and meta already match, it says so rather than inventing a tweak.</p>${fixes}</section>
${side(snippet, 'Already on page 1, still not clicked', 'Position 8-11, 50+ impressions, under 2% CTR. A snippet problem (title / meta), not a ranking problem, and a faster fix than moving anything up.')}
${side(farBack, 'Too far back for a tweak', '50+ impressions but position 21+. Listed so you know they exist; these need a better page, not a title edit.')}
${qHtml}
${iHtml}
<footer>Generated ${today.toISOString()} · ${queries.length} queries pulled · ${qpRows.length} query-page rows · previous stored run: ${report.previousRun || 'none'}</footer></div>`;
fs.writeFileSync(path.join(OUT, 'latest.html'), html);

// ---------------------------------------------------------------- 7. email
console.log(`page2-audit: band=${band.length} top=${top.length} clicksInPlay=${report.clicksInPlay} cannibal=${top.filter((r) => r.cannibal).length} snippet=${snippet.length}`);
if (SEND_EMAIL) {
  const KEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es';
  const DASH = cfg('PAGE2_DASHBOARD_URL');
  if (!KEY || !TO) { console.log('page2-audit: email skipped (MANDRILL_API_KEY / NOTIFY_TO missing)'); process.exit(0); }
  const t3 = top.slice(0, 3);
  const line = (r, i) => `${i + 1}. "${r.q}" - ${r.impressions} impressions, position ${r.position.toFixed(1)}${r.delta != null ? ` (${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat'} ${Math.abs(r.delta)} vs previous ${DAYS}d)` : ''}, about +${r.gain} clicks a month\n   Page: ${r.page}\n   Fix: ${r.fix}`;
  const moved = top.filter((r) => r.sinceLastRun && Math.abs(r.sinceLastRun.position) >= 1).map((r) => `- "${r.q}": ${r.sinceLastRun.position > 0 ? 'up' : 'down'} ${Math.abs(r.sinceLastRun.position)} since last run`).slice(0, 6);
  const cann = top.filter((r) => r.cannibal).map((r) => `- "${r.q}": ${r.pages.filter((p) => p.share >= 0.15).map((p) => `${p.path} (pos ${p.position.toFixed(1)})`).join(' vs ')}`);
  const text = `Weekly page-2 SEO audit - info.propertylist.es - ${ddmmyy(today)}

Site, last ${DAYS} days: ${site.clicks} clicks from ${site.impressions.toLocaleString('en-GB')} impressions (${pct(site.ctr)} CTR, average position ${site.position.toFixed(1)}).
${band.length} queries sit on page 2 with real impressions. Top 20 are worth roughly +${report.clicksInPlay} clicks a month at a ${Math.round(TARGET_CTR * 100)}% CTR planning figure - an ordering number, not a forecast.

TOP 3 OPPORTUNITIES
${t3.map(line).join('\n\n')}
${cann.length ? `\nCANNIBALIZATION - two of our pages splitting one query (biggest available win)\n${cann.join('\n')}` : ''}
${snippet.length ? `\nALREADY ON PAGE 1, NOT CLICKED (snippet problem, fast fix)\n${snippet.slice(0, 5).map((r) => `- "${r.q}": ${r.impressions} impr, ${pct(r.ctr)} CTR, pos ${r.position.toFixed(1)}`).join('\n')}` : ''}
${lastRun ? `\nSINCE LAST RUN (${report.previousRun})\n${moved.length ? moved.join('\n') : '- No top-20 query moved a full position.'}` : '\nFirst run - week-over-week deltas start next week.'}

Full dashboard: ${DASH || 'var/admin/page2-audit/latest.html on the droplet'}
Movement from on-page changes shows in 2-4 weeks. Do not re-edit a page every Friday.`;
  const res = await fetch('https://mandrillapp.com/api/1.0/messages/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO }], subject: `[SEO] Page-2 audit ${ddmmyy(today)}: +${report.clicksInPlay} clicks/mo in play, ${cann.length} cannibalization, ${report.intents.filter((c) => c.split).length} split intents`, text, tags: ['info-hub', 'page2-audit'], track_opens: false, track_clicks: false } }),
  });
  console.log('page2-audit: email', res.status, (await res.text()).slice(0, 120));
}
