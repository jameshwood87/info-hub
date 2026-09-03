#!/usr/bin/env node
/**
 * blog-cron.mjs - scheduled wrapper around generate-blog-post.mjs.
 * Deterministic, non-repeating topics tracked in a state file; generates
 * + PUBLISHES (EN + ES), then pings IndexNow for the fresh URLs.
 *
 * Topic scheme:
 *  - Fri: next unused evergreen guide from GUIDES (state-tracked).
 *  - Other days (cron runs Tue): month-stamped area market post rotating
 *    through AREAS; each area at most once per calendar month (state-tracked).
 * Usage: node scripts/blog-cron.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const STATE_PATH = '/opt/info-hub/var/admin/blog-cron-state.json';

const AREAS = ['Marbella', 'Estepona', 'Benahavis', 'Mijas', 'Fuengirola', 'Benalmadena', 'Nueva Andalucia', 'Puerto Banus', 'Casares', 'Manilva', 'Calahonda', 'Torremolinos'];
const GUIDES = [
  { key: 'non-resident-buying', topic: 'Buying property in Spain as a non-resident: the complete process, costs and timeline' },
  { key: 'mortgages-non-residents', topic: 'Getting a Spanish mortgage as a non-resident: rates, deposits and the approval process' },
  { key: 'nie-bank', topic: 'NIE numbers and Spanish bank accounts: a step-by-step guide for property buyers' },
  { key: 'selling-costs', topic: 'What it really costs to sell a property in Spain: agency fees, plusvalia and capital gains tax' },
  { key: 'valuation-oracle', topic: 'How property valuation works in Spain and why notary-verified prices matter' },
  { key: 'marbella-micro-areas', topic: 'Golden Mile vs Puerto Banus vs Nueva Andalucia: where to buy in Marbella' },
  { key: 'off-plan', topic: 'Buying off-plan new developments in Spain: protections, payments and pitfalls' },
  { key: 'community-fees', topic: 'Community fees and comunidad rules in Spain: what owners actually pay for' },
  { key: 'inheritance-basics', topic: 'Inheriting property in Spain: taxes, deadlines and the process for foreign families' },
];

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { usedGuides: [], areaMonths: [] }; }
};
const writeState = (st) => fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));

const now = new Date();
const monthName = now.toLocaleString('en-GB', { month: 'long' });
const year = now.getFullYear();
const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const isoWeek = Math.ceil(((now - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
const dow = now.getUTCDay(); // 5 = Fri

const state = readState();

// ---- topic sources -------------------------------------------------------
// A topic that fails generation used to sit at the head of the ideas queue and
// take down every scheduled run with it: 21-08, 25-08, 28-08 and 01-09-26 all
// died on the same article. Failures are now counted on the queue item, the
// item is parked after MAX_FAILURES, and the run moves on to the next topic
// instead of ending.
const QUEUE_PATH = '/opt/info-hub/var/admin/blog-topics-queue.json';
const PARKED_PATH = '/opt/info-hub/var/admin/blog-topics-parked.json';
const MAX_FAILURES = 2; // failed attempts, across runs, before a topic is parked
const MAX_ATTEMPTS = 3; // generations tried in a single run

const readJsonArray = (p) => { try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } };
const writeJson = (p, v) => { try { fs.writeFileSync(p, JSON.stringify(v, null, 2)); } catch (e) { console.error(`blog-cron: could not write ${p}:`, e.message); } };
const parkTopic = (item, why) => {
  const parked = readJsonArray(PARKED_PATH);
  parked.push({ ...item, parked_at: new Date().toISOString(), error: String(why || '').slice(0, 600) });
  writeJson(PARKED_PATH, parked);
};

const attempted = new Set();

// Queue items are matched by topic text, never by index: ideas-cron can append
// to the queue while this run is in flight.
function nextCandidate() {
  const item = readJsonArray(QUEUE_PATH).find((q) => q && q.topic && !attempted.has(String(q.topic)));
  if (item) {
    const topic = String(item.topic);
    return {
      topic,
      label: 'ideas queue',
      commit: () => {
        const q = readJsonArray(QUEUE_PATH);
        const i = q.findIndex((x) => x && String(x.topic) === topic);
        if (i >= 0) q.splice(i, 1);
        writeJson(QUEUE_PATH, q);
      },
      fail: (reason) => {
        const q = readJsonArray(QUEUE_PATH);
        const i = q.findIndex((x) => x && String(x.topic) === topic);
        const entry = i >= 0 ? q[i] : { ...item };
        entry.failures = (Number(entry.failures) || 0) + 1;
        entry.last_error = String(reason || '').slice(0, 300);
        entry.last_failed = new Date().toISOString();
        if (entry.failures >= MAX_FAILURES) {
          if (i >= 0) q.splice(i, 1);
          writeJson(QUEUE_PATH, q);
          parkTopic(entry, entry.last_error);
          console.error(`blog-cron: PARKED after ${entry.failures} failed attempts -> ${PARKED_PATH}`);
          return 'parked';
        }
        if (i >= 0) q[i] = entry;
        writeJson(QUEUE_PATH, q);
        console.error(`blog-cron: failure ${entry.failures} of ${MAX_FAILURES}, topic kept in the queue for one more run.`);
        return 'kept in queue';
      },
    };
  }
  if (dow === 5) {
    const g = GUIDES.find((x) => !state.usedGuides.includes(x.key) && !attempted.has(x.topic));
    if (g) return { topic: g.topic, label: 'evergreen guide', commit: () => { state.usedGuides.push(g.key); writeState(state); }, fail: () => 'skipped for this run' };
  }
  for (let i = 0; i < AREAS.length; i++) {
    const a = AREAS[(isoWeek + i) % AREAS.length];
    const areaMonth = `${a.toLowerCase().replace(/\s+/g, '-')}:${monthKey}`;
    const t = `${a} property market ${monthName} ${year}: live prices, listings and notary-verified values`;
    if (state.areaMonths.includes(areaMonth) || attempted.has(t)) continue;
    return { topic: t, label: 'area market post', commit: () => { state.areaMonths.push(areaMonth); writeState(state); }, fail: () => 'skipped for this run' };
  }
  return null;
}

const firstCandidate = nextCandidate();
if (!firstCandidate) { console.log('blog-cron: all topics covered for now - exiting.'); process.exit(0); }
console.log(`blog-cron [${new Date().toISOString()}] topic:`, firstCandidate.topic);
if (DRY) process.exit(0);

const before = await (async () => {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=/blog/&fields=path&limit=-1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return ((await r.json()).data || []).map((x) => String(x.path || ''));
})();

// Generate as DRAFT. Nothing goes live from this script any more: every post
// is linted, then emailed to James with one-click approve / reject links.
// (11-08-26, after the blog audit found unfilled placeholders and a repealed
// decree presented as current law on live pages.)
const genPath = new URL('./generate-blog-post.mjs', import.meta.url).pathname;
const failures = [];
let topic = null;

while (attempted.size < MAX_ATTEMPTS) {
  const cand = nextCandidate();
  if (!cand) break;
  attempted.add(cand.topic);
  console.log(`blog-cron: generating (${cand.label}): ${cand.topic}`);
  try {
    execFileSync('node', [genPath, cand.topic], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    cand.commit();
    topic = cand.topic;
    console.log(`blog-cron: generated OK: ${cand.topic}`);
    break;
  } catch (genErr) {
    const stderr = String(genErr.stderr || '').trim();
    if (stderr) console.error(stderr);
    // The generator prints its own one-line diagnosis; prefer that over the
    // last line, which can be a fragment of the model response.
    const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
    const reason = (lines.find((l) => /^generate-blog-post:/.test(l))
      || [...lines].reverse().find((l) => /error|failed|exception/i.test(l))
      || lines[0]
      || String(genErr && genErr.message || genErr)).slice(0, 300);
    console.error(`blog-cron: generation FAILED: ${cand.topic}`);
    const outcome = cand.fail(reason);
    failures.push({ topic: cand.topic, outcome, reason });
  }
}

// A silent crash here cost two runs (22-08 and 25-08) before anyone noticed,
// then four more before anyone looked. The pipeline's promise is that nothing
// needs watching, so a failure still announces itself by email - once per run,
// listing every topic that failed and what happened to it.
if (failures.length) {
  try {
    const envText = fs.readFileSync('/opt/info-hub/.env', 'utf8');
    const cfg = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^[\"']|[\"']$/g, '');
    const listed = failures.map((f) => `- ${f.topic}\n  outcome: ${f.outcome}\n  error: ${f.reason}`).join('\n\n');
    await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cfg('MANDRILL_API_KEY'), message: {
        from_email: cfg('NOTIFY_FROM') || 'noreply@propertylist.es',
        from_name: 'PropertyList Blog Cron',
        to: [{ email: cfg('NOTIFY_TO') }],
        subject: topic ? 'Blog cron: a topic failed, the run recovered' : 'Blog cron FAILED - no draft was completed',
        text: (topic
          ? 'The run moved on and generated a draft for: ' + topic + '\nAn approval email follows separately.\n\n'
          : 'No draft was created, so no approval email will follow.\n\n')
          + 'Failed topics:\n\n' + listed
          + '\n\nParked topics: /opt/info-hub/var/admin/blog-topics-parked.json'
          + '\nLog: /opt/info-hub/var/log/blog-cron.log on the info-hub droplet.',
      } }),
    });
  } catch (mailErr) {
    console.error('failure alert email also failed:', mailErr && mailErr.message);
  }
}

if (!topic) {
  console.error(`blog-cron: no draft generated this run (${failures.length} topic(s) failed).`);
  process.exit(1);
}

const { lintBlogPost } = await import('./lib/blog-lint.mjs');
const { createHmac } = await import('node:crypto');

const hdr = { Authorization: `Bearer ${TOKEN}` };
const listDrafts = async (prefix) => {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=${encodeURIComponent(prefix)}&filter[status][_eq]=draft&fields=id,path,title,body,language,date_created&sort=-date_created&limit=4`, { headers: hdr });
  return ((await r.json()).data || []);
};
const fresh = (await listDrafts('/blog/')).filter((p) => !before.includes(p.path));
if (!fresh.length) { console.log('blog-cron: no new draft found after generation - nothing to review.'); process.exit(0); }
const en = fresh[0];
const esList = await listDrafts('/es/blog/');
const es = esList.find((p) => p.path === `/es${en.path}`) || null;

const lint = lintBlogPost({ title: en.title, body: en.body, bodyEs: es ? es.body : '' });
console.log('lint:', JSON.stringify({ ok: lint.ok, regulatory: lint.regulatory, errors: lint.errors.length, warnings: lint.warnings.length }));

// ---- approval email ----
const envText = fs.readFileSync('/opt/info-hub/.env', 'utf8');
const cfg = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const KEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es', SECRET = cfg('BLOG_APPROVE_SECRET');
const SITE = 'https://info.propertylist.es';
const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
const sign = (action) => createHmac('sha256', SECRET).update(`${en.id}|${es ? es.id : ''}|${exp}|${action}`).digest('hex');
const link = (action) => `${SITE}/api/blog/approve?id=${encodeURIComponent(en.id)}&es=${encodeURIComponent(es ? es.id : '')}&exp=${exp}&action=${action}&sig=${sign(action)}`;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const plain = String(en.body || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const li = (arr, color) => arr.map((x) => `<li style="color:${color};margin:4px 0">${esc(x)}</li>`).join('');
const badge = lint.regulatory ? '<span style="background:#fef3c7;color:#92400e;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:800">REGULATORY, check the law is current</span>' : '<span style="background:#ecfdf5;color:#065f46;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:800">market / guide</span>';
const btn = (href, label, bg) => `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px;margin:6px 8px 6px 0">${label}</a>`;

const html = `<div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;color:#101828">
<p style="font-size:13px;color:#667085;margin:0 0 6px">Info hub blog draft for review ${badge}</p>
<h2 style="margin:0 0 6px;font-size:22px;line-height:1.3">${esc(en.title)}</h2>
<p style="margin:0 0 14px;color:#667085;font-size:14px">${esc(en.path)} ${es ? ' + Spanish twin' : ' (no Spanish twin found)'} · ${plain.split(' ').length} words</p>
${lint.errors.length ? `<div style="border:2px solid #b42318;background:#fef3f2;border-radius:10px;padding:12px 14px;margin:0 0 14px"><b style="color:#b42318">BLOCKED, cannot be approved until fixed:</b><ul style="margin:6px 0 0;padding-left:18px">${li(lint.errors, '#b42318')}</ul></div>` : ''}
${lint.warnings.length ? `<div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:12px 14px;margin:0 0 14px"><b style="color:#92400e">Read these before approving:</b><ul style="margin:6px 0 0;padding-left:18px">${li(lint.warnings, '#78350f')}</ul></div>` : '<p style="color:#065f46;font-size:14px">Lint: no warnings.</p>'}
<div style="border:1px solid #e4e7ec;border-radius:10px;padding:14px 16px;margin:0 0 16px;font-size:14px;line-height:1.6;color:#344054;max-height:none">${esc(plain.slice(0, 1800))}${plain.length > 1800 ? ' [...]' : ''}</div>
<p style="margin:0 0 6px;font-size:13px;color:#667085">Read the full draft (admin login): <a href="${SITE}/admin/blog">${SITE}/admin/blog</a></p>
<p style="margin:14px 0">${lint.ok ? btn(link('approve'), 'Approve and publish', '#00ae9a') : ''}${btn(link('reject'), 'Reject (archive)', '#b42318')}</p>
<p style="font-size:12px;color:#98a2b3">Links expire in 7 days and are single-purpose. Nothing is published unless you click approve. Reply to this email with corrections and it stays a draft.</p></div>`;

const text = `Blog draft for review${lint.regulatory ? ' [REGULATORY]' : ''}: ${en.title}\n${SITE}${en.path}\n\n` +
  (lint.errors.length ? 'BLOCKED:\n' + lint.errors.map((e) => ' - ' + e).join('\n') + '\n\n' : '') +
  (lint.warnings.length ? 'Warnings:\n' + lint.warnings.map((w) => ' - ' + w).join('\n') + '\n\n' : '') +
  (lint.ok ? `Approve: ${link('approve')}\n` : '') + `Reject: ${link('reject')}\n`;

if (!KEY || !TO || !SECRET) {
  console.log('blog-cron: approval email NOT sent (missing MANDRILL_API_KEY / NOTIFY_TO / BLOG_APPROVE_SECRET). Draft left in Directus:', en.path);
  process.exit(0);
}
try {
  const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: KEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO, type: 'to' }],
      subject: `${lint.ok ? (lint.regulatory ? '[REVIEW, regulatory]' : '[REVIEW]') : '[BLOCKED]'} blog draft: ${en.title}`.slice(0, 180), html, text } }),
  });
  console.log('approval email:', res.status, (await res.text()).slice(0, 100));
} catch (e) { console.log('approval email failed:', e.message, '- draft left in Directus:', en.path); }
