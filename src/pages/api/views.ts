import type { APIRoute } from 'astro';
import { getTotalViewCounts, recordWeeklyView } from '../../lib/weeklyViews';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const isTrackable = (path: string) => {
	if (!path || !path.startsWith('/')) return false;
	if (path.startsWith('/admin/')) return false;
	if (path.startsWith('/api/')) return false;
	if (path.startsWith('/docs/') && path !== '/docs/') return true;
	if (path.startsWith('/es/docs/') && path !== '/es/docs/') return true;
	if (path.startsWith('/blog/') && path !== '/blog/') return true;
	if (path.startsWith('/general-information/') && path !== '/general-information/') return true;
	if (path.startsWith('/es/informacion-general/') && path !== '/es/informacion-general/') return true;
	if (path.startsWith('/neighbourhood/')) {
		const parts = path.split('/').filter(Boolean);
		const isLegacyGuide = parts.length === 2 && parts[0] === 'neighbourhood' && parts[1] !== 'andalucia' && parts[1] !== 'spain';
		const isCanonicalGuide = parts.length === 4 && parts[0] === 'neighbourhood' && (parts[1] === 'andalucia' || parts[1] === 'spain');
		return isLegacyGuide || isCanonicalGuide;
	}
	if (path.startsWith('/es/barrios/')) {
		const parts = path.split('/').filter(Boolean);
		return parts.length === 3;
	}
	return false;
};

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const path = normalisePath(url.searchParams.get('path') || '');
	if (!isTrackable(path)) return json(400, { ok: false, error: 'invalid_path' });
	const counts = await getTotalViewCounts([path]).catch(() => ({} as any));
	return json(200, { ok: true, path, views: Number((counts as any)[path] || 0) });
};

export const POST: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const bodyRaw = await request.text().catch(() => '');
	let data: any = null;
	try {
		data = JSON.parse(bodyRaw || 'null');
	} catch {
		data = null;
	}
	const path = normalisePath(String(data?.path || url.searchParams.get('path') || ''));
	if (!isTrackable(path)) return json(400, { ok: false, error: 'invalid_path' });
	await recordWeeklyView(path).catch(() => undefined);
	return json(200, { ok: true });
};
