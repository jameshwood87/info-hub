import type { APIRoute } from 'astro';
import { adminClearCookies, deleteAdminSession } from '../../../lib/adminAuth';

const json = (status: number, body: any, headers?: Headers) =>
	new Response(JSON.stringify(body), {
		status,
		headers: headers || { 'content-type': 'application/json; charset=utf-8' },
	});

export const POST: APIRoute = async ({ request }) => {
	deleteAdminSession(request);
	const clear = adminClearCookies();
	const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
	headers.append('set-cookie', clear.session);
	headers.append('set-cookie', clear.csrf);
	return json(200, { ok: true }, headers);
};

