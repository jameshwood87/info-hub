import fs from 'node:fs/promises';
import path from 'node:path';

const PROD_ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const STAGING_ORIGIN = process.env.INFO_HUB_STAGING_ORIGIN || 'https://info-staging.propertylist.es';

const ADMIN_PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const TEST_UPLOAD_URL = String(process.env.TEST_UPLOAD_URL || '').trim();

const STAGING_BASE = '/docs/propertylist-mls-user-manual/';
const PROD_BASE = '/docs/propertylist-mls-user-manual/';

const projectRoot = path.resolve(process.cwd());
const outDir = path.join(projectRoot, 'reports');
const outPath = path.join(outDir, 'mls-manual-migration-log.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url, opts = {}) => {
	const res = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(60000),
		headers: { 'User-Agent': 'PropertyList-InfoHub-Migrator/1.0', Accept: 'text/html,application/xhtml+xml,*/*' },
		...opts,
	});
	const text = await res.text().catch(() => '');
	return { res, text };
};

const fetchBinary = async (url, opts = {}) => {
	const res = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(60000),
		headers: { 'User-Agent': 'PropertyList-InfoHub-Migrator/1.0', Accept: '*/*' },
		...opts,
	});
	const buf = Buffer.from(await res.arrayBuffer());
	return { res, buf };
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
	const pn = String(u.pathname || '/').replace(/\/{2,}/g, '/');
	const looksLikeFile = /\/[^/]+\.[a-z0-9]{1,8}$/i.test(pn);
	if (looksLikeFile) return pn;
	return pn.endsWith('/') ? pn : `${pn}/`;
};

const uniq = (arr) => Array.from(new Set(arr));

const extractHrefs = (html, origin) => {
	const out = [];
	const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	let m = null;
	while ((m = re.exec(String(html || '')))) {
		const href = String(m[1] || m[2] || m[3] || '').trim();
		if (!href) continue;
		if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
		let url;
		try {
			url = new URL(href, origin);
		} catch {
			continue;
		}
		if (url.origin !== new URL(origin).origin) continue;
		out.push(url.pathname + (url.search || '') + (url.hash || ''));
	}
	return out;
};

const extractSrcs = (html, origin) => {
	const out = [];
	const re = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	let m = null;
	while ((m = re.exec(String(html || '')))) {
		const src = String(m[1] || m[2] || m[3] || '').trim();
		if (!src) continue;
		if (src.startsWith('data:')) continue;
		let url;
		try {
			url = new URL(src, origin);
		} catch {
			continue;
		}
		out.push(url.toString());
	}
	return out;
};

const pickFirst = (html, patterns) => {
	for (const re of patterns) {
		const m = String(html || '').match(re);
		if (!m) continue;
		if (m[1]) return m[1];
		if (m[0]) return m[0];
	}
	return null;
};

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ');
const tidyText = (s) =>
	stripTags(s)
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const removeCruft = (html) => {
	let out = String(html || '');
	out = out
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<(meta|link)\b[^>]*>/gi, '')
		.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<form\b[\s\S]*?<\/form>/gi, '')
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
	return out;
};

const extractMainBody = (html) => {
	const raw = String(html || '');
	const candidate =
		pickFirst(raw, [/<article\b[\s\S]*?<\/article>/i, /<main\b[\s\S]*?<\/main>/i]) ||
		pickFirst(raw, [/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]) ||
		raw;
	let body = removeCruft(candidate);
	const entry = pickFirst(body, [/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]);
	if (entry && tidyText(entry).length >= 40) body = entry;
	body = body.trim();
	return tidyText(body).length >= 20 ? body : null;
};

const extractTitle = (html) => {
	const raw = String(html || '');
	const h1 = pickFirst(raw, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]);
	if (h1 && tidyText(h1)) return tidyText(h1);
	const t = pickFirst(raw, [/<title\b[^>]*>([\s\S]*?)<\/title>/i]);
	if (t && tidyText(t)) return tidyText(t).replace(/\s*(?:•|-)\s*PropertyList Info Hub\s*$/i, '').trim();
	return '';
};

