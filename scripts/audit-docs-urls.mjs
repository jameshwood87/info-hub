import fs from 'node:fs/promises';
import path from 'node:path';

const PROD_ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const SITEMAP_PATH = '/sitemap.xml';
const DOC_PREFIXES = ['/docs/', '/es/docs/'];
const ADMIN_PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const FAIL = process.argv.includes('--fail');
const ADMIN_AUDIT = process.argv.includes('--admin-audit');

const projectRoot = path.resolve(process.cwd());
const outDir = path.join(projectRoot, 'reports');
const outPath = path.join(outDir, 'docs-url-audit.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url, opts = {}) => {
	const res = await fetch(url, {
		redirect: 'manual',
		signal: AbortSignal.timeout(45000),
		headers: { 'User-Agent': 'PropertyList-InfoHub-Audit/1.0', Accept: 'text/html,application/xhtml+xml,*/*' },
		...opts,
	});
	const text = await res.text().catch(() => '');
	return { res, text };
};

const extractLocs = (xml) => {
	const out = [];
	const re = /<loc>([^<]+)<\/loc>/gi;
	let m = null;
	while ((m = re.exec(String(xml || '')))) {
		const loc = String(m[1] || '').trim();
		if (loc) out.push(loc);
	}
	return out;
};

const normalisePath = (raw) => {
	const s = String(raw || '').trim();
	if (!s) return null;
	let u;
	try {
		u = new URL(s, PROD_ORIGIN);
	} catch {
		return null;
	}
	const pn = String(u.pathname || '/');
	const noDoubles = pn.replace(/\/{2,}/g, '/');
	if (!noDoubles.startsWith('/')) return null;
	const endsWithSlash = noDoubles.endsWith('/');
	const looksLikeFile = /\/[^/]+\.[a-z0-9]{1,8}$/i.test(noDoubles);
	if (looksLikeFile) return noDoubles;
	return endsWithSlash ? noDoubles : `${noDoubles}/`;
};

const isDocsPath = (p) => DOC_PREFIXES.some((pre) => p.startsWith(pre));

const extractDocLinks = (html) => {
	const out = [];
	const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	let m = null;
	while ((m = re.exec(String(html || '')))) {
		const href = String(m[1] || m[2] || m[3] || '').trim();
		if (!href) continue;
		if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
		let url;
		try {
			url = new URL(href, PROD_ORIGIN);
		} catch {
			continue;
		}
		if (url.origin !== new URL(PROD_ORIGIN).origin) continue;
		const pn = normalisePath(url.pathname);
		if (!pn) continue;
		if (isDocsPath(pn)) out.push(pn);
	}
	return out;
};

const extractMainFromHtml = (html) => {
	const src = String(html || '');
	const main = src.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	if (main && main[1]) return String(main[1]);
	const article = src.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
	if (article && article[1]) return String(article[1]);
	const body = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	return body && body[1] ? String(body[1]) : src;
};

const uniq = (arr) => Array.from(new Set(arr));

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ');
const decodeEntities = (s) =>
	String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, entRaw) => {
		const ent = String(entRaw || '').toLowerCase();
		if (ent === 'amp') return '&';
		if (ent === 'lt') return '<';
		if (ent === 'gt') return '>';
		if (ent === 'quot') return '"';
		if (ent === 'apos' || ent === '#39') return "'";
		if (ent === 'nbsp') return ' ';
		if (ent.startsWith('#x')) {
			const cp = Number.parseInt(ent.slice(2), 16);
			if (Number.isFinite(cp) && cp > 0) return String.fromCodePoint(cp);
			return m;
		}
		if (ent.startsWith('#')) {
			const cp = Number.parseInt(ent.slice(1), 10);
			if (Number.isFinite(cp) && cp > 0) return String.fromCodePoint(cp);
			return m;
		}
		return m;
	});

const normaliseText = (html) =>
	decodeEntities(stripTags(html))
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

const looksEnglish = (html) => {
	const text = normaliseText(html);
	if (!text) return false;
	const enWords = [
		'the',
		'and',
		'for',
		'with',
		'this',
		'that',
		'you',
		'your',
		'how',
		'what',
		'where',
		'when',
		'click',
		'account',
		'create',
		'import',
		'edit',
		'manage',
	];
	const esWords = [
		'el',
		'la',
		'los',
		'las',
		'de',
		'del',
		'y',
		'para',
		'con',
		'como',
		'cómo',
		'cuenta',
		'anuncio',
		'anuncios',
		'propiedad',
		'propiedades',
		'gestionar',
		'crear',
		'haz',
		'puedes',
	];
	const hasWord = (w) => text === w || text.includes(` ${w} `) || text.startsWith(`${w} `) || text.endsWith(` ${w}`);
	const enHits = enWords.reduce((acc, w) => acc + (hasWord(w) ? 1 : 0), 0);
	const esHits = esWords.reduce((acc, w) => acc + (hasWord(w) ? 1 : 0), 0);
	return enHits >= 6 && enHits > esHits + 4;
};

