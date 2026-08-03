#!/usr/bin/env node
/**
 * feature-digest.mjs - weekly digest of the public feature board.
 * Votes are silent by design (one click, no contact details), so this is the only
 * place vote activity surfaces. Reports new suggestions, anything still waiting on
 * moderation, vote movement since the last run, and the current top ideas.
 * Sends nothing when there is no activity and nothing pending, so a quiet week
 * does not train you to ignore it.
 * State: var/admin/feature-digest-state.json.  Usage: node scripts/feature-digest.mjs [--dry-run]
 */
import fs from 'fs';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const DRY = process.argv.includes('--dry-run');
const STORE = '/opt/info-hub/var/admin/feature-requests.json';
const STATE = '/opt/info-hub/var/admin/feature-digest-state.json';
const SITE = (process.env.PUBLIC_SITE_URL || 'https://info.propertylist.es').replace(/\/+$/, '');
const KEY = (process.env.MANDRILL_API_KEY || '').trim();
const TO = (process.env.NOTIFY_TO || '').trim();
const FROM = (process.env.NOTIFY_FROM || '').trim();
const FROM_NAME = (process.env.NOTIFY_FROM_NAME || 'PropertyList').trim();

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };

const raw = readJson(STORE, []);
const ideas = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
if (!ideas.length) { console.log(new Date().toISOString(), 'no board data, nothing to do'); process.exit(0); }

const state = readJson(STATE, null);
const firstRun = !state;
const prevVotes = state?.votes || {};
const since = state?.lastRunAt ? new Date(state.lastRunAt) : null;

const PUBLIC_STATUSES = new Set(['under-review', 'planned', 'building', 'improving', 'live']);

const newIdeas = ideas.filter((i) => since && i.at && new Date(i.at) > since);
const pending = ideas.filter((i) => i.status === 'pending');
const moved = ideas
  .map((i) => ({ ...i, delta: Math.max(0, Number(i.votes || 0) - Number(prevVotes[i.id] ?? (firstRun ? i.votes : 0))) }))
  .filter((i) => i.delta > 0)
  .sort((a, b) => b.delta - a.delta);
const totalNewVotes = moved.reduce((n, i) => n + i.delta, 0);
const top = ideas.filter((i) => PUBLIC_STATUSES.has(i.status)).sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)).slice(0, 5);

const quiet = !newIdeas.length && !pending.length && !totalNewVotes;
console.log(new Date().toISOString(),
  `first_run=${firstRun} new_ideas=${newIdeas.length} pending=${pending.length} new_votes=${totalNewVotes}`);

// A first run has no baseline to compare against, so record one and stay quiet
// rather than reporting every historic vote as if it arrived this week.
if (firstRun || quiet) {
  const next = { lastRunAt: new Date().toISOString(), votes: Object.fromEntries(ideas.map((i) => [i.id, Number(i.votes || 0)])) };
  if (!DRY) fs.writeFileSync(STATE, JSON.stringify(next, null, 2));
  console.log(firstRun ? 'baseline recorded, no email on the first run' : 'quiet week, no email sent');
  process.exit(0);
}

const li = (rows) => rows.join('');
const html =
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px">` +
  `<p style="font-size:16px;margin:0 0 4px"><strong>Feature board, past week</strong></p>` +
  `<p style="font-size:13px;color:#667085;margin:0 0 18px">${esc(totalNewVotes)} new vote${totalNewVotes === 1 ? '' : 's'}, ` +
  `${esc(newIdeas.length)} new suggestion${newIdeas.length === 1 ? '' : 's'}, ${esc(pending.length)} awaiting moderation</p>` +
  (pending.length
    ? `<p style="font-size:14px;margin:0 0 6px"><strong>Waiting on you</strong></p><ul style="font-size:14px;margin:0 0 18px;padding-left:18px">` +
      li(pending.map((i) => `<li>${esc(i.title)} <span style="color:#667085">(${esc(i.lang)}, ${esc(String(i.at).slice(0, 10))})</span></li>`)) +
      `</ul>`
    : '') +
  (moved.length
    ? `<p style="font-size:14px;margin:0 0 6px"><strong>Vote movement</strong></p><ul style="font-size:14px;margin:0 0 18px;padding-left:18px">` +
      li(moved.map((i) => `<li>+${esc(i.delta)} &rarr; ${esc(i.title)} <span style="color:#667085">(${esc(i.votes)} total, ${esc(i.status)})</span></li>`)) +
      `</ul>`
    : '') +
  (top.length
    ? `<p style="font-size:14px;margin:0 0 6px"><strong>Most wanted</strong></p><ol style="font-size:14px;margin:0 0 18px;padding-left:18px">` +
      li(top.map((i) => `<li>${esc(i.title)} <span style="color:#667085">(${esc(i.votes)} votes, ${esc(i.status)})</span></li>`)) +
      `</ol>`
    : '') +
  `<p style="margin:0"><a href="${esc(SITE)}/admin/feature-requests" style="background:#00ae9a;color:#fff;padding:10px 18px;` +
  `border-radius:8px;text-decoration:none;font-size:14px">Open the board</a></p></div>`;

const text =
  `Feature board, past week\n\n` +
  `${totalNewVotes} new votes, ${newIdeas.length} new suggestions, ${pending.length} awaiting moderation\n\n` +
  (pending.length ? `Waiting on you:\n${pending.map((i) => `  - ${i.title} (${i.lang}, ${String(i.at).slice(0, 10)})`).join('\n')}\n\n` : '') +
  (moved.length ? `Vote movement:\n${moved.map((i) => `  +${i.delta} -> ${i.title} (${i.votes} total, ${i.status})`).join('\n')}\n\n` : '') +
  (top.length ? `Most wanted:\n${top.map((i, n) => `  ${n + 1}. ${i.title} (${i.votes} votes, ${i.status})`).join('\n')}\n\n` : '') +
  `${SITE}/admin/feature-requests\n`;

if (DRY) {
  console.log('--- dry run, not sending ---\n' + text);
  process.exit(0);
}
if (!KEY || !TO || !FROM) { console.log('mail not configured, skipping send'); process.exit(0); }

const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    key: KEY,
    message: {
      from_email: FROM,
      from_name: FROM_NAME,
      to: TO.split(',').map((a) => a.trim()).filter(Boolean).map((email) => ({ email, type: 'to' })),
      subject: `[PropertyList] Feature board: ${totalNewVotes} new votes, ${pending.length} to review`,
      html,
      text,
      tags: ['info-hub', 'feature-digest'],
      track_opens: false,
      track_clicks: false,
    },
  }),
}).catch((e) => ({ ok: false, status: String(e) }));
console.log('mandrill:', res.status);

fs.writeFileSync(STATE, JSON.stringify(
  { lastRunAt: new Date().toISOString(), votes: Object.fromEntries(ideas.map((i) => [i.id, Number(i.votes || 0)])) }, null, 2));