const canonicaliseStagingPathToProd = (p) => {
	const pn = normalisePath(p);
	if (!pn) return null;
	if (!pn.startsWith(STAGING_BASE)) return null;
	let rest = pn.slice(STAGING_BASE.length);
	if (rest.startsWith('mls-user-manual/')) rest = `your-account/${rest.slice('mls-user-manual/'.length)}`;
	if (rest.startsWith('microsite-share-properties-listings/')) rest = `microsite-share/${rest.slice('microsite-share-properties-listings/'.length)}`;
	const out = `${PROD_BASE}${rest}`;
	return normalisePath(out);
};

const enToEsPath = (enPath) => {
	const p = normalisePath(enPath);
	if (!p) return null;
	if (!p.startsWith('/docs/')) return `/es${p}`;
	const parts = p.split('/').filter(Boolean);
	const seg = parts[1] || '';
	if (seg === 'propertylist-mls-user-manual') parts[1] = 'propertylist-mls-manual-de-usuario';
	return `/es/${parts.join('/')}/`;
};

const rewriteInternalLinks = (html, mapPath) => {
	let out = String(html || '');
	out = out.replace(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, quoted, d1, d2) => {
		const raw = String(d1 || d2 || '').trim();
		if (!raw) return full;
		let url;
		try {
			url = new URL(raw, STAGING_ORIGIN);
		} catch {
			return full;
		}
		if (url.origin === new URL(STAGING_ORIGIN).origin && url.pathname.startsWith(STAGING_BASE)) {
			const mapped = mapPath(url.pathname);
			if (!mapped) return full;
			return `href="${mapped}"`;
		}
		if (url.origin === new URL(PROD_ORIGIN).origin && url.pathname.startsWith(PROD_BASE)) {
			const mapped = mapPath(url.pathname);
			if (!mapped) return full;
			return `href="${mapped}"`;
		}
		return full;
	});
	return out;
};

const looksLikeAttachment = (url) => {
	const p = String(new URL(url).pathname || '').toLowerCase();
	return /\.(png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|pptx?|zip)$/i.test(p);
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
	const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	const rawHeader = res.headers.get('set-cookie') || '';
	const rawList = setCookie.length
		? setCookie
		: rawHeader
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
	const cookieHeader = rawList.map((s) => String(s).split(';')[0]).join('; ');
	return { cookieHeader, csrfToken: String(json.csrfToken) };
};

const adminJson = async (auth, url, init) => {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers || {}),
			cookie: auth.cookieHeader,
			'x-csrf-token': auth.csrfToken,
			'content-type': 'application/json',
		},
	});
	const text = await res.text().catch(() => '');
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	if (!res.ok) throw new Error(`admin_request_failed ${res.status} ${text.slice(0, 300)}`);
	return json;
};

