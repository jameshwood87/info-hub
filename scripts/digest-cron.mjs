#!/usr/bin/env node
/**
 * digest-cron.mjs - Sunday performance digest to Discord.
 * Top pages, movers (14d vs prior 14d), CTA clicks, AI-crawler hits,
 * indexation status, experiments, and 3 recommended actions.
 */
import fs from 'fs';
import { rawQuery } from './gsc.mjs';
import { ga4Summary, ga4PortalSummary } from '../src/lib/ga4Client.ts';

try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const WEBHOOK = (process.env.DISCORD_IDEAS_WEBHOOK || '').trim();
const ORIGIN = 'https://info.propertylist.es';
const norm = (u) => { let p = String(u || '').replace(ORIGIN, '').split('?')[0]; return p.endsWith('/') ? p : p + '/'; };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

const [curRows, prevRows, qRows] = await Promise.all([
  rawQuery(['page'], { days: 14, rowLimit: 2000 }),
  rawQuery(['page'], { days: 14, endOffsetDays: 14, rowLimit: 2000 }),
  rawQuery(['query', 'page'], { days: 14, rowLimit: 1000 }),
]);
const cur = new Map(curRows.map((r) => [norm(r.keys[0]), r]));
const prev = new Map(prevRows.map((r) => [norm(r.keys[0]), r]));

const top = [...cur.entries()].sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions).slice(0, 5);
const movers = [...cur.entries()]
  .map(([p, r]) => ({ p, d: r.impressions - (prev.get(p)?.impressions || 0), imp: r.impressions }))
  .filter((x) => Math.abs(x.d) >= 10)
  .sort((a, b) => b.d - a.d);
const up = movers.slice(0, 3);
const down = movers.slice(-2).filter((x) => x.d < 0);

// CTA + bots from event-stats (last 7 days)
const ev = readJson('/opt/info-hub/var/event-stats.json', { days: {} });
const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
let ctaTotal = 0; const ctaByKind = {}; const botByName = {};
for (const [d, byPath] of Object.entries(ev.days || {})) {
  if (d < cutoff) continue;
  for (const kinds of Object.values(byPath)) {
    for (const [k, n] of Object.entries(kinds)) {
      if (k.startsWith('cta:')) { ctaTotal += n; ctaByKind[k.slice(4)] = (ctaByKind[k.slice(4)] || 0) + n; }
      if (k.startsWith('bot:')) botByName[k.slice(4)] = (botByName[k.slice(4)] || 0) + n;
    }
  }
}
const idx = readJson('/opt/info-hub/var/admin/indexation-report.json', null);
const ledger = readJson('/opt/info-hub/var/admin/ctr-experiments.json', []);
const active = ledger.filter((e) => e.status === 'active').length;

// striking distance for actions
const striking = qRows
  .map((r) => ({ q: r.keys[0], page: norm(r.keys[1]), imp: r.impressions, pos: r.position }))
  .filter((r) => r.pos >= 8 && r.pos <= 30 && r.imp >= 5 && !/propertylist/i.test(r.q))
  .sort((a, b) => b.imp - a.imp);

const fmtPath = (p) => p.length > 55 ? p.slice(0, 52) + '…' : p;
const lines = [];
lines.push(`📊 **Weekly content digest** (${new Date().toLocaleDateString('en-GB')})`);
lines.push(`**Top pages (14d clicks):**`);
for (const [p, r] of top) lines.push(`· ${fmtPath(p)} - ${r.clicks} clicks / ${r.impressions} imp / pos ${r.position.toFixed(1)}`);
if (up.length) {
  lines.push(`**Movers up (impressions vs prior 14d):**`);
  for (const m of up) lines.push(`· ${fmtPath(m.p)} +${m.d}`);
}
if (down.length) {
  lines.push(`**Declining:** ${down.map((m) => `${fmtPath(m.p)} ${m.d}`).join(' · ')}`);
}
lines.push(`**CTA clicks (7d):** ${ctaTotal}${Object.keys(ctaByKind).length ? ' (' + Object.entries(ctaByKind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''}`);
const botsLine = Object.entries(botByName).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
if (botsLine) lines.push(`**AI crawlers (7d):** ${botsLine}`);
if (idx) lines.push(`**Google coverage:** ${idx.seen}/${idx.total} pages seen (${idx.unseenCount} not yet)`);
lines.push(`**CTR experiments:** ${active} running`);
const actions = [];
if (striking[0]) actions.push(`improve ${fmtPath(striking[0].page)} for "${striking[0].q}" (pos ${striking[0].pos.toFixed(1)}, ${striking[0].imp} imp)`);
if (striking[1]) actions.push(`target "${striking[1].q}" (pos ${striking[1].pos.toFixed(1)})`);
if (idx && idx.unseenCount > 10) actions.push(`${idx.unseenCount} pages still invisible to Google - internal links help`);
if (actions.length) lines.push(`**Suggested actions:** ${actions.map((a, i) => `${i + 1}) ${a}`).join(' ')}`);

const ga4 = await ga4Summary(7).catch(() => null);
if (ga4 && ga4.totalSessions) {
  const chan = ga4.channels.slice(0, 4).map((c) => `${c.channel} ${c.sessions}`).join(', ');
  lines.push(`**Traffic sources (7d, ${ga4.totalSessions} sessions):** ${chan}`);
  if (ga4.aiReferrals.length) lines.push(`**AI assistant referrals:** ${ga4.aiReferrals.map((a) => `${a.source} ${a.sessions}`).join(', ')}`);
}

const portal = await ga4PortalSummary(7).catch(() => null);
if (portal) {
  lines.push(`**Portal (propertylist.es, 7d):** ${portal.fromInfoHub.sessions} visits from the info hub, ${portal.conversions.formSubmit} leads/form-submits total`);
}

const content = lines.join('\n').slice(0, 1990);
console.log(content);
if (WEBHOOK && !process.argv.includes('--dry-run')) {
  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, username: 'PropertyList Analytics' }) });
  console.log('discord:', res.status);
}
