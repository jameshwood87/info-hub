/**
 * gsc.mjs - minimal Google Search Console client (no deps, JWT RS256 via node:crypto).
 * Used by ideas-cron.mjs for striking-distance keyword research.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const KEY_PATH = '/opt/info-hub/var/admin/gsc-key.json';
const SITE = 'https://info.propertylist.es/';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: key.token_uri, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${sig}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('gsc token failed');
  return j.access_token;
}

/** Returns { striking: [...], top: [...] } or null if the key/API is unavailable. */
export async function gscResearch(days = 28) {
  try {
    const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    const tok = await accessToken(key);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: fmt(new Date(Date.now() - days * 86400000)), endDate: fmt(new Date()), dimensions: ['query', 'page'], rowLimit: 1000 }),
    });
    const rows = (await res.json()).rows || [];
    const mapped = rows.map((r) => ({ query: r.keys[0], page: String(r.keys[1] || ''), impressions: r.impressions, clicks: r.clicks, position: r.position }));
    const striking = mapped
      .filter((r) => r.position >= 8 && r.position <= 30 && r.impressions >= 3 && !/propertylist/i.test(r.query))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);
    const top = mapped
      .filter((r) => !/propertylist/i.test(r.query))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 12);
    return { striking, top };
  } catch (e) {
    console.log('gsc research skipped:', e.message);
    return null;
  }
}

/** Raw Search Analytics query. opts: {days, endOffsetDays, rowLimit, pageContains} */
export async function rawQuery(dimensions, opts = {}) {
  const { days = 28, endOffsetDays = 0, rowLimit = 1000, pageContains = '' } = opts;
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const tok = await accessToken(key);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - endOffsetDays * 86400000);
  const start = new Date(end.getTime() - days * 86400000);
  const body = { startDate: fmt(start), endDate: fmt(end), dimensions, rowLimit };
  if (pageContains) body.dimensionFilterGroups = [{ filters: [{ dimension: 'page', operator: 'contains', expression: pageContains }] }];
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return (await res.json()).rows || [];
}
