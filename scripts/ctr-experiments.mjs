#!/usr/bin/env node
/**
 * ctr-experiments.mjs - weekly search-title tests (Mon 06:00).
 *
 * 24-09-26, James: title changes should not wait for his approval ("it should be based on facts
 * and stats"). The Search Console data picks the page and judges the result; the words come
 * from a model, so the checks are automatic instead of a person:
 * 1) JUDGE each test on the 28 days that start 3 days after it went live, against the 28 days
 *    before, adjusted by how the untouched content pages moved over the same weeks
 *    (lib/ctr-stats.mjs). A clear loss is undone by itself, unless the page was edited since
 *    or the old wording fails today's checks; then it is flagged for a rewrite instead.
 * 2) START up to 3 tests on English content pages with at least 300 appearances in 28 days, an
 *    average position in the top 15 and a click rate under 1.5%, not tested in the last 90 days.
 *    The model sees the page text, and its wording must pass lib/title-checks.mjs (page
 *    language, no number that is not on the page, lint and wording rules, length, every
 *    statement backed by the page text, the retired-laws list, the PropertyList facts list).
 *    A set that fails is skipped and logged.
 * 3) TELL James in one email when something started or was judged, with a signed Undo link per
 *    live title (src/pages/api/seo/ctr-approve.ts, valid 30 days). A quiet week sends nothing.
 *
 *   node scripts/ctr-experiments.mjs [--dry-run]   (dry run: reads and calls the model, changes nothing)
 */
import fs from 'fs';
import { createHmac, randomBytes } from 'node:crypto';
import { rawQuery } from './gsc.mjs';
import { checkTitleSet, stripHtml } from './lib/title-checks.mjs';
import { windows, judge, controlFactor, DAY } from './lib/ctr-stats.mjs';
import { legalCurrencyBlock } from './lib/legal-currency.mjs';
import { claimsLedgerBlock, liveCounts } from './lib/claims-ledger.mjs';

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
const WEBHOOK = (process.env.DISCORD_IDEAS_WEBHOOK || '').trim();
// CTR_LEDGER_PATH lets a test run use a scratch ledger
const LEDGER = process.env.CTR_LEDGER_PATH || '/opt/info-hub/var/admin/ctr-experiments.json';
const AUDIT = '/opt/info-hub/var/admin/audit.jsonl';
const ORIGIN = 'https://info.propertylist.es';
const DRY = process.argv.includes('--dry-run');
const MIN_IMPRESSIONS = 300, MAX_POSITION = 15, MAX_CTR = 0.015, COOLDOWN_DAYS = 90, MAX_NEW = 3, GSC_LAG_DAYS = 3;
const CONTENT = /^\/(blog|general-information|estate-agents|lifestyle|food|nightlife|neighbourhood|docs)\//;

