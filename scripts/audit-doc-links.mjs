import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const OUT_DIR = path.join(process.cwd(), 'reports');

const START_PREFIXES = [
	'/docs/propertylist-mls-user-manual/',
	'/es/docs/propertylist-mls-manual-de-usuario/',
];

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const isSameOriginOrRelative = (href) => {
	const h = String(href || '').trim();
	if (!h) return false;
	if (h.startsWith('/')) return true;
	if (h.startsWith(ORIGIN)) return true;
	return false;
};

const toPathIfInternal = (href) => {
	const h = String(href || '').trim();
	if (!h) return '';
	if (h.startsWith('/')) return normalisePath(h);
	if (h.startsWith(ORIGIN)) return normalisePath(h.slice(ORIGIN.length));
	return '';
};

const extractLinks = (html) => {
	const src = String(html || '');
	const out = [];
	const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
	let m;
	while ((m = re.exec(src))) {
		const href = String(m[1] || m[2] || m[3] || '').trim();
		if (!href) continue;
		out.push(href);
	}
	return out;
};

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

const adminListPages = async (auth, prefix, lang) => {
	const url =
		`${ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent(prefix)}` +
		`&bucket=active&status=published&limit=2000&lang=${encodeURIComponent(lang)}`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`admin_list_failed ${res.status}`);
	return Array.isArray(json.items) ? json.items : [];
};

const fetchHtml = async (p) => {
	const safeFetch = async () => {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 20000);
		try {
			const res = await fetch(`${ORIGIN}${p}`, { redirect: 'follow', signal: ctrl.signal });
			const text = await res.text().catch(() => '');
			return { status: res.status, text };
		} finally {
			clearTimeout(t);
		}
	};
	let lastErr = null;
	for (let i = 0; i < 3; i++) {
		try {
			return await safeFetch();
		} catch (e) {
			lastErr = e;
			await new Promise((r) => setTimeout(r, 350 * (i + 1)));
		}
	}
	throw lastErr || new Error('fetch_failed');
};

const checkLink = async (p) => {
	const safeFetch = async () => {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 20000);
		try {
			const res = await fetch(`${ORIGIN}${p}`, { redirect: 'manual', signal: ctrl.signal });
			const status = res.status;
			const location = res.headers.get('location') || '';
			return { status, location };
		} finally {
			clearTimeout(t);
		}
	};
	let lastErr = null;
	for (let i = 0; i < 3; i++) {
		try {
			return await safeFetch();
		} catch (e) {
			lastErr = e;
			await new Promise((r) => setTimeout(r, 350 * (i + 1)));
		}
	}
	return { status: 0, location: '', error: String(lastErr?.message || lastErr || 'fetch_failed') };
};

const main = async () => {
	const auth = await loginAdmin();
	const pages = [];
	for (const prefix of START_PREFIXES) {
		const lang = prefix.startsWith('/es/') ? 'es' : 'en';
		const items = await adminListPages(auth, prefix, lang).catch(() => []);
		for (const it of items) {
			const p = normalisePath(it?.path || '');
			if (p) pages.push({ path: p, title: String(it?.title || ''), lang });
		}
	}

	const byPath = new Map();
	for (const p of pages) if (!byPath.has(p.path)) byPath.set(p.path, p);
	const uniquePages = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));

	const discoveredLinks = new Map();
	const fetchErrors = [];
	for (const page of uniquePages) {
		let html;
		try {
			html = await fetchHtml(page.path);
		} catch (e) {
			fetchErrors.push({ path: page.path, error: String(e?.message || e) });
			continue;
		}
		if (html.status >= 400) continue;
		const hrefs = extractLinks(html.text);
		for (const href of hrefs) {
			if (!isSameOriginOrRelative(href)) continue;
			const linkPath = toPathIfInternal(href);
			if (!linkPath) continue;
			if (!START_PREFIXES.some((pre) => linkPath.startsWith(pre))) continue;
			const entry = discoveredLinks.get(linkPath) || { path: linkPath, from: new Set() };
			entry.from.add(page.path);
			discoveredLinks.set(linkPath, entry);
		}
	}

	const linkList = Array.from(discoveredLinks.values()).map((x) => ({ path: x.path, from: Array.from(x.from) }));
	linkList.sort((a, b) => a.path.localeCompare(b.path));

	const results = [];
	for (const link of linkList) {
		const r = await checkLink(link.path);
		results.push({ path: link.path, status: r.status, location: r.location, from: link.from });
	}

	const broken = results.filter((r) => r.status === 404);
	const redirected = results.filter((r) => r.status >= 300 && r.status < 400);
	const ok = results.filter((r) => r.status >= 200 && r.status < 300);

	await fs.mkdir(OUT_DIR, { recursive: true });
	const out = {
		ok: true,
		origin: ORIGIN,
		at: new Date().toISOString(),
		pages: { total: uniquePages.length },
		links: { total: results.length, ok: ok.length, redirected: redirected.length, notFound: broken.length },
		fetchErrors,
		broken,
		redirected: redirected.slice(0, 200),
	};
	const outPath = path.join(OUT_DIR, 'doc-link-audit.json');
	await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
	process.stdout.write(`${JSON.stringify(out.links, null, 2)}\n`);
	process.stdout.write(`wrote ${outPath}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
