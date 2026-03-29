const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const from = process.argv[2] || '';
const to = process.argv[3] || '';
if (!from || !to) {
	process.stdout.write('usage: node scripts/add-kb-redirect.mjs <fromPath> <toPath>\n');
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

const main = async () => {
	const auth = await loginAdmin();
	const res = await fetch(`${ORIGIN}/api/admin/kb-redirects/bulk`, {
		method: 'POST',
		headers: {
			cookie: auth.cookie,
			'x-csrf-token': auth.csrf,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ mappings: [{ from, to }] }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`add_redirect_failed ${res.status} ${(json && json.error) || ''}`);
	process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

