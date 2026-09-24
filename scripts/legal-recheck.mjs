#!/usr/bin/env node
/**
 * legal-recheck.mjs - monthly re-check of every Spanish law cited in published blog posts,
 * against the BOE open data (scripts/lib/legal-status.mjs). Emails James when a post cites
 * a law that is repealed, annulled, no longer in force or partly annulled without saying
 * so near the citation, or when a cited law's status changed since the last run.
 * Added 24-09-26: the rent-cap post stayed wrong from the repeal on 30-04-26 until a
 * manual fix in August, because nothing re-read old posts when a law changed.
 *
 * Cron: 1st of the month, 06:50 UTC.   Usage: node scripts/legal-recheck.mjs [--dry-run]
 */
import fs from 'node:fs';
import { legalStatus } from './lib/legal-status.mjs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const STATE_PATH = '/opt/info-hub/var/admin/legal-recheck.json';
const SITE = 'https://info.propertylist.es';
const PREFIXES = ['/blog/', '/es/blog/', '/general-information/', '/es/informacion-general/'];

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { laws: {} }; } };
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

const pages = [];
for (const prefix of PREFIXES) {
  const r = await fetch(`${DIRECTUS_URL}/items/kb_pages?filter[path][_starts_with]=${encodeURIComponent(prefix)}&filter[status][_eq]=published&fields=id,path,title,body&limit=-1`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) { console.error(`legal-recheck: Directus ${r.status} for ${prefix}`); continue; }
  pages.push(...((await r.json()).data || []));
}
console.log(`legal-recheck [${new Date().toISOString()}]: ${pages.length} published posts`);

const cache = new Map();
const firstRun = !readState().checked;
const issues = []; // { page, law }
const partlyVoid = []; // { page, law }: laws with annulled parts, listed on the first run only
const lawsNow = {}; // id -> { ref, statusText, partial }
const citedBy = {}; // id -> [paths]
for (const p of pages) {
  if (!/\b(Ley|Law|Decreto|Decree|RDL|RD|BOE-A-|boe\.es\/eli)/.test(String(p.body || ''))) continue;
  const results = await legalStatus(p.body, { cache });
  for (const l of results) {
    if (!l.id) continue;
    lawsNow[l.id] = { ref: l.ref.replace(/ \(one of \d+ laws with this number\)$/, ''), statusText: l.statusText, partial: (l.partial || []).length };
    (citedBy[l.id] = citedBy[l.id] || []).push(p.path);
    if (l.attention) issues.push({ page: p, law: l });
    else if (l.review && firstRun) partlyVoid.push({ page: p, law: l });
  }
}

const state = readState();
const changes = Object.entries(lawsNow)
  .filter(([id, now]) => state.laws[id] && (state.laws[id].statusText !== now.statusText || state.laws[id].partial !== now.partial))
  .map(([id, now]) => ({ id, ref: now.ref, before: state.laws[id].statusText, after: now.statusText, paths: [...new Set(citedBy[id] || [])] }));

console.log(`legal-recheck: ${Object.keys(lawsNow).length} laws cited, ${issues.length} post citations to read, ${changes.length} status changes since the last run${firstRun ? `, ${partlyVoid.length} citations of laws with annulled parts (first run)` : ''}`);
for (const i of issues) console.log(` - ${i.page.path}: ${i.law.ref}: ${i.law.statusText}`);
for (const c of changes) console.log(` - CHANGED ${c.ref}: ${c.before} -> ${c.after}`);
for (const i of partlyVoid) console.log(` - (parts annulled) ${i.page.path}: ${i.law.ref}`);

if (!DRY) fs.writeFileSync(STATE_PATH, JSON.stringify({ checked: new Date().toISOString(), laws: lawsNow }, null, 2));

if (DRY || (!issues.length && !changes.length && !partlyVoid.length)) process.exit(0);

