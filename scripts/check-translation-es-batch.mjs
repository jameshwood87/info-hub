const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

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
	if (!PASSWORD) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');

	const login = await fetch(`${ORIGIN}/api/admin/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password: PASSWORD }),
	});
	const ljson = await login.json().catch(() => null);
	const cookie = parseCookieHeader(login);
	const csrf = String(ljson?.csrfToken || '');
	if (!cookie || !csrf) throw new Error('login_failed');

	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/translation-es-batch`, {
		method: 'POST',
		headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
		body: JSON.stringify({
			items: [
				{
					path: '/docs/propertylist-mls-user-manual/credits/referrals/',
					language: 'en',
				},
			],
		}),
	});
	process.stdout.write(`status ${res.status}\n`);
	process.stdout.write(`${await res.text()}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