const extractHeadingsHtml = (html) => {
	const out = [];
	const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
	let m = null;
	while ((m = re.exec(String(html || '')))) out.push(String(m[1] || ''));
	return out;
};

const loginAdmin = async () => {
	if (!ADMIN_PASSWORD) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');
	const res = await fetch(`${PROD_ORIGIN}/api/admin/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password: ADMIN_PASSWORD }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.csrfToken) throw new Error(`admin_login_failed ${res.status}`);
	const getSetCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	const rawHeader = res.headers.get('set-cookie') || '';
	const rawList = getSetCookie.length
		? getSetCookie
		: rawHeader
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
	const cookieHeader = rawList.map((s) => String(s).split(';')[0]).join('; ');
	return { cookieHeader, csrfToken: String(json.csrfToken) };
};

const listDocsMetaFromAdmin = async (auth) => {
	const url = `${PROD_ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent('/docs/')},${encodeURIComponent(
		'/es/docs/',
	)}&status=any&limit=20000&bucket=all`;
	const res = await fetch(url, { headers: { cookie: auth.cookieHeader } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status}`);
	return json.items
		.map((it) => ({
			id: String(it?.id || ''),
			status: String(it?.status || ''),
			language: String(it?.language || ''),
			path: normalisePath(String(it?.path || '')),
			title: String(it?.title || ''),
			description: it?.description == null ? null : String(it?.description || ''),
			date_created: it?.date_created == null ? null : String(it?.date_created || ''),
			date_updated: it?.date_updated == null ? null : String(it?.date_updated || ''),
		}))
		.filter((it) => it.path && isDocsPath(it.path));
};

const listDocsFromAdmin = async (auth) => (await listDocsMetaFromAdmin(auth)).map((it) => it.path).filter(Boolean);

