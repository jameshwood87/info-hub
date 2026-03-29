import type { APIRoute } from 'astro';
import { assertAdmin } from '../../../../lib/adminAuth';
import { getRecentViewCounts, getTotalViewCounts } from '../../../../lib/weeklyViews';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const POST: APIRoute = async ({ request }) => {
	assertAdmin(request);
	let body: any = null;
	try {
		body = await request.json();
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}
	const paths: string[] = [];
	if (Array.isArray(body?.paths)) {
		const seen = new Set<string>();
		for (const raw of body.paths.slice(0, 2500)) {
			const p = String(raw || '').trim();
			if (!p) continue;
			if (seen.has(p)) continue;
			seen.add(p);
			paths.push(p);
		}
	}
	if (!paths.length) return json(200, { ok: true, counts: {}, countsRecent: {} });
	const counts = await getTotalViewCounts(paths).catch(() => ({}));
	const countsRecent = await getRecentViewCounts(paths).catch(() => ({}));
	return json(200, { ok: true, counts, countsRecent });
};
