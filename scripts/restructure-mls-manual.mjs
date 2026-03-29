const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const APPLY = String(process.env.APPLY || '').trim() === '1';
const STATUS = String(process.env.STATUS || 'any').trim();

const MANUAL_PREFIX = '/docs/propertylist-mls-user-manual/';

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

const adminJson = async (auth, url, init) => {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init && init.headers ? init.headers : {}),
			cookie: auth.cookie,
			'x-csrf-token': auth.csrf,
		},
	});
	const json = await res.json().catch(() => null);
	return { res, json };
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
	const qs = new URLSearchParams();
	qs.set('prefixes', MANUAL_PREFIX);
	qs.set('status', STATUS);
	qs.set('bucket', 'all');
	qs.set('limit', '20000');
	const { res, json } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages?${qs.toString()}`, { method: 'GET' });
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);
	return json.items;
};

const getById = async (auth, id) => {
	const { res, json } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, { method: 'GET' });
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`get_failed ${res.status}`);
	return json.item;
};

const patchById = async (auth, id, patch) => {
	if (!APPLY) return { ok: true, dryRun: true, id: String(id), patch };
	const { res, json } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	if (!res.ok || !json?.ok) throw new Error(`patch_failed ${res.status} ${(json && json.error) || ''}`);
	return json.item;
};

const createDocsPage = async (auth, page) => {
	if (!APPLY) return { ok: true, dryRun: true, page };
	const { res, json } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ scope: 'docs', page }),
	});
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`create_failed ${res.status} ${(json && json.error) || ''}`);
	return json.item;
};

const ensureDocsPage = async (auth, byPath, input) => {
	const path = normalisePath(input.path);
	const existing = byPath.get(path) || null;
	if (existing) return existing;
	const created = await createDocsPage(auth, {
		status: input.status || 'published',
		language: 'en',
		path,
		title: input.title || path,
		description: input.description ?? null,
		body: input.body ?? null,
		seo_title: input.seo_title ?? null,
		seo_description: input.seo_description ?? null,
	});
	const item = { id: String(created.id || created.item?.id || ''), path, title: input.title || path, language: 'en', status: input.status || 'published' };
	byPath.set(path, item);
	return item;
};

const copyContent = async (auth, fromId, toId) => {
	const from = await getById(auth, fromId);
	const patch = {
		title: from.title,
		description: from.description ?? null,
		body: from.body ?? null,
		seo_title: from.seo_title ?? null,
		seo_description: from.seo_description ?? null,
		status: 'published',
		language: 'en',
	};
	await patchById(auth, toId, patch);
	await patchById(auth, fromId, { status: 'draft' });
};

const movePrefixChildren = async (auth, items, byPath, oldPrefix, newPrefix, results) => {
	const from = normalisePath(oldPrefix);
	const to = normalisePath(newPrefix);
	const targets = items
		.filter((it) => String(it.language || '') === 'en')
		.map((it) => ({ id: String(it.id), path: normalisePath(it.path) }))
		.filter((it) => it.path.startsWith(from) && it.path !== from);

	for (const it of targets) {
		const rest = it.path.slice(from.length);
		const next = normalisePath(`${to}${rest}`);
		const existing = byPath.get(next);
		if (existing && String(existing.id) !== String(it.id)) {
			results.push({ ok: false, action: 'move', id: it.id, from: it.path, to: next, error: 'collision' });
			continue;
		}
		await patchById(auth, it.id, { path: next });
		byPath.delete(it.path);
		byPath.set(next, { ...byPath.get(next), id: it.id, path: next });
		results.push({ ok: true, action: 'move', id: it.id, from: it.path, to: next });
	}
};

const moveSinglePath = async (auth, byPath, fromPath, toPath, results) => {
	const from = normalisePath(fromPath);
	const to = normalisePath(toPath);
	const item = byPath.get(from) || null;
	if (!item) {
		results.push({ ok: false, action: 'move_one', from, to, error: 'missing_source' });
		return;
	}
	const existing = byPath.get(to);
	if (existing && String(existing.id) !== String(item.id)) {
		results.push({ ok: false, action: 'move_one', id: item.id, from, to, error: 'collision' });
		return;
	}
	await patchById(auth, item.id, { path: to });
	byPath.delete(from);
	byPath.set(to, { ...item, path: to });
	results.push({ ok: true, action: 'move_one', id: item.id, from, to });
};

const main = async () => {
	const auth = await loginAdmin();
	const items = await listDocs(auth);
	const byPath = new Map(items.map((it) => [normalisePath(it.path), { ...it, id: String(it.id) }]));

	const results = [];

	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}listings/`,
		title: 'Listings',
		description: 'Create, import, edit, and manage listings from start to finish.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}search/`,
		title: 'Search',
		description: 'Find properties fast with filters, alerts, and availability checks.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}pipeline/`,
		title: 'Pipeline',
		description: 'Track deals from initial contact to completion.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}marketing/`,
		title: 'Marketing',
		description: 'Share listings, promote properties, and track exposure.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}reports/`,
		title: 'Reports',
		description: 'Reports, statistics, and market insights.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}support/`,
		title: 'Support',
		description: 'Help, FAQ, video tutorials, and contacting MLS support.',
		body: null,
		status: 'published',
	});
	await ensureDocsPage(auth, byPath, {
		path: `${MANUAL_PREFIX}integrations/`,
		title: 'Integrations',
		description: 'Exports, XML structure, and technical documentation.',
		body: null,
		status: 'published',
	});

	const rootCopies = [
		{ from: `${MANUAL_PREFIX}mls-user-manual/`, to: `${MANUAL_PREFIX}your-account/` },
		{ from: `${MANUAL_PREFIX}how-to-use-contacts/`, to: `${MANUAL_PREFIX}contacts/` },
		{ from: `${MANUAL_PREFIX}how-to-use-the-calendar/`, to: `${MANUAL_PREFIX}calendar/` },
		{ from: `${MANUAL_PREFIX}managing-your-leads/`, to: `${MANUAL_PREFIX}leads/` },
		{ from: `${MANUAL_PREFIX}marketing-and-promotion/`, to: `${MANUAL_PREFIX}marketing/` },
		{ from: `${MANUAL_PREFIX}reports-and-statistics/`, to: `${MANUAL_PREFIX}reports/` },
		{ from: `${MANUAL_PREFIX}searching-for-properties/`, to: `${MANUAL_PREFIX}search/` },
		{ from: `${MANUAL_PREFIX}sales-pipeline-tracking/`, to: `${MANUAL_PREFIX}pipeline/` },
	];

	for (const pair of rootCopies) {
		const from = normalisePath(pair.from);
		const to = normalisePath(pair.to);
		const fromItem = byPath.get(from) || null;
		const toItem = byPath.get(to) || null;
		if (!fromItem || !toItem) {
			results.push({ ok: false, action: 'copy_root', from, to, error: 'missing' });
			continue;
		}
		await copyContent(auth, fromItem.id, toItem.id);
		results.push({ ok: true, action: 'copy_root', from, to, drafted: fromItem.id });
	}

	const prefixMoves = [
		{ from: `${MANUAL_PREFIX}mls-user-manual/`, to: `${MANUAL_PREFIX}your-account/` },
		{ from: `${MANUAL_PREFIX}how-to-use-contacts/`, to: `${MANUAL_PREFIX}contacts/` },
		{ from: `${MANUAL_PREFIX}how-to-use-the-calendar/`, to: `${MANUAL_PREFIX}calendar/` },
		{ from: `${MANUAL_PREFIX}managing-your-leads/`, to: `${MANUAL_PREFIX}leads/` },
		{ from: `${MANUAL_PREFIX}listing-a-property/`, to: `${MANUAL_PREFIX}listings/` },
		{ from: `${MANUAL_PREFIX}managing-listings/`, to: `${MANUAL_PREFIX}listings/` },
		{ from: `${MANUAL_PREFIX}searching-for-properties/`, to: `${MANUAL_PREFIX}search/` },
		{ from: `${MANUAL_PREFIX}sales-pipeline-tracking/`, to: `${MANUAL_PREFIX}pipeline/` },
		{ from: `${MANUAL_PREFIX}marketing-and-promotion/`, to: `${MANUAL_PREFIX}marketing/` },
		{ from: `${MANUAL_PREFIX}reports-and-statistics/`, to: `${MANUAL_PREFIX}reports/` },
		{ from: `${MANUAL_PREFIX}additional-resources/`, to: `${MANUAL_PREFIX}support/` },
		{ from: `${MANUAL_PREFIX}export-listings/`, to: `${MANUAL_PREFIX}integrations/export-listings/` },
		{ from: `${MANUAL_PREFIX}technical-documentation/`, to: `${MANUAL_PREFIX}integrations/technical-documentation/` },
		{ from: `${MANUAL_PREFIX}ai-ezd_ampersand-automation/`, to: `${MANUAL_PREFIX}ai-and-automation/` },
	];

	for (const mv of prefixMoves) {
		await movePrefixChildren(auth, items, byPath, mv.from, mv.to, results);
	}

	await moveSinglePath(auth, byPath, `${MANUAL_PREFIX}export-listings/`, `${MANUAL_PREFIX}integrations/export-listings/`, results);
	await moveSinglePath(
		auth,
		byPath,
		`${MANUAL_PREFIX}technical-documentation/`,
		`${MANUAL_PREFIX}integrations/technical-documentation/`,
		results,
	);
	await moveSinglePath(auth, byPath, `${MANUAL_PREFIX}tracking-listing-exposure/`, `${MANUAL_PREFIX}marketing/tracking-listing-exposure/`, results);
	await moveSinglePath(auth, byPath, `${MANUAL_PREFIX}mls-property-alerts/`, `${MANUAL_PREFIX}search/property-alerts/`, results);
	await moveSinglePath(
		auth,
		byPath,
		`${MANUAL_PREFIX}microsite-share-properties-listings/`,
		`${MANUAL_PREFIX}marketing/microsite-share/`,
		results,
	);

	const draftedRoots = [
		`${MANUAL_PREFIX}listing-a-property/`,
		`${MANUAL_PREFIX}managing-listings/`,
		`${MANUAL_PREFIX}searching-for-properties/`,
		`${MANUAL_PREFIX}sales-pipeline-tracking/`,
		`${MANUAL_PREFIX}marketing-and-promotion/`,
		`${MANUAL_PREFIX}reports-and-statistics/`,
		`${MANUAL_PREFIX}additional-resources/`,
		`${MANUAL_PREFIX}microsite-share/`,
	];
	for (const p of draftedRoots) {
		const item = byPath.get(normalisePath(p));
		if (item) {
			await patchById(auth, item.id, { status: 'draft' });
			results.push({ ok: true, action: 'draft_root', id: item.id, path: normalisePath(p) });
		}
	}

	process.stdout.write(
		JSON.stringify(
			{
				ok: true,
				apply: APPLY,
				results,
				failures: results.filter((r) => !r.ok).length,
				total: results.length,
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
