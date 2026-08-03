import type { APIRoute } from 'astro';
import { assertAdmin } from '../../../../lib/adminAuth';

// Landing-page views + showpiece scroll funnels for the admin dashboard,
// from the self-hosted Umami (100% of traffic, no consent gate).
const API = (process.env.UMAMI_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const SITE = (process.env.UMAMI_WEBSITE_ID || '').trim();
const PASS = (process.env.UMAMI_ADMIN_PASS || '').trim();
const UMAMI_EPOCH = 1752278400000; // 2026-07-12

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

let token: string | null = null;
const login = async (): Promise<string | null> => {
	try {
		const r = await fetch(API + '/api/auth/login', {
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
			const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(6000) });
			if (r.status === 401) { token = null; continue; }
			if (!r.ok) return null;
			return await r.json();
		} catch {
			return null;
		}
	}
	return null;
};

// EN label -> the path variants (EN + ES) merged into one row
const PAIRS: Array<[string, string[]]> = [
	['/launch/', ['/launch/', '/es/lanza-tu-agencia/']],
	['/costa-del-sol/', ['/costa-del-sol/', '/es/costa-del-sol/']],
	['/ai-property-search/', ['/ai-property-search/', '/es/busqueda-ia/']],
	['/property-intelligence-report/', ['/property-intelligence-report/', '/es/informe-inteligencia-propiedad/']],
	['/mobile-app/', ['/mobile-app/', '/es/app-movil/']],
	['/instant-listing/', ['/instant-listing/', '/es/listado-instantaneo/']],
	['/instant-content/', ['/instant-content/', '/es/contenido-instantaneo/']],
	['/instant-brochure/', ['/instant-brochure/', '/es/folleto-instantaneo/']],
	['/instant-renovation/', ['/instant-renovation/', '/es/renovacion-instantanea/']],
	['/instant-video/', ['/instant-video/', '/es/video-instantaneo/']],
	['/instant-images/', ['/instant-images/', '/es/imagenes-instantaneas/']],
	['/website-builder/', ['/website-builder/', '/es/constructor-de-webs/']],
	['/pipelines/', ['/pipelines/', '/es/pipelines/']],
	['/rentals/', ['/rentals/', '/es/alquileres/']],
	['/pricing/', ['/pricing/', '/es/precios/']],
];

const canon = (p: string) => {
	const noHash = String(p || '').split('#')[0]!.split('?')[0]!;
	return noHash.endsWith('/') ? noHash : noHash + '/';
};

const COAST_ORDER = ['malaga', 'torremolinos', 'benalmadena', 'fuengirola', 'mijas', 'marbella', 'puerto-banus', 'estepona', 'sotogrande', 'interlude', 'finale'];
const LAUNCH_ORDER = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'stopSec', 'growSec'];

export const GET: APIRoute = async ({ request }) => {
	try {
		assertAdmin(request);
		if (!SITE || !PASS) return json(500, { ok: false, error: 'umami_env_missing' });
		const range = 'startAt=' + UMAMI_EPOCH + '&endAt=' + Date.now();

		const variantToLabel: Record<string, string> = {};
		for (const [label, variants] of PAIRS) for (const v of variants) variantToLabel[v] = label;

		const paths: any[] = (await api('/api/websites/' + SITE + '/metrics?type=path&' + range)) || [];
		const views: Record<string, number> = {};
		for (const row of paths) {
			const label = variantToLabel[canon(row.x)];
			if (!label) continue;
			views[label] = (views[label] || 0) + (Number(row.y) || 0);
		}

		const events: any[] = (await api('/api/websites/' + SITE + '/metrics?type=event&' + range)) || [];
		const ev: Record<string, number> = {};
		for (const row of events) ev[String(row.x || '')] = (Number(row.y) || 0) + (ev[String(row.x || '')] || 0);

		const coast = COAST_ORDER.map((k) => ({ k, n: ev['coast-sec-' + k] || 0 }));
		const launch = LAUNCH_ORDER.map((k) => ({ k, n: ev['launch-sec-' + k] || 0 }));
		const clicks = {
			'coast-signup-click': ev['coast-signup-click'] || 0,
			'coast-portal-click': ev['coast-portal-click'] || 0,
			'launch-signup-click': ev['launch-signup-click'] || 0,
			'signup-click': ev['signup-click'] || 0,
		};

		// ---- last-7-days traffic, with a bot / non-prospect country filter ----
		const wk = 'startAt=' + (Date.now() - 7 * 864e5) + '&endAt=' + Date.now();
		const stats: any = (await api('/api/websites/' + SITE + '/stats?' + wk)) || {};
		const countryRows: any[] = (await api('/api/websites/' + SITE + '/metrics?type=country&limit=30&' + wk)) || [];
		// countries that are overwhelmingly datacenter / scraper traffic for a Costa del Sol site, not real prospects
		const BOT_COUNTRIES = new Set(['SG', 'CN', 'HK', 'IN', 'VN', 'ID', 'RU', 'BR', 'TR', 'IR', 'UA', 'KR', 'TW', 'TH', 'PH']);
		const countries = countryRows.map((r: any) => ({ c: String(r.x || '??'), n: Number(r.y) || 0 })).sort((a, b) => b.n - a.n);
		const botVisitors = countries.filter((r) => BOT_COUNTRIES.has(r.c)).reduce((a, r) => a + r.n, 0);
		const allCountryVisitors = countries.reduce((a, r) => a + r.n, 0) || 1;
		const rawVisitors = Number(stats?.visitors ?? 0);
		const prospectVisitors = Math.round((rawVisitors * Math.max(0, allCountryVisitors - botVisitors)) / allCountryVisitors);
		const traffic = {
			pageviews: Number(stats?.pageviews ?? 0),
			visitors: rawVisitors,
			visits: Number(stats?.visits ?? 0),
			bounces: Number(stats?.bounces ?? 0),
			prospectVisitors,
			botCountryShare: Math.round((botVisitors / allCountryVisitors) * 100),
			countries: countries.slice(0, 12).map((r) => ({ c: r.c, n: r.n, bot: BOT_COUNTRIES.has(r.c) })),
		};

		return json(200, { ok: true, since: '2026-07-12', funnelsSince: '2026-07-20', views, coast, launch, clicks, traffic });
	} catch (e: any) {
		return json(e?.status || 500, { ok: false, error: e?.message || 'error' });
	}
};
