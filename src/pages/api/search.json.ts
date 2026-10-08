import type { APIRoute } from 'astro';
import { canonicalAreaPath } from '../../lib/areaProvince';
import { normaliseKbText } from '../../lib/directus';

const DEFAULT_LIMIT = 20;
const ORIGIN = 'https://info.propertylist.es';

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
	// match=all: every word of the query must appear (in the title or the body), in any order.
	// Used by the PropertyList MCP's search_guides tool; the site search keeps the default phrase match.
	const matchAll = (url.searchParams.get('match') || '').trim() === 'all';
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

	const words = matchAll
		? Array.from(new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))).slice(0, 6)
		: [];

	// Title matches first, then pages that only mention the words in their body, newest first within each.
	// One title-or-body query sorted by id put "Export Listings XML" 18th for "xml" (27-09-26).
	// match=all fetches a wider pool, then ranks it by whole-word hits (see below).
	const fetchLimit = words.length ? Math.min(50, limit * 4) : limit;
	const query = (field: 'title' | 'body') => {
		const params = new URLSearchParams();
		params.set('limit', `${fetchLimit}`);
		params.set('fields', 'id,path,title,description,language');
		params.set('sort', '-id');
		if (words.length) {
			// Every word must appear somewhere; the title pass also needs at least one of the words in the title.
			const and: unknown[] = [
				{ status: { _eq: 'published' } },
				{ language: { _eq: lang } },
				...words.map((w) => ({ _or: [{ title: { _icontains: w } }, { body: { _icontains: w } }] })),
			];
			if (field === 'title') and.push({ _or: words.map((w) => ({ title: { _icontains: w } })) });
			if (prefix) and.push({ path: { _starts_with: prefix } });
			params.set('filter', JSON.stringify({ _and: and }));
		} else {
			params.set('filter[status][_eq]', 'published');
			params.set('filter[language][_eq]', lang);
			params.set(`filter[${field}][_icontains]`, q);
			if (prefix) params.set('filter[path][_starts_with]', prefix);
		}
		return fetch(`${directusUrl}/items/kb_pages?${params.toString()}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		})
			.then(async (res) => (res.ok ? ((await res.json()) as { data?: unknown[] }).data : null))
			.catch(() => null);
	};
	if (matchAll && !words.length) {
		return new Response(JSON.stringify({ results: [] }), {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}
	const [byTitle, byBody] = await Promise.all([query('title'), query('body')]);

	if (!Array.isArray(byTitle) && !Array.isArray(byBody)) {
		return new Response(JSON.stringify({ results: [] }), {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const seen = new Set<unknown>();
	let pool = [...(Array.isArray(byTitle) ? byTitle : []), ...(Array.isArray(byBody) ? byBody : [])]
		.filter((r) => {
			const id = (r as { id?: unknown } | null)?.id;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});

	// match=all ranking: a whole word in the title counts most, then in the description, then part of a
	// title word ("IBI" inside "Ibiza" scores low). Ties keep the title-first, newest-first order.
	if (words.length) {
		const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const score = (r: unknown) => {
			const o = (r || {}) as { title?: unknown; description?: unknown };
			const t = String(o.title || '').toLowerCase();
			const d = String(o.description || '').toLowerCase();
			let s = 0;
			for (const w of words) {
				const whole = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, 'u');
				if (whole.test(t)) s += 4;
				else if (t.includes(w)) s += 1;
				if (whole.test(d)) s += 2;
			}
			return s;
		};
		pool = pool
			.map((r, i) => ({ r, i, s: score(r) }))
			.sort((a, b) => b.s - a.s || a.i - b.i)
			.map((x) => x.r);
	}
	const results = pool.slice(0, limit);

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
			url: typeof path === 'string' ? `${ORIGIN}${path}` : undefined,
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
