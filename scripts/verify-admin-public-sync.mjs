const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const TARGET_PATH = process.env.TARGET_PATH || '/docs/propertylist-mls-user-manual/getting-started/desktop-and-mobile-friendly/';
const WAIT_MS = Math.max(0, Number(process.env.WAIT_MS || 0));
const PATCH_FIELD = String(process.env.PATCH_FIELD || 'body').trim().toLowerCase();

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
	if (!res.ok || !json?.ok || !json?.csrfToken) throw new Error(`login_failed ${res.status}`);
	return { cookie: parseCookieHeader(res), csrf: String(json.csrfToken) };
};

const listDocs = async (auth) => {
	const prefixes = ['/docs/', '/es/docs/'].map(encodeURIComponent).join(',');
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages?prefixes=${prefixes}&status=any&limit=20000&bucket=all`, {
		headers: { cookie: auth.cookie },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);
	return json.items;
};

const patchById = async (auth, id, patch) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`patch_failed ${res.status} ${(json && json.error) || ''}`);
	return json.item;
};

const getById = async (auth, id) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`get_failed ${res.status} ${(json && json.error) || ''}`);
	return json.item;
};

const fetchPublicHtml = async (path) => {
	const url = new URL(path, ORIGIN);
	url.searchParams.set('v', `${Date.now()}`);
	const res = await fetch(url.toString(), { headers: { 'User-Agent': 'InfoHub-SyncTest/1.0' } });
	const text = await res.text();
	return { status: res.status, finalUrl: res.url, text };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const searchMarker = async (marker) => {
	const url = new URL('/api/search.json', ORIGIN);
	url.searchParams.set('q', marker);
	url.searchParams.set('lang', 'en');
	url.searchParams.set('limit', '5');
	const res = await fetch(url.toString(), { headers: { 'User-Agent': 'InfoHub-SyncTest/1.0' } });
	const json = await res.json().catch(() => null);
	const results = Array.isArray(json?.results) ? json.results : [];
	return { status: res.status, count: results.length, paths: results.map((r) => String(r?.path || '')).filter(Boolean) };
};

const main = async () => {
	const auth = await loginAdmin();
	const items = await listDocs(auth);
	const target = items.find((i) => String(i.path || '').trim() === TARGET_PATH && String(i.language || '') === 'en');
	if (!target) throw new Error(`target_not_found ${TARGET_PATH}`);

	const id = String(target.id);
	const beforeItem = await getById(auth, id);
	const beforeBody = String(beforeItem.body || '');
	const beforeTitle = String(beforeItem.title || '');
	const marker = `SYNC_MARKER_${Date.now()}`;
	const patch = (() => {
		if (PATCH_FIELD === 'title') return { title: `${beforeTitle} ${marker}`.trim() };
		const markerHtml = `<span data-sync-marker="${marker}">${marker}</span>`;
		const nextBody = (() => {
			const h1Injected = beforeBody.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/i, (_m, attrs, inner) => {
				const safeInner = String(inner || '');
				return `<h1${attrs}>${safeInner} ${markerHtml}</h1>`;
			});
			if (h1Injected !== beforeBody) return h1Injected;
			if (/<\/article\s*>/i.test(beforeBody)) return beforeBody.replace(/<\/article\s*>/i, `<p>${marker}</p>\n</article>`);
			return `${beforeBody}\n<p>${marker}</p>\n`;
		})();
		return { body: nextBody };
	})();

	await patchById(auth, id, patch);
	const afterItem = await getById(auth, id);
	const adminBlob = PATCH_FIELD === 'title' ? String(afterItem.title || '') : String(afterItem.body || '');
	const adminMarkerPresent = adminBlob.includes(marker);
	const adminIdx = adminBlob.indexOf(marker);
	const adminExcerpt = adminIdx >= 0 ? adminBlob.slice(Math.max(0, adminIdx - 120), Math.min(adminBlob.length, adminIdx + 240)) : '';

	if (WAIT_MS) await sleep(WAIT_MS);
	const search = await searchMarker(marker);
	const pub = await fetchPublicHtml(TARGET_PATH);
	const ok = pub.status === 200 && pub.text.includes(marker);

	await patchById(auth, id, PATCH_FIELD === 'title' ? { title: beforeTitle } : { body: beforeBody });

	process.stdout.write(
		JSON.stringify(
			{
				ok,
				target: { id, path: TARGET_PATH },
				adminMarkerPresent,
				adminExcerpt,
				search,
				publicFetch: { status: pub.status, finalUrl: pub.finalUrl, markerPresent: pub.text.includes(marker) },
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
