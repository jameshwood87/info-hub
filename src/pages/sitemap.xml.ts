import { listKbPagesByPrefix } from '../lib/directus';
import { listPrefixRedirects } from '../lib/kbRedirects';

export const prerender = false;

const origin = 'https://info.propertylist.es';

const asLastMod = (iso: string | null | undefined) => {
	if (!iso) return null;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	return new Date(ms).toISOString();
};

const escapeXml = (s: string) =>
	String(s || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');

const buildUrlEntry = (loc: string, lastmod: string | null) => {
	const safeLoc = escapeXml(loc);
	const safeLastMod = lastmod ? escapeXml(lastmod) : null;
	return `<url><loc>${safeLoc}</loc>${safeLastMod ? `<lastmod>${safeLastMod}</lastmod>` : ''}</url>`;
};

const normaliseEsDocsPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/es/docs/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'es' || parts[1] !== 'docs') return path;
	const root = parts[2] || '';
	const mappedRoot =
		root === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: root === 'mls-manual-de-usuario'
				? 'propertylist-mls-manual-de-usuario'
			: root === 'laws-procedures'
				? 'leyes-procedimientos'
				: root === 'public-portal'
					? 'portal-publico'
					: root === 'getting-started'
						? 'empezar'
						: root;
	parts[2] = mappedRoot;
	if (mappedRoot === 'propertylist-mls-manual-de-usuario') {
		const sub = parts[3] || '';
		if (sub === 'getting-started') parts[3] = 'empezar';
	}
	return `/${parts.join('/')}/`;
};

const toSpanishPath = (p: string) => {
	const path = String(p || '');
	if (path.startsWith('/neighbourhood/')) {
		const parts = path.split('/').filter(Boolean);
		if (parts[0] === 'neighbourhood' && parts.length === 4) {
			const slug = parts[3] || '';
			if (slug) return `/es/barrios/${slug}/`;
		}
	}
	const mapPairs: Array<{ en: string; es: string }> = [
		{ en: '/general-information/', es: '/es/informacion-general/' },
		{ en: '/blog/', es: '/es/informacion-general/' },
		{ en: '/community/', es: '/es/comunidad/' },
		{ en: '/laws/', es: '/es/leyes/' },
		{ en: '/neighbourhood/', es: '/es/barrios/' },
		{ en: '/andalucia/', es: '/es/andalucia/' },
		{ en: '/mls/', es: '/es/mls/' },
		{ en: '/pricing/', es: '/es/pricing/' },
		{ en: '/search', es: '/es/search' },
	];
	for (const pair of mapPairs) {
		if (path.startsWith(pair.en)) return `${pair.es}${path.slice(pair.en.length)}`;
	}
	if (!path.startsWith('/docs/')) return `/es${path.startsWith('/') ? path : `/${path}`}`;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'docs') return `/es/${parts.join('/')}/`;
	const seg = parts[1] || '';
	const mapped =
		seg === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: seg === 'mls-manual-de-usuario'
				? 'propertylist-mls-manual-de-usuario'
			: seg === 'laws-procedures'
				? 'leyes-procedimientos'
				: seg === 'public-portal'
					? 'portal-publico'
					: seg === 'getting-started'
						? 'empezar'
						: seg;
	parts[1] = mapped;
	if (mapped === 'propertylist-mls-manual-de-usuario') {
		const sub = parts[2] || '';
		if (sub === 'getting-started') parts[2] = 'empezar';
	}
	return `/es/${parts.join('/')}/`;
};

const applyStaticRedirectAliases = (pRaw: string) => {
	const raw = String(pRaw || '');
	const aliases: Array<{ from: string; to: string }> = [
		{
			from: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/new-page/',
			to: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/',
		},
	];
	for (const r of aliases) {
		if (!raw.startsWith(r.from)) continue;
		return `${r.to}${raw.slice(r.from.length)}`;
	}
	return raw;
};

const canonicalNeighbourhoodPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/neighbourhood/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return path;
	if (parts.length >= 4) return path;
	if (parts.length !== 2) return path;
	const slug = parts[1] || '';
	if (!slug || slug === 'andalucia') return path;
	return `/neighbourhood/andalucia/malaga/${slug}/`;
};

export async function GET() {
	const staticPaths = [
		'/',
		'/about-us/',
		'/faq/',
		'/docs/',
		'/blog/',
		'/community/',
		'/developers/',
		'/neighbourhood/',
		'/mls/',
		'/laws/',
		'/pricing/',
		'/search',
		'/es/',
		'/es/sobre-nosotros/',
		'/es/faq/',
		'/es/docs/',
		'/es/informacion-general/',
		'/es/comunidad/',
		'/es/barrios/',
		'/es/mls/',
		'/es/leyes/',
		'/es/pricing/',
		'/es/search',
	];

	const urls: Array<{ loc: string; lastmod: string | null }> = [];
	const seen = new Set<string>();

	const prefixRedirects = (await listPrefixRedirects().catch(() => []))
		.map((r) => ({ from: String(r?.from || ''), to: String(r?.to || '') }))
		.filter((r) => r.from && r.to)
		.sort((a, b) => b.from.length - a.from.length);
	const applyPrefixRedirect = (pRaw: string) => {
		const raw = String(pRaw || '');
		if (!raw.startsWith('/')) return raw;
		const u = raw.split('#');
		const beforeHash = u[0] || '';
		const hash = u.length > 1 ? `#${u.slice(1).join('#')}` : '';
		const q = beforeHash.split('?');
		const pathOnly = q[0] || '';
		const query = q.length > 1 ? `?${q.slice(1).join('?')}` : '';
		const pn = pathOnly.replace(/\/{2,}/g, '/');
		const withSlash = pn.endsWith('/') || /\/[^/]+\.[a-z0-9]{1,8}$/i.test(pn) ? pn : `${pn}/`;
		for (const r of prefixRedirects) {
			if (!withSlash.startsWith(r.from)) continue;
			const rest = withSlash.slice(r.from.length);
			const next = `${r.to}${rest}`;
			return `${next}${query}${hash}`;
		}
		return `${withSlash}${query}${hash}`;
	};

	const push = (path: string, lastmod: string | null) => {
		const cleanPath = path.startsWith('/') ? path : `/${path}`;
		const loc = `${origin}${cleanPath}`;
		if (seen.has(loc)) return;
		seen.add(loc);
		urls.push({ loc, lastmod });
	};

	for (const p of staticPaths) push(p, null);

	try {
		const addPrefix = async (prefix: string, lang: 'en' | 'es') => {
			const items = await listKbPagesByPrefix({ prefix, lang, limit: 500 });
			for (const it of items) {
				const lastmod = asLastMod(it.date_updated || it.date_created);
				const p0 = String(it.path || '');
				const p1 = lang === 'en' ? applyPrefixRedirect(p0) : normaliseEsDocsPath(p0);
				const p = lang === 'en' ? canonicalNeighbourhoodPath(p1) : p1;
				push(p, lastmod);
				if (lang === 'en') {
					const es = applyPrefixRedirect(applyStaticRedirectAliases(normaliseEsDocsPath(toSpanishPath(p))));
					push(es, lastmod);
				}
			}
		};

		await addPrefix('/docs/', 'en');
		await addPrefix('/general-information/', 'en');
		await addPrefix('/neighbourhood/', 'en');
		await addPrefix('/andalucia/', 'en');
		await addPrefix('/es/docs/', 'es');
	} catch {}

	const body = urls
		.sort((a, b) => a.loc.localeCompare(b.loc))
		.map((u) => buildUrlEntry(u.loc, u.lastmod))
		.join('');

	const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;

	return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