const norm = (u) => { let p = String(u || '').replace(ORIGIN, '').split('?')[0]; return p.endsWith('/') ? p : p + '/'; };
const discord = async (content) => {
  if (!WEBHOOK || DRY) return;
  try { await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1990), username: 'PropertyList CTR Lab' }) }); } catch {}
};
async function directus(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Directus ${res.status}`);
  return res.json();
}
async function aiJson(messages) {
  const res = await fetch(`${AI_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: 6000 }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}`);
  return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
}
const indexNow = async (path) => {
  try {
    const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
    await fetch('https://www.bing.com/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: [ORIGIN + path] }) });
  } catch {}
};
const audit = (entry) => { try { fs.appendFileSync(AUDIT, `${JSON.stringify({ at: new Date().toISOString(), userId: 'ctr-experiments', ...entry })}\n`); } catch {} };
const same = (x, y) => String(x ?? '') === String(y ?? '');
const matches = (page, fields) => Object.keys(fields).every((k) => same(page[k], fields[k]));
const pageTextOf = (rec) => `${rec.title || ''} ${stripHtml(rec.body)}`;
const langOf = (path) => (String(path).startsWith('/es/') ? 'es' : 'en');
const pct = (x) => `${(x * 100).toFixed(1)}%`;

let ledger = [];
try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch {}
// saved after every live change, so a crash later in the run never leaves a change untracked
const saveLedger = () => { if (!DRY) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2)); };
const now = Date.now();
const lastDay = new Date(now - GSC_LAG_DAYS * DAY).toISOString().slice(0, 10);
const FACTS = claimsLedgerBlock(await liveCounts());

// ---- 0) tests started before 24-09-26 saved only the old title: recover the old and the new
// search title and description from Directus revisions so an undo can restore all three ----
async function recoverFromRevisions(e) {
  const revs = (await directus(`/revisions?filter[collection][_eq]=kb_pages&filter[item][_eq]=${encodeURIComponent(e.id)}&sort=-id&limit=40&fields=id,activity.timestamp,data,delta`)).data || [];
  const t = Date.parse(e.applied);
  const own = revs.find((x) => Math.abs(Date.parse(x.activity?.timestamp) - t) < 5 * 60000 && x.delta && ('seo_title' in x.delta || 'seo_description' in x.delta));
  const prior = revs.find((x) => Date.parse(x.activity?.timestamp) < t - 1000 && x.data);
  if (!own || !prior) return null;
  const keys = e.isDocs ? ['seo_title', 'seo_description'] : ['title', 'seo_title', 'seo_description'];
  const applied = {}, before = {};
  for (const k of keys) { applied[k] = own.delta[k] ?? prior.data[k] ?? ''; before[k] = prior.data[k] ?? ''; }
  return { applied, before, source: `directus revisions ${prior.id} (before) and ${own.id} (the change)` };
}
// a run that died between recording a change and making it: settle what actually happened
for (const e of ledger) {
  if (e.status !== 'applying') continue;
  const live = (await directus(`/items/kb_pages/${encodeURIComponent(e.id)}?fields=title,seo_title,seo_description`).catch(() => ({}))).data;
  e.status = live && e.applied_fields && matches(live, e.applied_fields) ? 'active' : 'apply_failed';
  console.log(`settled an interrupted change on ${e.path}: ${e.status}`);
}
for (const e of ledger) {
  if (e.status !== 'active') continue;
  if (!e.pid) e.pid = randomBytes(6).toString('hex');
  if (e.isDocs == null) e.isDocs = String(e.path).startsWith('/docs/');
  if (e.applied_fields && e.before && 'seo_description' in e.before) continue;
  const r = await recoverFromRevisions(e).catch(() => null);
  if (r) { e.before = { ...(e.before || {}), ...r.before }; e.applied_fields = r.applied; e.before_source = r.source; console.log('recovered the pre-test wording:', e.path); }
  else console.log('could not recover the pre-test wording (an automatic undo will be refused):', e.path);
}

// ---- 1) judge tests whose after-window has data ----
const rowCache = new Map();
async function pageRows(w) {
  const k = `${w.start}|${w.end}`;
  if (!rowCache.has(k)) rowCache.set(k, (await rawQuery(['page'], { startDate: w.start, endDate: w.end, rowLimit: 5000 })).map((r) => ({ path: norm(r.keys[0]), clicks: r.clicks, impressions: r.impressions, position: r.position })));
  return rowCache.get(k);
}
// pages with a test that started up to 60 days before the before-window, or inside either window, stay out of the control
const testedAround = (w) => {
  const from = Date.parse(w.before.start) - 60 * DAY, to = Date.parse(w.after.end) + DAY;
  return new Set(ledger.filter((e) => e.applied && Date.parse(e.applied) >= from && Date.parse(e.applied) <= to).map((e) => e.path));
};
async function undo(e) {
  const before = e.before || {};
  if (!e.applied_fields || !('seo_description' in before)) return 'not undone: the old wording was not saved';
  const page = (await directus(`/items/kb_pages/${encodeURIComponent(e.id)}?fields=id,title,seo_title,seo_description,body`).catch(() => ({}))).data;
  if (!page) return 'not undone: the page was not found';
  const restore = {};
  for (const k of Object.keys(e.applied_fields)) restore[k] = before[k] ?? '';
  const done = () => { e.status = 'undone'; e.undone_at = new Date().toISOString(); saveLedger(); };
  // an earlier undo whose reply was lost, or a hand edit back to the old wording
  if (matches(page, restore)) { if (!DRY) done(); return 'undone (the page already had the old wording)'; }
  if (!matches(page, e.applied_fields)) return 'not undone: the page was edited since';
  const chk = await checkTitleSet({ lang: langOf(e.path), fields: restore, pageText: pageTextOf(page), ledger: FACTS, aiJson, lengths: false });
  e.undo_ok = chk.ok; e.undo_problems = chk.problems;
  if (!chk.ok) return `not undone: the old wording fails the checks (${chk.problems.slice(0, 2).join('; ')}), so the page needs a rewrite`;
  if (DRY) return 'undone (dry run, nothing changed)';
  try {
    await directus(`/items/kb_pages/${encodeURIComponent(e.id)}`, { method: 'PATCH', body: restore });
  } catch (err) {
    // the request may have failed after Directus saved it: look before calling it a failure
    const live = (await directus(`/items/kb_pages/${encodeURIComponent(e.id)}?fields=title,seo_title,seo_description`).catch(() => ({}))).data;
    if (!live || !matches(live, restore)) throw err;
  }
  done();
  await indexNow(e.path);
  audit({ action: 'seo.title_test_undone', kbPageId: String(e.id), path: e.path, details: { pid: e.pid, restored: restore } });
  return 'undone';
}
const VERDICT = { better: 'Better', worse: 'Worse', no_clear_difference: 'No clear difference', too_little_data: 'Too little traffic to tell' };
const rate = (x) => (x && x.impressions ? pct(x.clicks / x.impressions) : 'n/a');
const verdictLine = (e) => {
  const r = e.result;
  const ctl = r.control && r.control.used ? ` The pages we did not touch moved ${r.control.factor >= 1 ? 'up' : 'down'} ${Math.abs((r.control.factor - 1) * 100).toFixed(0)}% over the same weeks.` : '';
  const act = r.action === 'kept' ? 'The new title stays.' : r.action === 'undone' ? 'The old title is back.' : `${r.action.charAt(0).toUpperCase()}${r.action.slice(1)}.`;
  return `${VERDICT[r.verdict] || r.verdict}: ${rate(r.before)} of ${r.before.impressions} appearances clicked before, ${rate(r.after)} of ${r.after.impressions} after.${ctl} ${act}`;
};

// whether the pre-test wording may come back: an Undo link is only offered when it passes the checks
async function checkUndo(e) {
  if (e.undo_ok != null || !e.applied_fields || !e.before || !('seo_description' in e.before)) return;
  const page = (await directus(`/items/kb_pages/${encodeURIComponent(e.id)}?fields=id,title,body`)).data;
  const restore = {};
  for (const k of Object.keys(e.applied_fields)) restore[k] = e.before[k] ?? '';
  const back = await checkTitleSet({ lang: langOf(e.path), fields: restore, pageText: pageTextOf(page || {}), ledger: FACTS, aiJson, lengths: false });
  e.undo_ok = back.ok; e.undo_problems = back.problems;
}

const judged = [];
for (const e of ledger) {
  if (e.status !== 'active' || !e.applied) continue;
  const w = windows(e.applied);
  if (w.after.end > lastDay) continue;
  try {
    const rb = await pageRows(w.before), ra = await pageRows(w.after);
    const pick = (rows) => { const r = rows.find((x) => x.path === e.path); return r ? { clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(1) } : { clicks: 0, impressions: 0, position: null }; };
    const b = pick(rb), a = pick(ra);
    const skip = testedAround(w);
    const ctl = controlFactor(rb, ra, (p) => CONTENT.test(p) && !skip.has(p));
    const v = judge(b, a, ctl.factor);
    e.result = { judged_at: new Date().toISOString(), windows: w, before: b, after: a, control: ctl, ...v };
    // the admin table reads before/after.ctr and after.impressions
    e.after = { clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? a.clicks / a.impressions : 0, position: a.position };
    e.result.action = v.verdict === 'worse' ? await undo(e) : 'kept';
    // a clear loss that could not be undone keeps its own status, so it never reads as a choice to keep
    if (e.status !== 'undone') e.status = v.verdict === 'worse' ? 'worse_not_undone' : 'kept';
    if (e.status !== 'undone') await checkUndo(e).catch(() => {});
    saveLedger();
    judged.push(e);
    console.log(`judged ${e.path}: ${v.verdict} (z ${v.z ?? '-'}, control x${ctl.factor}) -> ${e.result.action}`);
    await discord(`${v.verdict === 'better' ? '✅' : v.verdict === 'worse' ? '↩️' : '➖'} **Title test judged** ${ORIGIN}${e.path}\n${verdictLine(e)}`);
  } catch (err) {
    // nothing changed on the page unless the undo went through, which saved itself as 'undone'
    if (e.status === 'active') { delete e.result; delete e.after; }
    console.log(`could not judge ${e.path} this week, tried again next week: ${err.message}`);
  }
}

// ---- 2) start new tests ----
// Language guard (04-09-26): a page is only rewritten from queries in its own language,
// and always in its own language. Other-language impressions belong to the twin page.
const EN_WORDS = /\b(the|and|of|in|your|what|how|to|for|guide|with|is|a|do|does|can|spain|spanish)\b/i;
const ES_WORDS = /\b(de|la|el|y|que|qué|como|cómo|en|para|del|los|las|guía|una|un|es|cuanto|cuánto|españa)\b/i;
const queryLang = (q) => { const e = (q.match(new RegExp(EN_WORDS.source, 'gi')) || []).length; const s = (q.match(new RegExp(ES_WORDS.source, 'gi')) || []).length; return e > s ? 'en' : s > e ? 'es' : '?'; };
const NOT_OURS = /property\s*finder|idealista|fotocasa|kyero|rightmove|zoopla|bayut|dubizzle/i;

const cooling = new Set(ledger.filter((e) => e.status === 'active' || now - Date.parse(e.applied || e.proposed_at || e.attempted_at || 0) < COOLDOWN_DAYS * DAY).map((e) => e.path));
const rows28 = await rawQuery(['page'], { days: 28, rowLimit: 5000 });
// testing only: --candidate=<path> with --dry-run shows what the model would write for one page, ignoring the thresholds
const FORCE = (process.argv.find((a) => a.startsWith('--candidate=')) || '').slice('--candidate='.length);
if (FORCE && !DRY) { console.log('--candidate works only with --dry-run'); process.exit(1); }
const candidates = rows28
  .map((r) => ({ path: norm(r.keys[0]), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
  .filter((r) => (FORCE ? r.path === norm(FORCE) : CONTENT.test(r.path) && r.impressions >= MIN_IMPRESSIONS && r.position <= MAX_POSITION && r.ctr < MAX_CTR && !cooling.has(r.path)))
  .sort((a, b) => b.impressions - a.impressions);
console.log(`${candidates.length} pages qualify (${MIN_IMPRESSIONS}+ appearances in 28 days, top ${MAX_POSITION}, click rate under ${pct(MAX_CTR)}, no test in ${COOLDOWN_DAYS} days)`);

const started = [], skipped = [];
// one candidate; any error skips the page for this week, and a live change is on the ledger before it happens
async function startOne(c) {
  const rec = (await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent(c.path)}&filter[language][_eq]=en&filter[status][_eq]=published&fields=id,title,seo_title,seo_description,body`)).data?.[0];
  if (!rec) { console.log('no published record for', c.path); return; }
  const slug = c.path.split('/').filter(Boolean).pop();
  const qRowsAll = await rawQuery(['query', 'page'], { days: 28, rowLimit: 500, pageContains: slug });
  const totalImp = qRowsAll.reduce((a, r) => a + r.impressions, 0) || 1;
  const qRows = qRowsAll.filter((r) => queryLang(r.keys[0]) !== 'es' && !NOT_OURS.test(r.keys[0]));
  const ownImp = qRows.reduce((a, r) => a + r.impressions, 0);
  if (ownImp / totalImp < 0.4) { console.log('skip (other-language or third-party queries dominate, belongs to the twin page):', c.path); return; }
  const topQ = qRows.sort((a, b) => b.impressions - a.impressions).slice(0, 6).map((r) => `"${r.keys[0]}" (${r.impressions} imp, pos ${r.position.toFixed(1)})`);
  const isDocs = c.path.startsWith('/docs/');
  const pageText = pageTextOf(rec);
  console.log('candidate:', c.path, `imp=${c.impressions} ctr=${pct(c.ctr)} pos=${c.position.toFixed(1)}`);

  const out = await aiJson([{ role: 'user', content: `You are an SEO title optimiser. This English page ranks in Google but few searchers click it.

PAGE: ${ORIGIN}${c.path}
CURRENT TITLE: ${rec.title}
CURRENT SEO TITLE: ${rec.seo_title || '-'}
CURRENT META DESCRIPTION: ${rec.seo_description || '-'}
28-DAY STATS: ${c.impressions} impressions, ${pct(c.ctr)} CTR, avg position ${c.position.toFixed(1)}
REAL QUERIES IT APPEARS FOR: ${topQ.join('; ') || 'unknown'}

PAGE TEXT (the only facts you may use; every number, date or price you write must appear here):
${pageText.slice(0, 6000)}

${legalCurrencyBlock()}

Write the replacement in ENGLISH, the language of the page, whatever language the queries are in. The description's first sentence answers the searcher's question. Earn the click without clickbait: no "breaking", no "urgent", no promise the page does not keep. Use no number, date or price that is not in the page text. Never present a law listed above as no longer in force as if it were current. Plain hyphens only, no em dashes. Return JSON: {"title": "up to 110 characters", "seo_title": "up to 60 characters", "seo_description": "70 to 158 characters"}` }]).catch((err) => { console.log('model error, skipped', c.path, err.message); return null; });
  if (!out) return;
  const clean = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  // docs titles appear in the manual nav, so docs tests only touch the search fields
  const fields = isDocs ? { seo_title: clean(out.seo_title), seo_description: clean(out.seo_description) } : { title: clean(out.title), seo_title: clean(out.seo_title), seo_description: clean(out.seo_description) };
  if (Object.values(fields).some((v) => !v)) { console.log('model output incomplete, skipped', c.path); return; }
  if (matches(rec, fields)) { console.log('same as the live wording, skipped', c.path); return; }
  const chk = await checkTitleSet({ lang: 'en', fields, pageText, ledger: FACTS, aiJson });
  if (!chk.ok) {
    skipped.push({ path: c.path, problems: chk.problems });
    console.log(`failed the checks, skipped ${c.path}: ${chk.problems.join(' | ')}`);
    if (!DRY) { ledger.push({ path: c.path, id: String(rec.id), status: 'failed_checks', attempted_at: new Date().toISOString(), proposed: fields, problems: chk.problems }); saveLedger(); }
    return;
  }
  // may the current wording come back later? The Undo link is only offered when it passes the checks too
  const restore = {};
  for (const k of Object.keys(fields)) restore[k] = rec[k] || '';
  const back = await checkTitleSet({ lang: 'en', fields: restore, pageText, ledger: FACTS, aiJson, lengths: false });
  const entry = {
    pid: randomBytes(6).toString('hex'), path: c.path, id: String(rec.id), isDocs, status: 'applying', source: 'auto', applied: new Date().toISOString(),
    before: { title: rec.title || '', seo_title: rec.seo_title || '', seo_description: rec.seo_description || '', clicks: c.clicks, impressions: c.impressions, ctr: c.ctr, position: +c.position.toFixed(1) },
    applied_fields: fields, newTitle: fields.title || fields.seo_title, queries: topQ.slice(0, 4), checks: 'passed', undo_ok: back.ok, undo_problems: back.problems,
  };
  if (DRY) { entry.status = 'active'; started.push(entry); console.log(`dry-run: would start ${c.path}${back.ok ? '' : ' (no Undo: the current wording fails the checks)'}\n  ${JSON.stringify(fields)}`); return; }
  ledger.push(entry); saveLedger();
  try {
    await directus(`/items/kb_pages/${rec.id}`, { method: 'PATCH', body: fields });
  } catch (err) {
    // the request may have failed after Directus saved it: look before recording a failure
    const live = (await directus(`/items/kb_pages/${rec.id}?fields=title,seo_title,seo_description`).catch(() => ({}))).data;
    if (!live || !matches(live, fields)) { entry.status = 'apply_failed'; entry.error = err.message; saveLedger(); console.log('could not apply, nothing changed:', c.path, err.message); return; }
  }
  entry.status = 'active'; saveLedger();
  started.push(entry);
  await indexNow(c.path);
  audit({ action: 'seo.title_test_started', kbPageId: String(rec.id), path: c.path, details: { pid: entry.pid, before: { title: entry.before.title, seo_title: entry.before.seo_title, seo_description: entry.before.seo_description }, applied: fields } });
  await discord(`🧪 **Title test started** ${ORIGIN}${c.path}\nBefore: ${entry.before.seo_title || entry.before.title}\nNow: **${fields.seo_title}**\nJudged in about five weeks.`);
  console.log('started:', c.path);
}
for (const c of candidates) {
  if (started.length >= MAX_NEW) break;
  try { await startOne(c); } catch (err) { console.log(`could not test ${c.path} this week: ${err.message}`); }
}

