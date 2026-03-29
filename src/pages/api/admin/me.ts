import type { APIRoute } from 'astro';
import { getAdminSessionFromRequest } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request }) => {
	const session = getAdminSessionFromRequest(request);
	if (!session) {
		return new Response(JSON.stringify({ ok: false, authenticated: false }), {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}
	return new Response(
		JSON.stringify({
			ok: true,
			authenticated: true,
			userId: session.userId,
			role: session.role,
			csrfToken: session.csrfToken,
			expiresAtMs: session.expiresAtMs,
		}),
		{ status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }
	);
};
