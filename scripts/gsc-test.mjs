#!/usr/bin/env node
/**
 * gsc-test.mjs - verify Search Console API access with the service-account key.
 * Lists accessible properties, then pulls a sample of striking-distance queries.
 * No dependencies: JWT RS256 via node:crypto.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const KEY_PATH = '/opt/info-hub/var/admin/gsc-key.json';
const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${sig}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token failed: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

const tok = await accessToken();
console.log('token: OK (service account authenticated)');

// list properties this account can see
const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${tok}` } });
const sites = (await sitesRes.json()).siteEntry || [];
console.log('accessible properties:', sites.length ? '' : 'NONE - grant the service-account email in Search Console');
for (const s of sites) console.log(`  ${s.siteUrl} (${s.permissionLevel})`);

// try a sample query on the most likely property
const candidates = sites.map((s) => s.siteUrl);
for (const site of candidates) {
  const end = new Date(); const start = new Date(Date.now() - 28 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: ['query', 'page'], rowLimit: 10 }),
  });
  const j = await res.json();
  const rows = j.rows || [];
  console.log(`\n${site}: ${rows.length} sample rows (28d)`);
  for (const r of rows.slice(0, 8)) {
    console.log(`  "${r.keys[0]}" -> ${String(r.keys[1]).replace('https://', '').slice(0, 55)} | imp=${r.impressions} clicks=${r.clicks} pos=${r.position.toFixed(1)}`);
  }
}
