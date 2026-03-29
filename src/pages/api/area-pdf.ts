import type { APIRoute } from 'astro';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const normaliseAreaPath = (raw: string) => {
	const v = String(raw || '').trim();
	if (!v) return '';
	const withSlash = v.startsWith('/') ? v : `/${v}`;
	const normalized = withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
	if (normalized.startsWith('/share/')) return `/${normalized.slice('/share/'.length)}`.replace(/^\/+/, '/');
	if (normalized.startsWith('/es/share/')) return `/es/${normalized.slice('/es/share/'.length)}`.replace(/^\/+/, '/');
	return normalized;
};

const isAreaPath = (p: string) => p.startsWith('/andalucia/') || p.startsWith('/es/andalucia/');

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const pathRaw = String(url.searchParams.get('path') || '');
	const auto = url.searchParams.get('auto') === '1';
	const areaPath = normaliseAreaPath(pathRaw);
	if (!areaPath || !isAreaPath(areaPath)) return json(400, { ok: false, error: 'invalid_path' });

	const origin = `${url.protocol}//${url.host}`;
	const target = new URL(`${origin}${areaPath}`);
	target.searchParams.set('client', '1');
	if (auto) target.searchParams.set('auto', '1');

	const res = await fetch(target.toString(), {
		headers: (() => {
			const h = new Headers();
			const accept = request.headers.get('accept');
			if (accept) h.set('accept', accept);
			const userAgent = request.headers.get('user-agent');
			if (userAgent) h.set('user-agent', userAgent);
			return h;
		})(),
	}).catch(() => null);

	if (!res || !res.ok) return json(502, { ok: false, error: 'fetch_failed' });
	const html = await res.text();

	const filename = areaPath
		.split('/')
		.filter(Boolean)
		.slice(-2)
		.join('-')
		.replace(/[^a-z0-9\-]+/gi, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();

	return new Response(html, {
		status: 200,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-disposition': `attachment; filename="${filename || 'area'}.html"`,
		},
	});
};

