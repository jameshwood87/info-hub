const id = process.argv[2];
if (!id) {
	process.stderr.write('missing_id\n');
	process.exit(1);
}

const origin = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const password = process.env.INFO_HUB_ADMIN_PASSWORD || '';

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

	const res = await fetch(`${origin}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		headers: { cookie, 'x-csrf-token': String(loginJson.csrfToken || '') },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`fetch_failed ${res.status}`);
	const body = String(json.item.body || '');
	const bodyText = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const imgSrcs = [...body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]).filter(Boolean);
	const imgDataSrcs = [...body.matchAll(/<img\b[^>]*(?:data-src|data-lazy-src|data-original|data-srcset)=["']([^"']+)["'][^>]*>/gi)]
		.map((m) => m[1])
		.filter(Boolean);
	const assetsRefs = [...body.matchAll(/\/assets\/[a-f0-9-]{8,}/gi)].map((m) => m[0]).filter(Boolean);
	const hasElementorImageWidget = /\belementor-widget-image\b/i.test(body);
	const idx = body.toLowerCase().indexOf('welcome');
	const excerpt = idx >= 0 ? body.slice(Math.max(0, idx - 120), Math.min(body.length, idx + 240)) : '';
	process.stdout.write(
		JSON.stringify(
			{
				status: res.status,
				id: json.item.id,
				path: json.item.path,
				lang: json.item.language,
				statusField: json.item.status,
				bodyLen: body.length,
				imgCount: imgSrcs.length,
				imgSrcPreview: imgSrcs.slice(0, 5),
				imgDataSrcCount: imgDataSrcs.length,
				imgDataSrcPreview: imgDataSrcs.slice(0, 5),
				assetsRefCount: assetsRefs.length,
				assetsRefPreview: assetsRefs.slice(0, 5),
				hasElementorImageWidget,
				hasWelcome: /welcome/i.test(bodyText),
				hasWhatIs: /what is propertylist/i.test(bodyText),
				welcomeExcerpt: excerpt,
				bodyPreview: body.slice(0, 200),
			},
			null,
			2,
		),
	);
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
