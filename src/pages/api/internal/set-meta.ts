import type { APIRoute } from 'astro';
import { setKbMeta } from '../../../lib/adminMeta';

// Internal-only endpoint so cron scripts can set kb-meta safely THROUGH the running
// app (its in-memory store is authoritative; direct file edits get flushed over).
// Guarded by INTERNAL_META_TOKEN from .env; intended for localhost callers.
export const POST: APIRoute = async ({ request }) => {
	const expected = String(process.env.INTERNAL_META_TOKEN || '').trim();
	const got = String(request.headers.get('x-internal-token') || '').trim();
	if (!expected || got !== expected) return new Response('Forbidden', { status: 403 });
	let body: any = null;
	try {
		body = await request.json();
	} catch {
		return new Response('Bad Request', { status: 400 });
	}
	const id = String(body?.id || '').trim();
	if (!id) return new Response('Bad Request', { status: 400 });
	const patch: { featuredImageUrl?: string; featuredImageAlt?: string; reviewedAt?: string } = {};
	if (typeof body.featuredImageUrl === 'string' && body.featuredImageUrl.trim()) patch.featuredImageUrl = body.featuredImageUrl.trim();
	if (typeof body.featuredImageAlt === 'string' && body.featuredImageAlt.trim()) patch.featuredImageAlt = body.featuredImageAlt.trim();
	if (typeof body.reviewedAt === 'string' && body.reviewedAt.trim()) patch.reviewedAt = body.reviewedAt.trim();
	if (!Object.keys(patch).length) return new Response('Bad Request', { status: 400 });
	await setKbMeta(id, patch);
	return new Response(JSON.stringify({ ok: true, id, ...patch }), { headers: { 'content-type': 'application/json' } });
};
