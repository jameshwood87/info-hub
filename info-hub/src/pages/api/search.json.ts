import type { APIRoute } from 'astro';

const DEFAULT_LIMIT = 20;

export const GET: APIRoute = async ({ url }) => {
	const q = (url.searchParams.get('q') || '').trim();
	const lang = (url.searchParams.get('lang') || 'en').trim();
	const limitRaw = url.searchParams.get('limit') || '';
	const limit = Math.min(
		Math.max(Number.parseInt(limitRaw || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
		50
	);

	if (!q) {
		return new Response(JSON.stringify({ results: [] }), {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const directusUrl = (
		(process.env.DIRECTUS_URL as string | undefined) ||
		import.meta.env.DIRECTUS_URL ||
		'http://127.0.0.1:8055'
	).replace(/\/+$/, '');
	const token = (process.env.DIRECTUS_TOKEN as string | undefined) || import.meta.env.DIRECTUS_TOKEN || '';

	const params = new URLSearchParams();
	params.set('limit', `${limit}`);
	params.set('fields', 'id,path,title,description,language');
	params.set('filter[status][_eq]', 'published');
	params.set('filter[language][_eq]', lang);
	params.set('filter[_or][0][title][_icontains]', q);
	params.set('filter[_or][1][body][_icontains]', q);

	const res = await fetch(`${directusUrl}/items/kb_pages?${params.toString()}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : undefined,
	});

	if (!res.ok) {
		return new Response(JSON.stringify({ results: [] }), {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const json = (await res.json()) as { data?: unknown[] };
	const results = Array.isArray(json.data) ? json.data : [];

	return new Response(JSON.stringify({ results }), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
};
