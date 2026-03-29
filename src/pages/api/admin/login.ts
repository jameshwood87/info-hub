import type { APIRoute } from 'astro';
import {
	adminAuthCookies,
	clearLoginFailures,
	createAdminSession,
	rateLimitLogin,
	recordLoginFailure,
	verifyAdminRoleForPassword,
} from '../../../lib/adminAuth';

type LoginBody = { password?: string };

const json = (status: number, body: any, headers?: Headers) =>
	new Response(JSON.stringify(body), {
		status,
		headers: headers || { 'content-type': 'application/json; charset=utf-8' },
	});

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || 'unknown';

	try {
		rateLimitLogin(ip);
	} catch (e: any) {
		const retryAfterMs = typeof e?.retryAfterMs === 'number' ? e.retryAfterMs : 60_000;
		const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
		headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
		return json(429, { ok: false, error: 'rate_limited' }, headers);
	}

	let body: LoginBody = {};
	try {
		body = (await request.json()) as LoginBody;
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	const password = String(body.password || '');
	if (!password) return json(400, { ok: false, error: 'missing_password' });

	const role = await verifyAdminRoleForPassword(password).catch(() => null);
	if (!role) {
		recordLoginFailure(ip);
		return json(401, { ok: false, error: 'invalid_credentials' });
	}

	clearLoginFailures(ip);
	const session = createAdminSession(role);
	const cookies = adminAuthCookies(session);
	const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
	headers.append('set-cookie', cookies.session);
	headers.append('set-cookie', cookies.csrf);
	return json(200, { ok: true, userId: session.userId, role: session.role, csrfToken: session.csrfToken }, headers);
};
