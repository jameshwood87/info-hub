import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const LIMIT = Math.max(1, Math.min(20000, Number(process.env.LIMIT || 5000)));
const OUT_PATH =
	process.env.OUT_PATH || path.join(process.cwd(), 'reports', 'mls-manual-structure-audit.json');
const ARCHIVE_PATH = path.join(process.cwd(), 'src', 'data', 'mls-manual-archive.json');

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
		description: it?.description ?? null,
		date_created: it?.date_created || null,
		date_updated: it?.date_updated || null,
	}));
};

const extractTitleFromArchiveBody = (html) => {
	const src = String(html || '');
	const pick = (re) => {
		const m = src.match(re);
		if (!m) return '';
		const inner = String(m[1] || '');
		const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
		return cleanTitle(text);
	};
	return pick(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || pick(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || '';
};

const audit = async () => {
	const auth = await loginAdmin();
	const base = '/docs/propertylist-mls-user-manual/';

	const directus = await adminListPages(auth, [base], 'en');
	let archivePages = {};
	try {
		const raw = await fs.readFile(ARCHIVE_PATH, 'utf8');
		const parsed = JSON.parse(raw || 'null');
		archivePages = (parsed && parsed.pages) || {};
	} catch {
		archivePages = {};
	}
	const archive = Object.entries(archivePages)
		.map(([p, v]) => {
			const path = normalisePath(String(p || ''));
			if (!path.startsWith(base)) return null;
			const body = String(v?.body || '');
			const title = extractTitleFromArchiveBody(body);
			return { path, title: cleanTitle(title || ''), hasBody: Boolean(body.trim()) };
		})
		.filter(Boolean);

	const byPath = new Map();
	for (const p of archive) byPath.set(p.path, { source: 'archive', ...p });
	for (const p of directus) byPath.set(p.path, { source: 'directus', ...p });
	const merged = [...byPath.values()];

	const topSeg = (p) => {
		const path = normalisePath(p);
		const rest = path.slice(base.length);
		const parts = rest.split('/').filter(Boolean);
		return parts[0] || '';
	};

	const topLevelCounts = {};
	for (const p of merged) {
		const seg = topSeg(p.path);
		if (!seg) continue;
		topLevelCounts[seg] = (topLevelCounts[seg] || 0) + 1;
	}

	const dupTitles = new Map();
	for (const p of directus) {
		const k = titleKey(p.title);
		if (!k) continue;
		const list = dupTitles.get(k) || [];
		list.push({ id: p.id, path: p.path, title: p.title, status: p.status, date_updated: p.date_updated, date_created: p.date_created });
		dupTitles.set(k, list);
	}
	const duplicateTitleGroups = [...dupTitles.entries()]
		.map(([k, v]) => ({ key: k, count: v.length, pages: v }))
		.filter((g) => g.count > 1)
		.sort((a, b) => b.count - a.count);

	const directusPaths = new Set(directus.map((p) => p.path));
	const archivePaths = new Set(archive.map((p) => p.path));
	const archiveOnly = [...archivePaths].filter((p) => !directusPaths.has(p)).sort();
	const directusOnly = [...directusPaths].filter((p) => !archivePaths.has(p)).sort();

	const report = {
		ok: true,
		generatedAt: new Date().toISOString(),
		origin: ORIGIN,
		base,
		counts: {
			directusPages: directus.length,
			archivePages: archive.length,
			mergedPages: merged.length,
			duplicateTitleGroups: duplicateTitleGroups.length,
			archiveOnly: archiveOnly.length,
			directusOnly: directusOnly.length,
		},
		topLevelCounts,
		duplicateTitleGroups: duplicateTitleGroups.slice(0, 200),
		archiveOnly: archiveOnly.slice(0, 500),
		directusOnly: directusOnly.slice(0, 500),
	};

	await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
	await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
	process.stdout.write(`${JSON.stringify({ ok: true, reportPath: OUT_PATH, counts: report.counts }, null, 2)}\n`);
};

audit().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
