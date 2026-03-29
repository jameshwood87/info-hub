const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const id = process.argv[2];
const patchArg = process.argv[3];
const extraArgs = process.argv.slice(4);
if (!id || !patchArg) {
	process.stderr.write('usage: node scripts/admin-patch-kbpage.mjs <id> <jsonPatch | key=value...>\n');
	process.exit(1);
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
	const loginJson = await login.json().catch(() => null);
	if (!login.ok || !loginJson?.ok || !loginJson?.csrfToken) throw new Error(`login_failed ${login.status}`);
	const cookie = parseCookieHeader(login);

	const rawPatch = String(patchArg || '');
	const patch = (() => {
		if (rawPatch.includes('=') && !rawPatch.trim().startsWith('{')) {
			const entries = [rawPatch, ...extraArgs]
				.map((s) => String(s || '').trim())
				.filter(Boolean)
				.map((kv) => {
					const i = kv.indexOf('=');
					const k = i >= 0 ? kv.slice(0, i) : kv;
					const v = i >= 0 ? kv.slice(i + 1) : '';
					return [k, v];
				});
			return Object.fromEntries(entries);
		}
		const patchText = rawPatch.startsWith('base64:') ? Buffer.from(rawPatch.slice('base64:'.length), 'base64').toString('utf8') : rawPatch;
		return JSON.parse(patchText);
	})();
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { cookie, 'x-csrf-token': String(loginJson.csrfToken), 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`patch_failed ${res.status} ${(json && json.error) || ''}`);
	process.stdout.write(JSON.stringify({ ok: true, id: String(id), path: json.item?.path || null }, null, 2));
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
