import type { APIRoute } from 'astro';
import { assertAdmin } from '../../../../lib/adminAuth';

// What's-On engagement numbers for the admin analytics dashboard, straight from
// the self-hosted Umami (sees 100% of traffic, no consent gate). Umami's API is
// local-only (127.0.0.1:3001); we log in with the admin creds from .env and
// cache the token in-process.
const API = (process.env.UMAMI_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const SITE = (process.env.UMAMI_WEBSITE_ID || '').trim();
const PASS = (process.env.UMAMI_ADMIN_PASS || '').trim();
const UMAMI_EPOCH = 1752278400000; // 2026-07-12, when Umami went live

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

let token: string | null = null;
const login = async (): Promise<string | null> => {
	try {
		const r = await fetch(`${API}/api/auth/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: PASS }),
			signal: AbortSignal.timeout(5000),
		});
		if (!r.ok) return null;
		const j: any = await r.json();
		return typeof j?.token === 'string' ? j.token : null;
	} catch {
		return null;
	}
};

const api = async (path: string): Promise<any | null> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (!token) token = await login();
		if (!token) return null;
		try {
			const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
			if (r.status === 401) { token = null; continue; }
			if (!r.ok) return null;
			return await r.json();
		} catch {
			return null;
		}
	}
	return null;
};

const CANONICAL = [
	'/whats-on/',
	'/whats-on/marbella/',
	'/whats-on/estepona/',
	'/whats-on/malaga/',
	'/es/que-hacer/',
	'/es/que-hacer/marbella/',
	'/es/que-hacer/estepona/',
	'/es/que-hacer/malaga/',
];
// Umami records both slash and no-slash variants; merge to the canonical form.
const canon = (p: string) => {
	const noHash = String(p || '').split('#')[0]!.split('?')[0]!;
	return noHash.endsWith('/') ? noHash : noHash + '/';
};

export const GET: APIRoute = async ({ request }) => {
	try {
		assertAdmin(request);
		if (!SITE || !PASS) return json(500, { ok: false, error: 'umami_env_missing' });
		const now = Date.now();
		const range = `startAt=${UMAMI_EPOCH}&endAt=${now}`;

		// views per page (single call, merged variants)
		const paths: any[] = (await api(`/api/websites/${SITE}/metrics?type=path&${range}`)) || [];
		const views: Record<string, number> = {};
		for (const row of paths) {
			const c = canon(row.x);
			if (!CANONICAL.includes(c)) continue;
			views[c] = (views[c] || 0) + (Number(row.y) || 0);
		}

		// plan events, total + per page
		const events: any[] = (await api(`/api/websites/${SITE}/metrics?type=event&${range}`)) || [];
		const planTotals: Record<string, number> = {};
		for (const row of events) {
			const name = String(row.x || '');
			if (name.startsWith('plan-')) planTotals[name] = (planTotals[name] || 0) + (Number(row.y) || 0);
		}
		const byPage: Record<string, Record<string, number>> = {};
		if (Object.keys(planTotals).length) {
			for (const c of CANONICAL) {
				for (const variant of [c, c.slice(0, -1)]) {
					const evs: any[] = (await api(`/api/websites/${SITE}/metrics?type=event&${range}&path=${encodeURIComponent(variant)}`)) || [];
					for (const row of evs) {
						const name = String(row.x || '');
						if (!name.startsWith('plan-')) continue;
						byPage[c] = byPage[c] || {};
						byPage[c][name] = (byPage[c][name] || 0) + (Number(row.y) || 0);
					}
				}
			}
		}

		return json(200, { ok: true, since: '2026-07-12', views, planTotals, byPage });
	} catch (e: any) {
		return json(e?.status || 500, { ok: false, error: e?.message || 'error' });
	}
};
