#!/usr/bin/env node
// Social Studio GA4 sync - pulls portal GA4 sessions + key events (leads) per utm_content
// for the social-studio campaign and pushes them into the hub scoreboard, so the A/B
// system learns on conversions instead of manually-typed vanity metrics.
// Cron: Monday 06:20 (fresh numbers before the weekly batch is written).
// Auth: reuses the GSC/GA4 service-account key; hub token read from /opt/info-hub/.env
// (SOCIAL_HUB_TOKEN=...) because system cron does not load .env.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const KEY_PATH = '/opt/info-hub/var/admin/gsc-key.json';
const PORTAL_PROPERTY = 'properties/523827015';
const ENV_PATH = '/opt/info-hub/.env';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function envVal(name) {
  const txt = await fs.readFile(ENV_PATH, 'utf8');
  const m = txt.match(new RegExp(`^${name}="?([^"\\n]*)"?`, 'm'));
  return m ? m[1].trim() : '';
}

async function accessToken() {
  const key = JSON.parse(await fs.readFile(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: key.token_uri, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${sig}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('ga4 token failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function main() {
  const hubToken = await envVal('SOCIAL_HUB_TOKEN');
  const hubUrl = ((await envVal('SOCIAL_HUB_URL')) || 'https://hub.your-domain.es').replace(/\/$/, '');
  if (!hubToken) throw new Error('SOCIAL_HUB_TOKEN missing in ' + ENV_PATH);

  const tok = await accessToken();
  const RANGE = [{ startDate: '35daysAgo', endDate: 'today' }];
  const campaignFilter = { filter: { fieldName: 'sessionCampaignName', stringFilter: { value: 'social-studio' } } };

  async function runReport(body) {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${PORTAL_PROPERTY}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const jr = await r.json();
    if (jr.error) throw new Error('ga4 report failed: ' + JSON.stringify(jr.error).slice(0, 300));
    return jr;
  }

  // Clicks = sessions per utm_content.
  const jSessions = await runReport({
    dateRanges: RANGE,
    dimensions: [{ name: 'sessionManualAdContent' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: campaignFilter,
    limit: 200,
  });

  // Leads = real lead events only.
  // Do NOT use the keyEvents metric here: the three key events configured on this
  // property are GA4 setup stubs that have never once fired, so keyEvents is always 0.
  // form_submit is deliberately excluded too - it is enhanced-measurement noise that
  // counts logins and intermediate signup-step forms as if they were leads.
  // This returns 0 until the portal fires generate_lead on enquiry/signup. That zero
  // is honest; a form_submit-based number would not be.
  const jLeads = await runReport({
    dateRanges: RANGE,
    dimensions: [{ name: 'sessionManualAdContent' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { andGroup: { expressions: [
      campaignFilter,
      { filter: { fieldName: 'eventName', inListFilter: { values: ['generate_lead', 'enquiry'] } } },
    ] } },
    limit: 200,
  });

  const leadMap = new Map((jLeads.rows || []).map(r => [
    r.dimensionValues?.[0]?.value || '', Number(r.metricValues?.[0]?.value || 0),
  ]));

  const items = (jSessions.rows || [])
    .map(r => {
      const utm = r.dimensionValues?.[0]?.value || '';
      return { utm_content: utm, clicks: Number(r.metricValues?.[0]?.value || 0), leads: leadMap.get(utm) ?? 0 };
    })
    .filter(it => it.utm_content && it.utm_content !== '(not set)');
  console.log(new Date().toISOString(), 'ga4 utm_content rows:', items.length, JSON.stringify(items));
  if (!items.length) { console.log('nothing to sync yet'); return; }

  if (process.argv.includes("--print-items")) { console.log("ITEMS:" + JSON.stringify(items)); return; }
  const hr = await fetch(`${hubUrl}/api/ads/metrics-by-utm`, {
    method: 'POST', headers: { 'x-hub-token': hubToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  });
  const hj = await hr.json().catch(() => ({}));
  console.log('hub response:', hr.status, JSON.stringify(hj));
  if (!hr.ok) process.exitCode = 1;
}

main().catch(e => { console.error('sync failed:', e.message || e); process.exit(1); });
