import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Minimal Search Console client (no deps). Key: var/admin/gsc-key.json.
// All calls cached in-process for 1h - this powers the admin analytics page.

const KEY_PATH = '/opt/info-hub/var/admin/gsc-key.json';
const SITE = 'https://info.propertylist.es/';
const ORIGIN = 'https://info.propertylist.es';

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type PageMetrics = { clicks: number; impressions: number; ctr: number; position: number };
export type QueryRow = { query: string; page?: string; clicks: number; impressions: number; ctr: number; position: number };

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
	if (tokenCache && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
	const key = JSON.parse(await fs.readFile(KEY_PATH, 'utf8'));
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
	const j: any = await res.json();
	if (!j.access_token) throw new Error('gsc token failed');
	tokenCache = { token: j.access_token, exp: Date.now() + 3600000 };
	return j.access_token;
}

const qCache = new Map<string, { at: number; rows: GscRow[] }>();
const CACHE_MS = 60 * 60 * 1000;

async function query(dimensions: string[], days: number, rowLimit = 1000): Promise<GscRow[]> {
	const ck = `${dimensions.join(',')}:${days}:${rowLimit}`;
	const hit = qCache.get(ck);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
	const tok = await accessToken();
	const fmt = (d: Date) => d.toISOString().slice(0, 10);
	const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ startDate: fmt(new Date(Date.now() - days * 86400000)), endDate: fmt(new Date()), dimensions, rowLimit }),
	});
	const j: any = await res.json();
	const rows: GscRow[] = Array.isArray(j.rows) ? j.rows : [];
	qCache.set(ck, { at: Date.now(), rows });
	return rows;
}

/** Per-path metrics keyed by site-relative path (28d default). Null if GSC unavailable. */
export async function gscPageMetrics(days = 28): Promise<Record<string, PageMetrics> | null> {
	try {
		const rows = await query(['page'], days, 2000);
		const out: Record<string, PageMetrics> = {};
		for (const r of rows) {
			const path = String(r.keys[0] || '').replace(ORIGIN, '') || '/';
			out[path] = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
		}
		return out;
	} catch {
		return null;
	}
}

export async function gscTopQueries(days = 28, limit = 25): Promise<QueryRow[] | null> {
	try {
		const rows = await query(['query'], days, 500);
		return rows
			.map((r) => ({ query: String(r.keys[0] || ''), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
			.sort((a, b) => b.impressions - a.impressions)
			.slice(0, limit);
	} catch {
		return null;
	}
}

export async function gscStriking(days = 28, limit = 25): Promise<QueryRow[] | null> {
	try {
		const rows = await query(['query', 'page'], days, 1000);
		return rows
			.map((r) => ({ query: String(r.keys[0] || ''), page: String(r.keys[1] || '').replace(ORIGIN, ''), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
			.filter((r) => r.position >= 8 && r.position <= 30 && r.impressions >= 3 && !/propertylist/i.test(r.query))
			.sort((a, b) => b.impressions - a.impressions)
			.slice(0, limit);
	} catch {
		return null;
	}
}
