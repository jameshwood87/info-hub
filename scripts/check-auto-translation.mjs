import crypto from 'node:crypto';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

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

const api = async (auth, path, init) => {
	const res = await fetch(`${ORIGIN}${path}`, {
		...init,
		headers: {
			...(init?.headers || {}),
			cookie: auth.cookie,
			...(init?.method && init.method !== 'GET' ? { 'x-csrf-token': auth.csrf } : {}),
		},
	});
	const json = await res.json().catch(() => null);
	return { res, json };
};

const main = async () => {
	const auth = await loginAdmin();

	const status = await api(auth, '/api/admin/translation-status', { method: 'GET' });
	if (!status.res.ok || !status.json?.ok) throw new Error(`translation_status_failed ${status.res.status}`);

	const token = crypto.randomBytes(4).toString('hex');
	const enPath = normalisePath(`/docs/_translation-check/${Date.now()}-${token}/`);
	const bodyHtml = '<p>This is a translation test. Apple. Blue house.</p>';

	const created = await api(auth, '/api/admin/kb-pages', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			scope: 'docs',
			page: {
				status: 'draft',
				language: 'en',
				path: enPath,
				title: `Translation test ${token}`,
				description: null,
				body: bodyHtml,
				seo_title: null,
				seo_description: null,
			},
		}),
	});
	if (!created.res.ok || !created.json?.ok) throw new Error(`create_failed ${created.res.status} ${(created.json && created.json.error) || ''}`);

	const createdId = String(created.json?.item?.id || '');
	const esPath = normalisePath(created.json?.translation?.path || '');

	let esPage = null;
	if (esPath) {
		const list = await api(auth, `/api/admin/kb-pages?prefixes=${encodeURIComponent(esPath)}&status=any&bucket=all&limit=50&lang=es`, { method: 'GET' });
		const items = Array.isArray(list.json?.items) ? list.json.items : [];
		const hit = items.find((it) => normalisePath(it?.path) === esPath) || null;
		const esId = hit?.id ? String(hit.id) : '';
		if (esId) {
			const get = await api(auth, `/api/admin/kb-pages/${encodeURIComponent(esId)}`, { method: 'GET' });
			if (get.res.ok && get.json?.ok) esPage = get.json.item || null;
		}
	}

	const esBody = String(esPage?.body || '');
	const isPlaceholder = esBody.includes('Traducción en curso');

	const cleanup = createdId
		? await api(auth, `/api/admin/kb-pages/${encodeURIComponent(createdId)}`, { method: 'DELETE' }).catch(() => null)
		: null;

	process.stdout.write(
		`${JSON.stringify(
			{
				ok: true,
				translationStatus: status.json,
				created: { id: createdId, enPath, esPath },
				esDetected: {
					found: Boolean(esPage),
					isPlaceholder,
					bodySample: esBody.slice(0, 160),
				},
				cleanupOk: Boolean(cleanup?.json?.ok),
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

