import type { APIRoute } from 'astro';
import { canonicalAreaPath } from '../../lib/areaProvince';
import { normaliseKbText } from '../../lib/directus';

const DEFAULT_LIMIT = 20;

const canonicalNeighbourhoodPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/neighbourhood/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return path;
	if (parts.length >= 4) return path;
	if (parts.length !== 2) return path;
	const slug = parts[1] || '';
	if (!slug || slug === 'andalucia' || slug === 'spain') return path;
	return canonicalAreaPath(slug);
};

export const GET: APIRoute = async ({ url }) => {
	const q = (url.searchParams.get('q') || '').trim();
	const lang = (url.searchParams.get('lang') || 'en').trim();
	const prefix = (url.searchParams.get('prefix') || '').trim();
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
	params.set('sort', '-id');
	params.set('filter[_or][0][title][_icontains]', q);
	params.set('filter[_or][1][body][_icontains]', q);
	if (prefix) params.set('filter[path][_starts_with]', prefix);

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

	const normalised = results.map((r) => {
		const o = (r || {}) as {
			id?: unknown;
			path?: unknown;
			title?: unknown;
			description?: unknown;
			language?: unknown;
		};
		const language = typeof o.language === 'string' ? o.language : undefined;
		const path = typeof o.path === 'string' ? canonicalNeighbourhoodPath(o.path) : o.path;
		return {
			...o,
			path,
			title: normaliseKbText(typeof o.title === 'string' ? o.title : '', language, { stripSuffix: true, decode: true }),
			description:
				typeof o.description === 'string'
					? normaliseKbText(o.description, language, { stripSuffix: false, decode: true })
					: o.description,
		};
	});

	return new Response(JSON.stringify({ results: normalised }), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
};
