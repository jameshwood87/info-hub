import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// GA4 Data API client (no deps). Reuses the GSC service-account key.
// Two properties: info hub (info.propertylist.es) and the main portal (propertylist.es).

const KEY_PATH = '/opt/info-hub/var/admin/gsc-key.json';
const INFO_PROPERTY = 'properties/453818491';
const PORTAL_PROPERTY = 'properties/523827015';

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
	if (tokenCache && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
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
	const j: any = await res.json();
	if (!j.access_token) throw new Error('ga4 token failed');
	tokenCache = { token: j.access_token, exp: Date.now() + 3600000 };
	return j.access_token;
}

const cache = new Map<string, { at: number; data: any }>();
const CACHE_MS = 60 * 60 * 1000;

async function runReport(property: string, body: any, ck: string): Promise<any[]> {
	const hit = cache.get(ck);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
	const tok = await accessToken();
	const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const j: any = await res.json();
	const rows = j.rows || [];
	cache.set(ck, { at: Date.now(), data: rows });
	return rows;
}

const AI_SOURCE = /chatgpt|openai|perplexity|claude|anthropic|gemini|copilot|bing chat|you\.com/i;

export type Ga4Summary = {
	channels: Array<{ channel: string; sessions: number; avgSeconds: number }>;
	countries: Array<{ country: string; sessions: number }>;
	devices: Array<{ device: string; sessions: number }>;
	aiReferrals: Array<{ source: string; sessions: number }>;
	totalSessions: number;
};

/** info.propertylist.es traffic summary (this site). Null if unavailable. */
export async function ga4Summary(days = 28): Promise<Ga4Summary | null> {
	try {
		const range = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
		const [chan, ctry, dev, src] = await Promise.all([
			runReport(INFO_PROPERTY, { dateRanges: range, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'averageSessionDuration' }], limit: 15 }, `i:chan:${days}`),
			runReport(INFO_PROPERTY, { dateRanges: range, dimensions: [{ name: 'country' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }, `i:ctry:${days}`),
			runReport(INFO_PROPERTY, { dateRanges: range, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }], limit: 5 }, `i:dev:${days}`),
			runReport(INFO_PROPERTY, { dateRanges: range, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 40 }, `i:src:${days}`),
		]);
		const channels = chan.map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), avgSeconds: Math.round(Number(r.metricValues[1].value)) }));
		return {
			channels,
			countries: ctry.map((r: any) => ({ country: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
			devices: dev.map((r: any) => ({ device: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
			aiReferrals: src.map((r: any) => ({ source: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })).filter((r: { source: string }) => AI_SOURCE.test(r.source)),
			totalSessions: channels.reduce((a: number, c: { sessions: number }) => a + c.sessions, 0),
		};
	} catch {
		return null;
	}
}

export type Ga4Portal = {
	totalSessions: number;
	channels: Array<{ channel: string; sessions: number; avgSeconds: number }>;
	fromInfoHub: { sessions: number; avgSeconds: number; engagedSessions: number };
	conversions: { formStart: number; formSubmit: number };
	aiReferrals: Array<{ source: string; sessions: number }>;
};

/** propertylist.es MAIN PORTAL summary - kept SEPARATE (different site). Attribution-focused. */
export async function ga4PortalSummary(days = 28): Promise<Ga4Portal | null> {
	try {
		const range = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
		const [chan, ref, conv, src] = await Promise.all([
			runReport(PORTAL_PROPERTY, { dateRanges: range, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'averageSessionDuration' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }, `p:chan:${days}`),
			runReport(PORTAL_PROPERTY, { dateRanges: range, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'averageSessionDuration' }, { name: 'engagedSessions' }], dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'info.propertylist' } } }, limit: 5 }, `p:ref:${days}`),
			runReport(PORTAL_PROPERTY, { dateRanges: range, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['form_start', 'form_submit', 'generate_lead', 'sign_up'] } } }, limit: 10 }, `p:conv:${days}`),
			runReport(PORTAL_PROPERTY, { dateRanges: range, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 40 }, `p:src:${days}`),
		]);
		const channels = chan.map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), avgSeconds: Math.round(Number(r.metricValues[1].value)) }));
		const refRow = ref.reduce((acc: any, r: any) => ({ sessions: acc.sessions + Number(r.metricValues[0].value), dur: acc.dur + Number(r.metricValues[1].value) * Number(r.metricValues[0].value), engaged: acc.engaged + Number(r.metricValues[2].value) }), { sessions: 0, dur: 0, engaged: 0 });
		const evMap: Record<string, number> = {};
		for (const r of conv) evMap[r.dimensionValues[0].value] = Number(r.metricValues[0].value);
		return {
			totalSessions: channels.reduce((a: number, c: { sessions: number }) => a + c.sessions, 0),
			channels,
			fromInfoHub: { sessions: refRow.sessions, avgSeconds: refRow.sessions ? Math.round(refRow.dur / refRow.sessions) : 0, engagedSessions: refRow.engaged },
			conversions: { formStart: evMap['form_start'] || 0, formSubmit: (evMap['form_submit'] || 0) + (evMap['generate_lead'] || 0) + (evMap['sign_up'] || 0) },
			aiReferrals: src.map((r: any) => ({ source: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })).filter((r: { source: string }) => AI_SOURCE.test(r.source)),
		};
	} catch {
		return null;
	}
}
