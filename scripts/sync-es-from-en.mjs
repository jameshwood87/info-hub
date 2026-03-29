const parseArgs = (argv) => {
	const out = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a?.startsWith('--')) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			out[key] = true;
		} else {
			out[key] = next;
			i++;
		}
	}
	return out;
};

const args = parseArgs(process.argv);
const directusUrl = String(args['directus-url'] || process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const directusToken = String(args.token || process.env.DIRECTUS_TOKEN || '');
const email = String(args['admin-email'] || process.env.DIRECTUS_ADMIN_EMAIL || '');
const password = String(args['admin-password'] || process.env.DIRECTUS_ADMIN_PASSWORD || '');
const deeplKey = String(args['deepl-key'] || process.env.DEEPL_API_KEY || '');
const pathPrefix = String(args['path-prefix'] || '/docs/');
const overwrite = Boolean(args.overwrite);
const publish = Boolean(args.publish);
const delayMs = Number(args['delay-ms'] || 250);
const limit = Number(args.limit || 100);

if (!deeplKey) {
	throw new Error('Missing DEEPL_API_KEY.');
}
if (/^(YOUR_|PASTE_)/i.test(deeplKey.trim())) {
	throw new Error('DEEPL_API_KEY looks like a placeholder. Set a real DeepL key (often ends with :fx for free plan).');
}
if (!pathPrefix.startsWith('/')) {
	throw new Error('--path-prefix must start with /.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalizePath = (p) => {
	const path = String(p || '');
	const u = path.startsWith('http') ? new URL(path) : null;
	const raw = u ? u.pathname : path;
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
};

const mapEnToEsPath = (path) => {
	const p = normalizePath(path);
	if (p.startsWith('/docs/')) {
		const parts = p.split('/').filter(Boolean);
		const seg = parts[1] || '';
		const mapped =
			seg === 'propertylist-mls-user-manual'
				? 'propertylist-mls-manual-de-usuario'
				: seg === 'laws-procedures'
					? 'leyes-procedimientos'
					: seg === 'public-portal'
						? 'portal-publico'
						: seg === 'getting-started'
							? 'empezar'
							: seg;
		parts[1] = mapped;
		return normalizePath(`/es/${parts.join('/')}/`);
	}

	const topMap = [
		['/blog/', '/es/informacion-general/'],
		['/general-information/', '/es/informacion-general/'],
		['/community/', '/es/comunidad/'],
		['/laws/', '/es/leyes/'],
		['/neighbourhood/', '/es/barrios/'],
		['/mls/', '/es/mls/'],
		['/pricing/', '/es/pricing/'],
		['/search/', '/es/search/'],
	];
	for (const [enPrefix, esPrefix] of topMap) {
		if (p.startsWith(enPrefix)) return normalizePath(esPrefix + p.slice(enPrefix.length));
	}

	return normalizePath(`/es${p}`);
};

const directusRequest = async (path, { method = 'GET', token, headers, body } = {}) => {
	const res = await fetch(`${directusUrl}${path}`, {
		method,
		headers: {
			...(body ? { 'content-type': 'application/json' } : {}),
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(headers || {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		if (res.status === 401) {
			throw new Error(
				`Directus 401 ${method} ${path}. Provide DIRECTUS_TOKEN (recommended) or valid DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD.${
					text ? ` Response: ${text}` : ''
				}`
			);
		}
		throw new Error(`Directus ${res.status} ${method} ${path}${text ? `: ${text}` : ''}`);
	}
	return await res.json();
};

const directusLogin = async () => {
	if (directusToken) return directusToken;
	if (!email || !password) {
		throw new Error('Missing Directus credentials. Set DIRECTUS_TOKEN (recommended) or DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD.');
	}
	const json = await directusRequest('/auth/login', {
		method: 'POST',
		body: { email, password },
	});
	const token = json?.data?.access_token;
	if (!token) throw new Error('Directus login failed.');
	return token;
};

const listKbPagesByPrefix = async (token, { prefix, lang, status }) => {
	const items = [];
	let offset = 0;
	while (true) {
		const qs = new URLSearchParams();
		qs.set('filter[status][_eq]', status);
		qs.set('filter[language][_eq]', lang);
		qs.set('filter[path][_starts_with]', prefix);
		qs.set('fields', 'id,language,path,title,description,seo_title,seo_description,body,status');
		qs.set('sort', 'id');
		qs.set('limit', String(limit));
		qs.set('offset', String(offset));
		const json = await directusRequest(`/items/kb_pages?${qs.toString()}`, { token });
		const data = Array.isArray(json?.data) ? json.data : [];
		if (!data.length) break;
		items.push(...data);
		if (data.length < limit) break;
		offset += limit;
	}
	return items;
};

const getKbPageByPath = async (token, path) => {
	const qs = new URLSearchParams();
	qs.set('filter[path][_eq]', normalizePath(path));
	qs.set('limit', '1');
	const json = await directusRequest(`/items/kb_pages?${qs.toString()}`, { token });
	return Array.isArray(json?.data) ? json.data[0] || null : null;
};

const upsertKbPage = async (token, item) => {
	const existing = await getKbPageByPath(token, item.path);
	if (existing?.id) {
		const json = await directusRequest(`/items/kb_pages/${existing.id}`, { method: 'PATCH', token, body: item });
		return { action: 'updated', id: String(json?.data?.id || existing.id) };
	}
	const json = await directusRequest('/items/kb_pages', { method: 'POST', token, body: item });
	return { action: 'created', id: String(json?.data?.id || '') };
};

const deeplTranslate = async (text, { html }) => {
	const src = String(text || '').trim();
	if (!src) return '';
	const key = deeplKey.trim();
	const endpoint = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
	const params = new URLSearchParams();
	params.set('text', src);
	params.set('source_lang', 'EN');
	params.set('target_lang', 'ES');
	params.set('preserve_formatting', '1');
	params.set('split_sentences', 'nonewlines');
	if (html) params.set('tag_handling', 'html');
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			authorization: `DeepL-Auth-Key ${key}`,
		},
		body: params.toString(),
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(`DeepL ${res.status}${msg ? `: ${msg}` : ''}`);
	}
	const json = await res.json();
	const hit = Array.isArray(json?.translations) ? json.translations[0] : null;
	return String(hit?.text || '').trim();
};

const main = async () => {
	const token = await directusLogin();
	const enPrefix = normalizePath(pathPrefix);
	const esPrefix = mapEnToEsPath(enPrefix);

	const enPages = await listKbPagesByPrefix(token, { prefix: enPrefix, lang: 'en', status: 'published' });
	const esPublished = await listKbPagesByPrefix(token, { prefix: esPrefix, lang: 'es', status: 'published' });
	const esDraft = await listKbPagesByPrefix(token, { prefix: esPrefix, lang: 'es', status: 'draft' });
	const esByPath = new Set([...esPublished, ...esDraft].map((p) => normalizePath(p.path)).filter(Boolean));

	let done = 0;
	for (const src of enPages) {
		const enPath = normalizePath(src.path);
		const esPath = mapEnToEsPath(enPath);
		if (!overwrite && esByPath.has(esPath)) continue;

		const item = {
			status: publish ? 'published' : 'draft',
			language: 'es',
			path: esPath,
			title: await deeplTranslate(src.title, { html: false }),
			description: src.description ? await deeplTranslate(src.description, { html: false }) : null,
			seo_title: src.seo_title ? await deeplTranslate(src.seo_title, { html: false }) : null,
			seo_description: src.seo_description ? await deeplTranslate(src.seo_description, { html: false }) : null,
			body: src.body ? await deeplTranslate(src.body, { html: true }) : null,
		};

		const { action, id } = await upsertKbPage(token, item);
		process.stdout.write(`${action}\t${id}\t${enPath}\t=>\t${esPath}\n`);
		done++;
		if (delayMs > 0) await sleep(delayMs);
	}
	process.stdout.write(`done\t${done}\n`);
};

await main();