saveLedger();
console.log(`ledger size: ${ledger.length}; started ${started.length}, judged ${judged.length}, skipped ${skipped.length}`);

// ---- 3) tell James: one email when something started or was judged ----
const subject = `[SEO] Search titles: ${started.length} changed, ${judged.length} judged`;
if (!started.length && !judged.length) {
  console.log('nothing started or judged: no email');
} else if (DRY) {
  console.log(`dry-run: would email "${subject}"`);
  for (const e of judged) console.log(`  judged ${e.path}: ${verdictLine(e)}`);
} else {
  const envText = fs.readFileSync('/opt/info-hub/.env', 'utf8');
  const cfg = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const KEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es', SECRET = cfg('BLOG_APPROVE_SECRET');
  if (!KEY || !TO || !SECRET) {
    console.log('ctr-experiments: results saved but NOT emailed (missing MANDRILL_API_KEY / NOTIFY_TO / BLOG_APPROVE_SECRET)');
  } else {
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    const link = (pid) => `${ORIGIN}/api/seo/ctr-approve?pid=${pid}&exp=${exp}&action=undo&sig=${createHmac('sha256', SECRET).update(`ctr|${pid}|${exp}|undo`).digest('hex')}`;
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const btn = (href) => `<a href="${href}" style="display:inline-block;background:#fff;color:#b42318;border:1px solid #b42318;text-decoration:none;font-weight:700;padding:7px 14px;border-radius:999px;margin:8px 0 0">Undo</a>`;
    const row = (label, before, after) => (same(before, after) ? '' : `<tr><td style="padding:4px 8px 4px 0;color:#667085;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0"><span style="color:#98a2b3;text-decoration:line-through">${esc(before) || '(empty)'}</span><br><b>${esc(after)}</b></td></tr>`);
    const card = (inner) => `<div style="border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px;margin:0 0 14px">${inner}</div>`;
    // an Undo link only exists when the old wording passed the checks (it could otherwise restore a wrong title)
    const undoFor = (x) => (x.undo_ok ? btn(link(x.pid)) : `<p style="margin:8px 0 0;font-size:13px;color:#b42318">No Undo button: the old wording fails the checks (${esc((x.undo_problems || [])[0] || 'it was not saved')}). If this title reads wrong, the page needs a rewrite.</p>`);
    const startedHtml = started.map((p) => card(`<p style="margin:0 0 6px"><a href="${ORIGIN}${esc(p.path)}">${esc(p.path)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#667085">Last 28 days: ${p.before.impressions} appearances in Google, ${pct(p.before.ctr)} clicked, average position ${p.before.position}.</p>
<table style="border-collapse:collapse;font-size:14px">${p.applied_fields.title ? row('Title', p.before.title, p.applied_fields.title) : ''}${row('Search title', p.before.seo_title, p.applied_fields.seo_title)}${row('Description', p.before.seo_description, p.applied_fields.seo_description)}</table>${undoFor(p)}`)).join('');
    const judgedHtml = judged.map((e) => card(`<p style="margin:0 0 6px"><a href="${ORIGIN}${esc(e.path)}">${esc(e.path)}</a></p>
<p style="margin:0;font-size:14px">${esc(verdictLine(e))}</p>${['kept', 'worse_not_undone'].includes(e.status) && e.pid ? undoFor(e) : ''}`)).join('');
    const skippedHtml = skipped.length ? `<p style="font-size:13px;color:#667085">Skipped because the model's wording failed a check: ${skipped.map((s) => `${esc(s.path)} (${esc(s.problems[0])})`).join('; ')}.</p>` : '';
    const html = `<div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;color:#101828">
<h2 style="margin:0 0 6px;font-size:21px">Search title tests this week</h2>
<p style="margin:0 0 14px;color:#667085;font-size:14px">Automatic tests on pages that show up in Google but get few clicks. Every new title passed the checks: the page's language, no number that is not on the page, the house wording rules, the PropertyList facts list and the retired-laws list. Nothing needs you; press Undo if a title reads wrong.</p>
${started.length ? `<h3 style="font-size:16px;margin:18px 0 8px">Changed this week</h3>${startedHtml}` : ''}${judged.length ? `<h3 style="font-size:16px;margin:18px 0 8px">Judged this week</h3>${judgedHtml}` : ''}${skippedHtml}
<p style="font-size:12px;color:#98a2b3">Undo links work for 30 days. A test is judged on the 28 days that start 3 days after the change, against the 28 days before, allowing for how the untouched pages moved.</p></div>`;
    const text = [...started.map((p) => `CHANGED ${ORIGIN}${p.path}\nWas: ${p.before.seo_title || p.before.title}\nNow: ${p.applied_fields.seo_title}${p.undo_ok ? `\nUndo: ${link(p.pid)}` : '\nNo Undo: the old wording fails the checks.'}`), ...judged.map((e) => `JUDGED ${ORIGIN}${e.path}\n${verdictLine(e)}${['kept', 'worse_not_undone'].includes(e.status) && e.undo_ok ? `\nUndo: ${link(e.pid)}` : ''}`)].join('\n\n');
    const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: KEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO, type: 'to' }], subject, html, text } }),
    });
    console.log('results email:', res.status, (await res.text()).slice(0, 100));
  }
}
