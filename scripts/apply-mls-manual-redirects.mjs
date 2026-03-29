import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const APPLY = String(process.env.APPLY || '').trim() === '1';
const LIMIT = Math.max(1, Math.min(20000, Number(process.env.LIMIT || 5000)));
const OUT_PATH =
	process.env.OUT_PATH || path.join(process.cwd(), 'reports', 'mls-manual-redirects.json');

const base = '/docs/propertylist-mls-user-manual/';

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const decodeHtmlEntities = (s) =>
	String(s || '')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&nbsp;', ' ');

const cleanTitle = (t) =>
	decodeHtmlEntities(String(t || '').replace(/\s*•\s*PropertyList Info Hub\s*$/i, '').trim());

const titleKey = (t) =>
	cleanTitle(t)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const parseCookieHeader = (res) => {
	const getSetCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	const rawHeader = res.headers.get('set-cookie') || '';
	const rawList = getSetCookie.length
		? getSetCookie
		: rawHeader
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
	return rawList.map((s) => String(s).split(';')[0]).join('; ');
};

const loginAdmin = async () => {
	if (!PASSWORD) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');
	const res = await fetch(`${ORIGIN}/api/admin/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password: PASSWORD }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.csrfToken) throw new Error(`admin_login_failed ${res.status}`);
	return { cookie: parseCookieHeader(res), csrf: String(json.csrfToken) };
};

const adminListPages = async (auth, prefixes, lang) => {
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${prefixes.map(encodeURIComponent).join(',')}&status=any&bucket=all&limit=${encodeURIComponent(String(LIMIT))}${
		lang ? `&lang=${encodeURIComponent(lang)}` : ''
	}`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status}`);
	return json.items.map((it) => ({
		id: String(it?.id || ''),
		path: normalisePath(String(it?.path || '')),
		language: String(it?.language || ''),
		status: String(it?.status || ''),
		title: cleanTitle(it?.title || ''),
	}));
};

const postBulkRedirects = async (auth, mappings) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-redirects/bulk`, {
		method: 'POST',
		headers: {
			cookie: auth.cookie,
			'x-csrf-token': auth.csrf,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ mappings }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`bulk_redirect_failed ${res.status} ${(json && json.error) || ''}`);
	return json;
};

const listRedirects = async (auth) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-redirects`, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.redirects)) throw new Error(`list_redirects_failed ${res.status}`);
	return json.redirects;
};

const removeRedirect = async (auth, from) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-redirects`, {
		method: 'DELETE',
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' },
		body: JSON.stringify({ from }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`remove_redirect_failed ${res.status}`);
	return json;
};

const legacyPrefixes = [
	'/docs/propertylist-mls-user-manual/listings/',
	'/docs/propertylist-mls-user-manual/search/',
	'/docs/propertylist-mls-user-manual/marketing/',
	'/docs/propertylist-mls-user-manual/leads/',
	'/docs/propertylist-mls-user-manual/contacts/',
	'/docs/propertylist-mls-user-manual/calendar/',
	'/docs/propertylist-mls-user-manual/pipeline/',
	'/docs/propertylist-mls-user-manual/integrations/',
	'/docs/propertylist-mls-user-manual/reports/',
	'/docs/propertylist-mls-user-manual/support/',
	'/docs/propertylist-mls-user-manual/faq-mls-crm/',
	'/docs/propertylist-mls-user-manual/ai-and-automation/',
	'/docs/propertylist-mls-user-manual/ai-automation/',
	'/docs/propertylist-mls-user-manual/verified-agencies/',
	'/docs/propertylist-mls-user-manual/how-to-use-contacts/',
	'/docs/propertylist-mls-user-manual/how-to-use-the-calendar/',
];

const isLegacy = (p) => legacyPrefixes.some((pref) => String(p || '').startsWith(pref));

const main = async () => {
	const auth = await loginAdmin();
	const redirectsBefore = await listRedirects(auth).catch(() => []);
	const badFrom = `${base}listing-a-property/`;
	const hasBad = Array.isArray(redirectsBefore) && redirectsBefore.some((r) => normalisePath(r?.from || '') === normalisePath(badFrom));
	let removedBad = null;
	if (APPLY && hasBad) {
		removedBad = await removeRedirect(auth, badFrom).catch((e) => ({ ok: false, error: String(e?.message || e) }));
	}

	const all = await adminListPages(auth, [base], 'en');
	const underBase = all.filter((p) => p.path.startsWith(base));

	const published = underBase.filter((p) => p.status === 'published');
	const byTitle = new Map();
	for (const p of published) {
		const k = titleKey(p.title);
		if (!k) continue;
		if (!byTitle.has(k)) byTitle.set(k, []);
		byTitle.get(k).push(p);
	}

	const mappings = [];
	const reasons = [];

	for (const p of underBase) {
		if (p.status === 'published') continue;
		if (!isLegacy(p.path)) continue;
		const k = titleKey(p.title);
		if (!k) continue;
		const matches = byTitle.get(k) || [];
		const best = matches.find((x) => x.path !== p.path) || null;
		if (!best) continue;
		mappings.push({ from: p.path, to: best.path });
		reasons.push({ from: p.path, to: best.path, title: p.title, reason: 'same_title_published' });
	}

	const deduped = Array.from(
		new Map(mappings.map((m) => [normalisePath(m.from), { from: normalisePath(m.from), to: normalisePath(m.to) }])).values(),
	).filter((m) => m.from !== m.to);

	let applied = null;
	if (APPLY && deduped.length) {
		applied = await postBulkRedirects(auth, deduped);
	}

	const report = {
		ok: true,
		apply: APPLY,
		generatedAt: new Date().toISOString(),
		origin: ORIGIN,
		fixes: { removedListingAPropertyRedirect: removedBad },
		counts: {
			totalUnderBase: underBase.length,
			published: published.length,
			candidateLegacyDrafts: underBase.filter((p) => p.status !== 'published' && isLegacy(p.path)).length,
			mappings: deduped.length,
		},
		mappings: deduped.slice(0, 5000),
		sampleReasons: reasons.slice(0, 200),
		applied,
	};

	await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
	await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
	process.stdout.write(`${JSON.stringify({ ok: true, outPath: OUT_PATH, counts: report.counts }, null, 2)}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
