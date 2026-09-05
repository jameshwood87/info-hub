// Who actually reads the Website Builder page, in their own browser's language
// and from which country, straight from Umami (cookieless, so it sees everyone
// rather than only the consenting third). Ninety days.
import fs from 'node:fs';

const DIR = '/opt/info-hub';
for (const line of fs.readFileSync(`${DIR}/.env`, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = (process.env.UMAMI_API_URL || '').replace(/\/$/, '');
const ID = process.env.UMAMI_WEBSITE_ID;
const PASS = process.env.UMAMI_ADMIN_PASS;

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: PASS }),
});
if (!login.ok) { console.error('login failed', login.status, (await login.text()).slice(0, 200)); process.exit(1); }
const { token } = await login.json();
const H = { authorization: `Bearer ${token}` };

const endAt = Date.parse('2026-09-05T23:59:59Z');
const startAt = endAt - 90 * 86400000;

const metric = async (type, url) => {
  const q = new URLSearchParams({ startAt: String(startAt), endAt: String(endAt), type });
  if (url) q.set('url', url);
  const r = await fetch(`${BASE}/api/websites/${ID}/metrics?${q}`, { headers: H });
  if (!r.ok) return [];
  return r.json();
};
const show = (rows, label, n = 12) => {
  const total = rows.reduce((a, r) => a + r.y, 0) || 1;
  console.log(`\n--- ${label} (total ${total})`);
  rows.slice(0, n).forEach((r) => console.log(`  ${String(r.x || '?').padEnd(22)} ${String(r.y).padStart(6)}  ${((r.y / total) * 100).toFixed(1)}%`));
};

for (const page of ['/website-builder/', '/es/constructor-de-webs/', null]) {
  const label = page || 'WHOLE SITE';
  const langs = await metric('language', page);
  const countries = await metric('country', page);
  console.log(`\n================ ${label}`);
  show(langs, 'browser language');
  show(countries, 'country', 10);
}
