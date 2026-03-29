const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const rawPath = process.argv[2] || '';
if (!rawPath) {
	process.stdout.write('usage: node scripts/find-kb-page.mjs </docs/.../>\n');
	process.exit(2);
}

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
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

const adminListPrefix = async (auth, prefix, lang) => {
	const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : '';
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent(prefix)}&status=any&bucket=all&limit=2000${langParam}`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`admin_list_failed ${res.status}`);
	return Array.isArray(json.items) ? json.items : [];
};

const publicFetch = async (url) => {
	const res = await fetch(url, { redirect: 'manual' });
	return { status: res.status, location: res.headers.get('location') || '' };
};

const main = async () => {
	const p = normalisePath(rawPath);
	const prefix = p.replace(/[^/]+\/$/, '');
	const auth = await loginAdmin();
	const langs = [null, 'en', 'es'];
	const scans = [];
	for (const lang of langs) {
		const items = await adminListPrefix(auth, prefix, lang);
		const hits = items
			.filter((it) => normalisePath(it?.path) === p || normalisePath(it?.path) === normalisePath(p.slice(0, -1)))
			.map((it) => ({ id: it.id, path: it.path, status: it.status, language: it.language, title: it.title }));
		const sample = items
			.slice(0, 20)
			.map((it) => ({ id: it.id, status: it.status, language: it.language, path: it.path, title: it.title }));
		scans.push({ lang, count: items.length, hits, sample });
	}

	const pub = await publicFetch(`${ORIGIN}${p}`);

	process.stdout.write(
		`${JSON.stringify(
			{
				ok: true,
				origin: ORIGIN,
				path: p,
				adminScans: scans,
				public: pub,
			},
			null,
			2,
		)}\n`,
	);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