const getAdminKbPageById = async (auth, id) => {
	const res = await fetch(`${PROD_ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`admin_get_failed ${res.status}`);
	return json.item;
};

const mapDocsEnglishToSpanishPath = (p) => {
	const pn = normalisePath(p);
	if (!pn || !pn.startsWith('/docs/')) return pn;
	const parts = pn.split('/').filter(Boolean);
	const seg = parts[1] || '';
	const mapped =
		seg === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: seg === 'laws-procedures'
				? 'leyes-procedimientos'
				: seg === 'public-portal'
					? 'portal-publico'
					: seg === 'getting-started'
						? 'empezar'
						: seg;
	const rest = parts.slice(2);
	const joined = rest.length ? `${rest.join('/')}/` : '';
	return `/es/docs/${mapped}/${joined}`;
};

const mapDocsSpanishToEnglishPath = (p) => {
	const pn = normalisePath(p);
	if (!pn || !pn.startsWith('/es/docs/')) return pn;
	const parts = pn.split('/').filter(Boolean);
	const seg = parts[2] || '';
	const mapped =
		seg === 'propertylist-mls-manual-de-usuario'
			? 'propertylist-mls-user-manual'
			: seg === 'leyes-procedimientos'
				? 'laws-procedures'
				: seg === 'portal-publico'
					? 'public-portal'
					: seg === 'empezar'
						? 'getting-started'
						: seg;
	const rest = parts.slice(3);
	const joined = rest.length ? `${rest.join('/')}/` : '';
	return `/docs/${mapped}/${joined}`;
};

const chunk = (arr, size) => {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
};

const crawlInventory = async (paths, opts = {}) => {
	const concurrency = Math.max(1, Math.min(16, Number(opts.concurrency || 10)));
	const q = [...paths];
	const seen = new Set();
	const pages = new Map();
	const edges = new Map();
	const redirects = [];
	const broken = [];

	const worker = async () => {
		while (q.length) {
			const p = q.shift();
			if (!p || seen.has(p)) continue;
			seen.add(p);
			const url = `${PROD_ORIGIN}${p}`;
			let res, text;
			try {
				({ res, text } = await fetchText(url));
			} catch (e) {
				pages.set(p, { status: 0 });
				broken.push({ from: null, to: p, status: 0, error: String(e?.message || e) });
				continue;
			}

			const status = res.status;
			const location = res.headers.get('location') || '';
			pages.set(p, { status, location: location || null });

			if (status >= 300 && status < 400 && location) {
				const next = normalisePath(location);
				redirects.push({ from: p, status, to: next || location });
				continue;
			}

			if (status >= 400) {
				broken.push({ from: null, to: p, status });
				continue;
			}

			const links = uniq(extractDocLinks(extractMainFromHtml(text)));
			edges.set(p, links);
		}
	};

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return { pages, edges, redirects, broken, seen: Array.from(seen) };
};

const crawl = async (startPaths, opts = {}) => {
	const concurrency = Math.max(1, Math.min(12, Number(opts.concurrency || 8)));
	const maxPages = Math.max(1, Math.min(5000, Number(opts.maxPages || 2000)));

	const q = [...startPaths];
	const seen = new Set();
	const pages = new Map();
	const edges = new Map();
	const redirects = [];
	const broken = [];

	const worker = async () => {
		while (q.length && pages.size < maxPages) {
			const p = q.shift();
			if (!p || seen.has(p)) continue;
			seen.add(p);
			const url = `${PROD_ORIGIN}${p}`;
			let res, text;
			try {
				({ res, text } = await fetchText(url));
			} catch (e) {
				pages.set(p, { status: 0 });
				broken.push({ from: null, to: p, status: 0, error: String(e?.message || e) });
				continue;
			}

			const status = res.status;
			const location = res.headers.get('location') || '';
			pages.set(p, { status, location: location || null });

			if (status >= 300 && status < 400 && location) {
				const next = normalisePath(location);
				redirects.push({ from: p, status, to: next || location });
				if (next && isDocsPath(next) && !seen.has(next)) q.push(next);
				continue;
			}

			if (status >= 400) {
				broken.push({ from: null, to: p, status });
				continue;
			}

			const links = uniq(extractDocLinks(extractMainFromHtml(text)));
			edges.set(p, links);
			for (const lp of links) {
				if (!seen.has(lp) && q.length < maxPages * 2) q.push(lp);
			}
		}
	};

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return { pages, edges, redirects, broken, seen: Array.from(seen) };
};

const main = async () => {
	const generatedAt = new Date().toISOString();
	let smRes = null;
	let smText = '';
	try {
		const out = await fetchText(`${PROD_ORIGIN}${SITEMAP_PATH}`, { headers: { Accept: 'application/xml,text/xml,*/*' } });
		smRes = out.res;
		smText = out.text;
	} catch {
		smRes = null;
		smText = '';
	}

	const crawlStart = DOC_PREFIXES;
	const crawled = await crawl(crawlStart, { concurrency: 10, maxPages: 4000 });

	const docsPathsFromSitemap = (() => {
		if (!smRes || !smRes.ok) return [];
		const locs = extractLocs(smText);
		const allPaths = locs
			.map((loc) => {
				try {
					const u = new URL(loc);
					return normalisePath(u.pathname);
				} catch {
					return normalisePath(loc);
				}
			})
			.filter(Boolean);
		return uniq(allPaths.filter((p) => isDocsPath(p))).sort();
	})();

	let docsPaths = docsPathsFromSitemap.length ? docsPathsFromSitemap : crawled.seen.filter((p) => isDocsPath(p)).sort();

	let adminDocsPaths = [];
	let adminAuth = null;
	let adminDocsMeta = [];
	let inventoryCrawl = null;
	if (ADMIN_AUDIT || docsPaths.length < 10) {
		try {
			adminAuth = await loginAdmin();
			adminDocsMeta = await listDocsMetaFromAdmin(adminAuth);
			adminDocsPaths = uniq(adminDocsMeta.map((it) => it.path).filter(Boolean)).sort();
			if (adminDocsPaths.length) {
				if (ADMIN_AUDIT) docsPaths = adminDocsPaths;
				inventoryCrawl = await crawlInventory(docsPaths, { concurrency: 10 });
			}
		} catch {}
	}

	const byNormalised = new Map();
	for (const p of docsPaths) {
		const key = p.toLowerCase();
		const list = byNormalised.get(key) || [];
		list.push(p);
		byNormalised.set(key, list);
	}
	const sitemapDuplicates = [...byNormalised.entries()]
		.filter(([, list]) => list.length > 1)
		.map(([key, list]) => ({ key, paths: list }));

	const effectiveEdges = inventoryCrawl?.edges || crawled.edges;
	const effectivePages = inventoryCrawl?.pages || crawled.pages;
	const effectiveRedirects = inventoryCrawl?.redirects || crawled.redirects;
	const effectiveBroken = inventoryCrawl?.broken || crawled.broken;

	const reachable = new Set(crawled.seen);
	const orphans = docsPaths.filter((p) => !reachable.has(p));

	const brokenLinks = [];
	for (const [from, tos] of effectiveEdges) {
		for (const to of tos) {
			const st = effectivePages.get(to)?.status;
			if (typeof st === 'number' && st >= 400) brokenLinks.push({ from, to, status: st });
		}
	}

	const qa = (() => {
		const esLocaleLinkViolations = [];
		for (const [from, tos] of effectiveEdges) {
			if (!String(from || '').startsWith('/es/docs/')) continue;
			for (const to of tos || []) {
				if (String(to || '').startsWith('/docs/')) {
					esLocaleLinkViolations.push({ from, to });
				}
			}
		}

		const enListingBase = '/docs/propertylist-mls-user-manual/listings/';
		const esListingBase = '/es/docs/propertylist-mls-manual-de-usuario/listings/';
		const enListings = docsPaths.filter((p) => String(p || '').startsWith(enListingBase));
		const mapToEs = (p) => String(p || '').replace('/docs/propertylist-mls-user-manual/', '/es/docs/propertylist-mls-manual-de-usuario/');
		const esMissingListings = enListings
			.map((p) => ({ en: p, es: mapToEs(p) }))
			.filter(({ es }) => !docsPaths.includes(es));

		return {
			esLocaleLinkViolations,
			esMissingListings,
			esEnglishPages: [],
			admin: null,
			esBackendEnglishPages: [],
		};
	})();

	if (FAIL) {
		const esCandidates = docsPaths.filter((p) => String(p || '').startsWith('/es/docs/'));
		const esEnglishPages = [];
		for (const p of esCandidates) {
			const url = `${PROD_ORIGIN}${p}${p.includes('?') ? '&' : '?'}client=1`;
			let text = '';
			try {
				const out = await fetchText(url);
				text = out.text || '';
			} catch {
				continue;
			}
			const main = extractMainFromHtml(text);
			const headings = extractHeadingsHtml(main).join('\n');
			const headingEnglish = looksEnglish(headings);
			const bodyEnglish = looksEnglish(main);
			if (headingEnglish || bodyEnglish) esEnglishPages.push({ path: p, headingEnglish, bodyEnglish });
		}
		qa.esEnglishPages = esEnglishPages;
	}

	if (ADMIN_AUDIT && adminAuth && adminDocsMeta.length) {
		const byPathLang = new Map();
		const byPathAny = new Map();
		const languagePathMismatches = [];

		for (const it of adminDocsMeta) {
			const p = String(it.path || '');
			const lang = String(it.language || '');
			const key = `${lang}::${p}`;
			byPathLang.set(key, [...(byPathLang.get(key) || []), it]);
			byPathAny.set(p, [...(byPathAny.get(p) || []), it]);

			if (p.startsWith('/es/docs/') && lang !== 'es') languagePathMismatches.push({ id: it.id, path: p, language: lang, status: it.status });
			if (p.startsWith('/docs/') && lang !== 'en') languagePathMismatches.push({ id: it.id, path: p, language: lang, status: it.status });
		}

		const duplicatesByPathLang = [...byPathLang.entries()]
			.filter(([, list]) => list.length > 1)
			.map(([key, list]) => ({ key, count: list.length, items: list.map((x) => ({ id: x.id, path: x.path, language: x.language, status: x.status })) }));
		const duplicatesByPath = [...byPathAny.entries()]
			.filter(([, list]) => list.length > 1)
			.map(([key, list]) => ({ path: key, count: list.length, items: list.map((x) => ({ id: x.id, language: x.language, status: x.status })) }));

		const enDocs = adminDocsMeta.filter((it) => String(it.language || '') === 'en' && String(it.path || '').startsWith('/docs/'));
		const esDocs = adminDocsMeta.filter((it) => String(it.language || '') === 'es' && String(it.path || '').startsWith('/es/docs/'));
		const esPaths = new Set(esDocs.map((x) => String(x.path || '')).filter(Boolean));
		const enPaths = new Set(enDocs.map((x) => String(x.path || '')).filter(Boolean));

		const missingEsFromEn = enDocs
			.map((it) => ({ en: String(it.path || ''), es: mapDocsEnglishToSpanishPath(String(it.path || '')) }))
			.filter((x) => x.es && !esPaths.has(x.es));
		const missingEnFromEs = esDocs
			.map((it) => ({ es: String(it.path || ''), en: mapDocsSpanishToEnglishPath(String(it.path || '')) }))
			.filter((x) => x.en && !enPaths.has(x.en));

		const manualSlugMismatches = [];
		for (const it of adminDocsMeta) {
			const p = String(it.path || '');
			if (!p.startsWith('/es/docs/')) continue;
			const parts = p.split('/').filter(Boolean);
			const manual = parts[2] || '';
			if (manual === 'propertylist-mls-user-manual' || manual === 'laws-procedures' || manual === 'public-portal' || manual === 'getting-started') {
				manualSlugMismatches.push({ id: it.id, path: p, language: it.language, status: it.status, manualSlug: manual });
			}
		}

		qa.admin = {
			docsItems: adminDocsMeta.length,
			enDocs: enDocs.length,
			esDocs: esDocs.length,
			duplicatesByPathLangCount: duplicatesByPathLang.length,
			duplicatesByPathCount: duplicatesByPath.length,
			languagePathMismatchesCount: languagePathMismatches.length,
			missingEsFromEnCount: missingEsFromEn.length,
			missingEnFromEsCount: missingEnFromEs.length,
			manualSlugMismatchesCount: manualSlugMismatches.length,
			duplicatesByPathLang,
			duplicatesByPath,
			languagePathMismatches,
			missingEsFromEn,
			missingEnFromEs,
			manualSlugMismatches,
		};

		const esBackendEnglishPages = [];
		const esWithBodies = esDocs.slice(0, 20000);
		const fetchQueue = [...esWithBodies];
		const concurrency = 10;
		const workers = Array.from({ length: concurrency }, () => (async () => {
			while (fetchQueue.length) {
				const it = fetchQueue.shift();
				if (!it) break;
				let page = null;
				try {
					page = await getAdminKbPageById(adminAuth, it.id);
				} catch {
					continue;
				}
				const body = String(page?.body || '');
				const title = String(page?.title || '');
				const description = String(page?.description || '');
				const bodyLooksEnglish = body ? looksEnglish(body) : false;
				const titleLooksEnglish = title ? looksEnglish(title) : false;
				const descLooksEnglish = description ? looksEnglish(description) : false;
				const bodyEmpty = !body || normaliseText(body).length < 40;
				if (bodyLooksEnglish || titleLooksEnglish || descLooksEnglish || bodyEmpty) {
					const snippet = normaliseText(body).slice(0, 220);
					esBackendEnglishPages.push({
						id: String(page?.id || it.id),
						path: String(page?.path || it.path || ''),
						status: String(page?.status || it.status || ''),
						title,
						flags: { bodyLooksEnglish, titleLooksEnglish, descLooksEnglish, bodyEmpty },
						snippet,
					});
				}
			}
		})());
		await Promise.all(workers);
		qa.esBackendEnglishPages = esBackendEnglishPages.sort((a, b) => String(a.path).localeCompare(String(b.path)));
		qa.esBackendEnglishPagesCount = qa.esBackendEnglishPages.length;
	}

	const report = {
		generatedAt,
		origin: PROD_ORIGIN,
		sitemap: { url: `${PROD_ORIGIN}${SITEMAP_PATH}`, status: smRes ? smRes.status : null },
		inventory: {
			source: docsPathsFromSitemap.length ? 'sitemap' : adminDocsPaths.length ? 'admin' : 'crawl',
			adminDocsUrls: adminDocsPaths.length,
		},
		counts: {
			sitemapDocsUrls: docsPaths.length,
			sitemapDuplicateGroups: sitemapDuplicates.length,
			crawledPages: effectivePages.size,
			reachableDocsPages: reachable.size,
			orphanDocsPages: orphans.length,
			redirectsSeen: effectiveRedirects.length,
			brokenPagesSeen: effectiveBroken.length,
			brokenLinksSeen: brokenLinks.length,
		},
		sitemapDuplicates,
		orphanDocsPages: orphans,
		redirects: effectiveRedirects,
		brokenPages: effectiveBroken,
		brokenLinks,
		qa,
	};

	await fs.mkdir(outDir, { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
	const hasQaIssues = Boolean(
		report.counts.sitemapDuplicateGroups ||
			report.counts.brokenPagesSeen ||
			report.counts.brokenLinksSeen,
	);
	process.stdout.write(`${JSON.stringify({ ok: !FAIL || !hasQaIssues, outPath, counts: report.counts, qa: { hasQaIssues } })}\n`);
	if (FAIL && hasQaIssues) process.exit(2);
};

main().catch((e) => {
	process.stderr.write(`${String(e?.stack || e)}\n`);
	process.exit(1);
});
