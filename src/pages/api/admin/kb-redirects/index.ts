import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { listPrefixRedirects, removePrefixRedirect } from '../../../../lib/kbRedirects';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ request }) => {
	const session = assertAdmin(request);
	assertRole(session, ['admin']);
	const redirects = await listPrefixRedirects();
	return json(200, { ok: true, redirects });
};

export const DELETE: APIRoute = async ({ request }) => {
	const session = assertAdmin(request);
	assertRole(session, ['admin']);
	assertCsrf(request, session);

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	const from = String(body?.from || '').trim();
	if (!from) return json(400, { ok: false, error: 'missing_from' });

	const res = await removePrefixRedirect(from).catch((e: any) => ({ ok: false, error: String(e?.message || 'remove_failed') }));
	if (!res || (res as any).ok !== true) return json(400, { ok: false, error: (res as any)?.error || 'remove_failed' });
	return json(200, res);
};
