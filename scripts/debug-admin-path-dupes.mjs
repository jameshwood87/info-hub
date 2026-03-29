const targetPath = process.argv[2];
if (!targetPath) {
	process.stderr.write('missing_path\n');
	process.exit(1);
}

const origin = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const password = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const normalisePath = (p) => {
	const s = String(p || '').trim();
	if (!s) return null;
	const pn = s.replace(/\/{2,}/g, '/');
	return pn.endsWith('/') ? pn : `${pn}/`;
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

const main = async () => {
	if (!password) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');
	const login = await fetch(`${origin}/api/admin/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password }),
	});
	const loginJson = await login.json().catch(() => null);
	if (!login.ok || !loginJson?.ok) throw new Error(`login_failed ${login.status}`);
	const cookie = parseCookieHeader(login);

	const prefixes = ['/docs/', '/es/docs/'].map(encodeURIComponent).join(',');
	const res = await fetch(`${origin}/api/admin/kb-pages?prefixes=${prefixes}&status=any&limit=20000&bucket=all`, {
		headers: { cookie },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);

	const nTarget = normalisePath(targetPath);
	const hits = json.items
		.map((it) => ({
			id: it.id,
			status: it.status,
			lang: it.language,
			path: normalisePath(it.path),
			title: it.title,
		}))
		.filter((it) => it.path === nTarget);

	process.stdout.write(JSON.stringify({ target: nTarget, count: hits.length, hits }, null, 2));
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
