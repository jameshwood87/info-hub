const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const id = process.argv[2] || '';
if (!id) {
	process.stdout.write('usage: node scripts/check-translation-es.mjs <id>\n');
	process.exit(2);
}

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
	if (!cookie) throw new Error('no_cookies_from_login');

	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}/translation-es`, {
		headers: { cookie },
	});
	const text = await res.text();
	process.stdout.write(`status ${res.status}\n`);
	process.stdout.write(`${text}\n`);
	process.stdout.write(`csrf ${(ljson && ljson.csrfToken) || ''}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