const listAllDocsPages = async (auth) => {
	const url = `${PROD_ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent('/docs/')},${encodeURIComponent('/es/docs/')}&status=any&limit=20000&bucket=all`;
	const res = await fetch(url, { headers: { cookie: auth.cookieHeader } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);
	return json.items;
};

const bulkAction = async (auth, action, ids) => {
	const batches = [];
	for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
	const results = [];
	for (const b of batches) {
		if (DRY_RUN) {
			results.push(...b.map((id) => ({ id, ok: true, action, dryRun: true })));
			continue;
		}
		const json = await adminJson(auth, `${PROD_ORIGIN}/api/admin/kb-pages/bulk`, {
			method: 'POST',
			body: JSON.stringify({ action, ids: b }),
		});
		if (!json?.ok || !Array.isArray(json.results)) throw new Error('bulk_purge_failed');
		results.push(...json.results);
		await sleep(350);
	}
	return results;
};

const patchKbPage = async (auth, id, patch) => {
	if (DRY_RUN) return { ok: true, id, dryRun: true };
	const res = await fetch(`${PROD_ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id || ''))}`, {
		method: 'PATCH',
		headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken, 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.item?.id) throw new Error(`patch_failed ${res.status}`);
	return json.item;
};

const createKbPage = async (auth, page) => {
	if (DRY_RUN) return { ok: true, dryRun: true };
	const json = await adminJson(auth, `${PROD_ORIGIN}/api/admin/kb-pages`, {
		method: 'POST',
		body: JSON.stringify({ scope: 'docs', page }),
	});
	if (!json?.ok || !json?.item?.id) throw new Error('create_failed');
	return json.item;
};

const uploadFile = async (auth, url) => {
	const { res, buf } = await fetchBinary(url);
	if (!res.ok) throw new Error(`download_failed ${res.status} ${url}`);
	const contentType = res.headers.get('content-type') || 'application/octet-stream';
	const pathname = new URL(url).pathname;
	const name = pathname.split('/').filter(Boolean).pop() || 'file';
	if (DRY_RUN) return { ok: true, url };
	const form = new FormData();
	form.set('file', new File([buf], name, { type: contentType }));
	const up = await fetch(`${PROD_ORIGIN}/api/admin/upload`, {
		method: 'POST',
		headers: {
			cookie: auth.cookieHeader,
			'x-csrf-token': auth.csrfToken,
			Origin: PROD_ORIGIN,
			Referer: `${PROD_ORIGIN}/admin/docs`,
		},
		body: form,
	});
	const text = await up.text().catch(() => '');
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	if (!up.ok || !json?.ok || !json?.url) throw new Error(`upload_failed ${up.status} ${String(json?.error || text).slice(0, 120)} ${url}`);
	return { ok: true, url: String(json.url) };
};

const replaceAssetUrls = (html, replacements) => {
	let out = String(html || '');
	for (const [from, to] of replacements.entries()) {
		out = out.split(from).join(to);
	}
	return out;
};

const main = async () => {
	const startedAt = new Date().toISOString();
	if (TEST_UPLOAD_URL) {
		const auth = await loginAdmin();
		const up = await uploadFile(auth, TEST_UPLOAD_URL);
		process.stdout.write(`${JSON.stringify({ ok: true, uploaded: up })}\n`);
		return;
	}

	const { res: indexRes, text: indexHtml } = await fetchText(`${STAGING_ORIGIN}${STAGING_BASE}`);
	if (!indexRes.ok) throw new Error(`staging_index_failed ${indexRes.status}`);

	const stagingLinks = uniq(
		extractHrefs(indexHtml, STAGING_ORIGIN)
			.map(normalisePath)
			.filter(Boolean)
			.filter((p) => p.startsWith(STAGING_BASE)),
	).sort();

	const canonicalBySource = new Map();
	const sourcesByCanonical = new Map();
	for (const sp of stagingLinks) {
		const canonical = canonicaliseStagingPathToProd(sp);
		if (!canonical) continue;
		canonicalBySource.set(sp, canonical);
		const list = sourcesByCanonical.get(canonical) || [];
		list.push(sp);
		sourcesByCanonical.set(canonical, list);
	}

	const duplicates = [...sourcesByCanonical.entries()]
		.filter(([, srcs]) => srcs.length > 1)
		.map(([canonical, srcs]) => ({ canonical, sources: srcs }));

	const canonicalPaths = [...sourcesByCanonical.keys()].sort();
	const keepSet = new Set([...canonicalPaths, ...canonicalPaths.map((p) => enToEsPath(p)).filter(Boolean)]);

	const auth = await loginAdmin();

	const existingByKey = new Map();
	{
		const existing = await listAllDocsPages(auth);
		for (const it of existing) {
			const p = normalisePath(String(it?.path || ''));
			const lang = String(it?.language || '');
			const id = String(it?.id || '');
			if (!p || !id || (lang !== 'en' && lang !== 'es')) continue;
			existingByKey.set(`${lang}:${p}`, { id, status: String(it?.status || '') });
		}
	}

	const created = [];
	const updated = [];
	const assetUploads = [];
	const failed = [];

	for (let i = 0; i < canonicalPaths.length; i++) {
		const prodPath = canonicalPaths[i];
		const source = sourcesByCanonical.get(prodPath)?.[0] || null;
		if (!source) continue;

		process.stdout.write(`[${i + 1}/${canonicalPaths.length}] ${source} -> ${prodPath}\n`);

		try {
			const { res, text } = await fetchText(`${STAGING_ORIGIN}${source}`);
			if (!res.ok) throw new Error(`fetch_failed ${res.status}`);

			const title = extractTitle(text) || prodPath;
			let body = extractMainBody(text);
			if (!body) throw new Error('body_missing');

			body = rewriteInternalLinks(body, (p) => canonicaliseStagingPathToProd(p) || p);

			const srcs = uniq(extractSrcs(body, STAGING_ORIGIN).filter(Boolean));
			const hrefs = uniq(
				extractHrefs(body, STAGING_ORIGIN)
					.map((h) => {
						try {
							return new URL(h, STAGING_ORIGIN).toString();
						} catch {
							return null;
						}
					})
					.filter(Boolean),
			);
			const assetUrls = uniq([...srcs, ...hrefs]).filter((u) => {
				try {
					const url = new URL(u);
					return url.origin === new URL(STAGING_ORIGIN).origin && looksLikeAttachment(url.toString());
				} catch {
					return false;
				}
			});

			const replacements = new Map();
			for (const assetUrl of assetUrls) {
				try {
					const up = await uploadFile(auth, assetUrl);
					replacements.set(assetUrl, up.url);
					assetUploads.push({ from: assetUrl, to: up.url, ok: true });
				} catch (e) {
					assetUploads.push({ from: assetUrl, to: null, ok: false, error: String(e?.message || e) });
				}
				await sleep(120);
			}
			body = replaceAssetUrls(body, replacements);

			const pageEn = {
				status: 'published',
				language: 'en',
				path: prodPath,
				title,
				description: null,
				body,
				seo_title: `${title} • PropertyList Info Hub`,
				seo_description: null,
			};
			const existingEn = existingByKey.get(`en:${prodPath}`);
			const enItem = existingEn ? await patchKbPage(auth, existingEn.id, pageEn) : await createKbPage(auth, pageEn);

			const esPath = enToEsPath(prodPath);
			const pageEs = { ...pageEn, language: 'es', path: esPath };
			const existingEs = existingByKey.get(`es:${esPath}`) || existingByKey.get(`es:/es${prodPath}`);
			const esItem = existingEs ? await patchKbPage(auth, existingEs.id, pageEs) : await createKbPage(auth, pageEs);

			if (existingEn || existingEs) {
				updated.push({ source, path: prodPath, enId: enItem.id || null, esId: esItem.id || null });
			} else {
				created.push({ source, path: prodPath, enId: enItem.id || null, esId: esItem.id || null });
			}
		} catch (e) {
			failed.push({ source, path: prodPath, error: String(e?.message || e) });
		}

		await sleep(450);
	}

	const trashResults = await (async () => {
		const refreshed = await listAllDocsPages(auth);
		const ids = [];
		for (const it of refreshed) {
			const p = normalisePath(String(it?.path || ''));
			const id = String(it?.id || '');
			if (!p || !id) continue;
			if ((p.startsWith('/docs/') || p.startsWith('/es/docs/')) && !keepSet.has(p)) ids.push(id);
		}
		return ids.length ? await bulkAction(auth, 'trash', ids) : [];
	})();

	const finishedAt = new Date().toISOString();
	const report = {
		startedAt,
		finishedAt,
		prodOrigin: PROD_ORIGIN,
		stagingOrigin: STAGING_ORIGIN,
		dryRun: DRY_RUN,
		counts: {
			stagingDiscovered: stagingLinks.length,
			canonicalPages: canonicalPaths.length,
			duplicateGroups: duplicates.length,
			existingDocsTrashed: trashResults.filter((r) => r.ok).length,
			createdPairs: created.length,
			updatedPairs: updated.length,
			failedPages: failed.length,
			assetUploads: assetUploads.length,
			assetUploadFailures: assetUploads.filter((a) => !a.ok).length,
		},
		duplicates,
		trashed: trashResults,
		created,
		updated,
		failed,
		assetUploads,
		canonicalBySource: Object.fromEntries([...canonicalBySource.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
	};

	await fs.mkdir(outDir, { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
	process.stdout.write(`${JSON.stringify({ ok: true, outPath, counts: report.counts })}\n`);
};

main().catch((e) => {
	process.stderr.write(`${String(e?.stack || e)}\n`);
	process.exit(1);
});