const envText = fs.readFileSync('/opt/info-hub/.env', 'utf8');
const cfg = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const KEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es';
if (!KEY || !TO) { console.log('legal-recheck: email not sent (missing MANDRILL_API_KEY / NOTIFY_TO)'); process.exit(0); }

const byPage = new Map();
for (const i of issues) {
  if (!byPage.has(i.page.path)) byPage.set(i.page.path, { page: i.page, laws: [] });
  byPage.get(i.page.path).laws.push(i.law);
}
const html = `<div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;color:#101828">
<h2 style="margin:0 0 6px;font-size:21px">Monthly law re-check of the blog</h2>
<p style="margin:0 0 14px;color:#667085;font-size:14px">${pages.length} published posts read, ${Object.keys(lawsNow).length} laws checked on boe.es today.</p>
${changes.length ? `<h3 style="font-size:16px;margin:16px 0 6px">Laws whose status changed since last month</h3><ul style="padding-left:18px">${changes.map((c) => `<li style="margin:6px 0">${esc(c.ref)}: was "${esc(c.before)}", now "${esc(c.after)}". Cited by ${c.paths.map((p) => `<a href="${SITE}${esc(p)}">${esc(p)}</a>`).join(', ')}</li>`).join('')}</ul>` : ''}
${partlyVoid.length ? `<h3 style="font-size:16px;margin:16px 0 6px">First run only: posts citing laws with annulled or repealed parts</h3><p style="margin:0 0 6px;font-size:14px;color:#667085">The laws stand, but check these posts do not rely on the struck-down parts. From next month only changes are reported.</p><ul style="padding-left:18px">${partlyVoid.map((i) => `<li style="margin:6px 0"><a href="${SITE}${esc(i.page.path)}">${esc(i.page.title || i.page.path)}</a>: ${esc(i.law.ref)}${i.law.partial && i.law.partial.length ? `<br><span style="font-size:13px;color:#667085">${esc(i.law.partial[0])}</span>` : ''}</li>`).join('')}</ul>` : ''}
${byPage.size ? `<h3 style="font-size:16px;margin:16px 0 6px">Posts that cite a law that is no longer in force, without saying so</h3><ul style="padding-left:18px">${[...byPage.values()].map(({ page, laws }) => `<li style="margin:8px 0"><a href="${SITE}${esc(page.path)}">${esc(page.title || page.path)}</a> (kb ${esc(page.id)})<ul style="padding-left:16px">${laws.map((l) => `<li>${esc(l.ref)}: ${esc(l.statusText)} (<a href="${esc(l.url)}">${esc(l.id)}</a>)${l.partial && l.partial.length ? `<br><span style="font-size:13px;color:#667085">${esc(l.partial[0])}</span>` : ''}</li>`).join('')}</ul></li>`).join('')}</ul>` : ''}
<p style="font-size:12px;color:#98a2b3;margin-top:18px">A citation counts as handled when the post says repealed, annulled, no longer in force or similar within a few sentences of it. Nothing on the site was changed. Script: scripts/legal-recheck.mjs on the info-hub droplet.</p></div>`;
const text = `Monthly law re-check: ${byPage.size} posts to read, ${changes.length} status changes.\n\n`
  + changes.map((c) => `CHANGED ${c.ref}: ${c.before} -> ${c.after}`).join('\n')
  + (changes.length ? '\n\n' : '')
  + [...byPage.values()].map(({ page, laws }) => `${SITE}${page.path}\n` + laws.map((l) => `  - ${l.ref}: ${l.statusText}`).join('\n')).join('\n\n');
const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: KEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO, type: 'to' }], subject: `[Law re-check] ${byPage.size} blog post${byPage.size === 1 ? '' : 's'} to read, ${changes.length} law${changes.length === 1 ? '' : 's'} changed${partlyVoid.length ? `, ${partlyVoid.length} partly annulled (first run)` : ''}`, html, text } }),
});
console.log('legal-recheck email:', res.status, (await res.text()).slice(0, 100));
