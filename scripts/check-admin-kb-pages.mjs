const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const LIMIT = Math.max(1, Math.min(20000, Number(process.env.LIMIT || 20000)));
const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';

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
	const prefixes = ['/es/docs/', '/docs/'].map(encodeURIComponent).join(',');
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${prefixes}&status=any&bucket=all&limit=${encodeURIComponent(String(LIMIT))}&lang=es`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);
	return json.items;
};

const getById = async (auth, id) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`get_failed ${res.status} ${(json && json.error) || ''}`);
	return json.item;
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

const normalizePath = (p) => {
	const raw = String(p || '');
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
};

const mapEsDocsToEnDocs = (path) => {
	const p = normalizePath(path);
	if (p.startsWith('/es/docs/')) {
		const parts = p.split('/').filter(Boolean);
		const seg = parts[2] || '';
		const mapped =
			seg === 'propertylist-mls-manual-de-usuario'
				? 'propertylist-mls-user-manual'
				: seg === 'leyes-procedimientos'
					? 'laws-procedures'
					: seg === 'portal-publico'
						? 'public-portal'
						: seg === 'empezar'
							? 'getting-started'
							: seg;
		const rest = parts.slice(3);
		return normalizePath(`/docs/${[mapped, ...rest].filter(Boolean).join('/')}/`);
	}
	if (p.startsWith('/docs/')) return p;
	return p.replace(/^\/es\//, '/');
};

const looksEnglish = (html) => {
	const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ');
	const decode = (s) =>
		String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, entRaw) => {
			const ent = String(entRaw || '').toLowerCase();
			if (ent === 'amp') return '&';
			if (ent === 'lt') return '<';
			if (ent === 'gt') return '>';
			if (ent === 'quot') return '"';
			if (ent === 'apos' || ent === '#39') return "'";
			if (ent === 'nbsp') return ' ';
			if (ent.startsWith('#x')) {
				const cp = Number.parseInt(ent.slice(2), 16);
				if (Number.isFinite(cp) && cp > 0) return String.fromCodePoint(cp);
				return m;
			}
			if (ent.startsWith('#')) {
				const cp = Number.parseInt(ent.slice(1), 10);
				if (Number.isFinite(cp) && cp > 0) return String.fromCodePoint(cp);
				return m;
			}
			return m;
		});
	const text = decode(strip(String(html || '')))
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return false;
	const enWords = [
		'the',
		'and',
		'for',
		'with',
		'this',
		'that',
		'you',
		'your',
		'how',
		'what',
		'where',
		'when',
		'click',
		'account',
		'create',
		'import',
		'add',
		'adding',
		'edit',
		'manage',
		'contact',
		'listings',
		'listing',
		'properties',
		'property',
		'generate',
		'report',
		'reports',
		'export',
		'search',
		'calendar',
		'tasks',
		'task',
		'schedule',
		'support',
		'ticket',
		'leads',
		'contacts',
	];
	const esWords = [
		'el',
		'la',
		'los',
		'las',
		'de',
		'del',
		'y',
		'para',
		'con',
		'como',
		'cómo',
		'cuenta',
		'anuncio',
		'anuncios',
		'propiedad',
		'propiedades',
		'contacto',
		'contactos',
		'calendario',
		'tareas',
		'soporte',
		'ticket',
		'leads',
	];
	const hasWord = (w) => text === w || text.includes(` ${w} `) || text.startsWith(`${w} `) || text.endsWith(` ${w}`);
	const enHits = enWords.reduce((acc, w) => acc + (hasWord(w) ? 1 : 0), 0);
	const esHits = esWords.reduce((acc, w) => acc + (hasWord(w) ? 1 : 0), 0);
	return enHits >= 4 && enHits > esHits + 1;
};

const makeSpanishPlaceholderBody = (enPath) => `
<h2>Guía en español próximamente</h2>
<p>Estamos preparando la versión en español de esta guía.</p>
<p>Mientras tanto, puedes ver la versión en inglés: <a href="${enPath}">Abrir en inglés</a>.</p>
`;

const main = async () => {
	const auth = await loginAdmin();
	const items = await listDocs(auth);

	let scanned = 0;
	let needsFix = 0;
	let patched = 0;
	const patchedPaths = [];

	for (const it of items) {
		const id = String(it?.id || '');
		if (!id) continue;
		const path = normalizePath(it?.path || '');
		if (!path.startsWith('/es/docs/') && !path.startsWith('/docs/')) continue;

		scanned++;
		const full = await getById(auth, id);
		const body = String(full?.body || '').trim();
		if (!body || looksEnglish(body)) {
			needsFix++;
			const enPath = mapEsDocsToEnDocs(path);
			const nextBody = makeSpanishPlaceholderBody(enPath);
			if (DRY_RUN) {
				patchedPaths.push(path);
				continue;
			}
			await patchById(auth, id, { body: nextBody, status: 'published' });
			patched++;
			patchedPaths.push(path);
		}
	}

	process.stdout.write(
		JSON.stringify(
			{
				ok: true,
				dryRun: DRY_RUN,
				scanned,
				needsFix,
				patched,
				patchedPaths,
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
