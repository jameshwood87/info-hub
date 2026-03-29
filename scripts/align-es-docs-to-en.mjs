import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const APPLY = String(process.env.APPLY || '').trim() === '1';
const LIMIT = Math.max(1000, Math.min(20000, Number(process.env.LIMIT || 20000)));

const OUT_PATH = process.env.OUT_PATH || path.join(process.cwd(), 'reports', 'docs-en-es-alignment.json');

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const mapDocsEnglishToSpanishPath = (p) => {
	const path = String(p || '');
	if (!path.startsWith('/docs/')) return path;
	const parts = path.split('/').filter(Boolean);
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
	return normalisePath(`/es/${parts.join('/')}/`);
};

const mapDocsSpanishToEnglishPath = (p) => {
	const path = String(p || '');
	if (!path.startsWith('/es/docs/')) return path;
	const withoutEs = path.replace(/^\/es\//, '/');
	const parts = withoutEs.split('/').filter(Boolean);
	const seg = parts[1] || '';
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
	parts[1] = mapped;
	return normalisePath(`/${parts.join('/')}/`);
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

const adminJson = async (auth, url, init) => {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers || {}),
			cookie: auth.cookie,
			...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}),
		},
	});
	const text = await res.text().catch(() => '');
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { res, json, text };
};

const adminListPages = async (auth, prefixes, lang) => {
	const q = new URLSearchParams();
	q.set('prefixes', prefixes.map((p) => encodeURIComponent(p)).join(','));
	q.set('status', 'any');
	q.set('bucket', 'all');
	q.set('limit', String(LIMIT));
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${prefixes.map(encodeURIComponent).join(',')}&status=any&bucket=all&limit=${LIMIT}${
		lang ? `&lang=${encodeURIComponent(lang)}` : ''
	}`;
	const { res, json, text } = await adminJson(auth, url, { method: 'GET' });
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status} ${text.slice(0, 200)}`);
	return json.items.map((it) => ({
		id: String(it?.id || ''),
		path: normalisePath(String(it?.path || '')),
		language: String(it?.language || ''),
		status: String(it?.status || ''),
		title: String(it?.title || ''),
		description: it?.description ?? null,
		body: it?.body ?? null,
		seo_title: it?.seo_title ?? null,
		seo_description: it?.seo_description ?? null,
	}));
};

const patchPage = async (auth, id, patch) => {
	if (!APPLY) return { ok: true, dryRun: true, id: String(id), patch };
	const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	if (!res.ok || !json?.ok) throw new Error(`patch_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json.item;
};

const createPage = async (auth, page) => {
	if (!APPLY) return { ok: true, dryRun: true, page };
	const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ scope: 'docs', page }),
	});
	if (!res.ok || !json?.ok) throw new Error(`create_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json.item;
};

const bulkTrash = async (auth, ids) => {
	const uniq = Array.from(new Set(ids.map((x) => String(x || '')).filter(Boolean)));
	const batches = [];
	for (let i = 0; i < uniq.length; i += 200) batches.push(uniq.slice(i, i + 200));
	const results = [];
	for (const batch of batches) {
		if (!APPLY) {
			results.push(...batch.map((id) => ({ id, ok: true, dryRun: true, action: 'trash' })));
			continue;
		}
		const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/bulk`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'trash', ids: batch }),
		});
		if (!res.ok || !json?.ok) throw new Error(`bulk_trash_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
		results.push(...(Array.isArray(json.results) ? json.results : []));
	}
	return results;
};

const listTreeChildren = async (auth, { prefixes, parent, lang }) => {
	const url = `${ORIGIN}/api/admin/kb-tree?prefixes=${prefixes.map(encodeURIComponent).join(',')}&parent=${encodeURIComponent(
		parent,
	)}&status=any&bucket=all&cap=20000${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`;
	const { res, json, text } = await adminJson(auth, url, { method: 'GET' });
	if (!res.ok || !json?.ok || !Array.isArray(json.nodes)) throw new Error(`tree_failed ${res.status} ${text.slice(0, 200)}`);
	return json.nodes.map((n) => ({
		path: normalisePath(String(n?.path || '')),
		seg: String(n?.seg || ''),
		title: String(n?.title || ''),
		hasChildren: Boolean(n?.hasChildren),
		parentPath: normalisePath(String(n?.parentPath || '')),
		hasPage: Boolean(n?.hasPage),
		pageId: n?.pageId ? String(n.pageId) : null,
	}));
};

const reorderNode = async (auth, { nodePath, toParentPath, toIndex, seed }) => {
	if (!APPLY) return { ok: true, dryRun: true, nodePath, toParentPath, toIndex };
	const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-tree/reorder`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ nodePath, toParentPath, toIndex, seed }),
	});
	if (!res.ok || !json?.ok) throw new Error(`reorder_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json;
};

const placeholderEsBody = (enPath) =>
	`<h2>Traducción en curso</h2><p>Estamos preparando la versión en español de esta página.</p><p>Mientras tanto, puedes ver la versión en inglés: <a href="${enPath}">Abrir en inglés</a>.</p>`;

const main = async () => {
	const auth = await loginAdmin();

	const enPages = await adminListPages(auth, ['/docs/'], 'en');
	const esPages = await adminListPages(auth, ['/es/docs/'], 'es');

	const enByPath = new Map(enPages.map((p) => [p.path, p]));
	const esByPath = new Map(esPages.map((p) => [p.path, p]));

	const expectedEsByEn = new Map();
	for (const en of enPages) {
		const esPath = mapDocsEnglishToSpanishPath(en.path);
		if (!esPath.startsWith('/es/docs/')) continue;
		expectedEsByEn.set(en.path, esPath);
	}
	const expectedEsPaths = new Set(Array.from(expectedEsByEn.values()));

	const duplicatesByCanonical = new Map();
	for (const es of esPages) {
		const enPath = mapDocsSpanishToEnglishPath(es.path);
		const canonical = expectedEsByEn.get(enPath) || '';
		if (!canonical) continue;
		const list = duplicatesByCanonical.get(canonical) || [];
		list.push(es);
		duplicatesByCanonical.set(canonical, list);
	}

	const renameOps = [];
	const trashIds = [];

	for (const [canonical, list] of duplicatesByCanonical.entries()) {
		const exact = list.find((x) => x.path === canonical) || null;
		if (exact) {
			for (const other of list) {
				if (other.id !== exact.id) trashIds.push(other.id);
			}
			continue;
		}
		if (list.length === 1) {
			const only = list[0];
			renameOps.push({ id: only.id, from: only.path, to: canonical });
			continue;
		}
		list.sort((a, b) => (a.status === 'published' ? -1 : 1) - (b.status === 'published' ? -1 : 1));
		const keep = list[0];
		renameOps.push({ id: keep.id, from: keep.path, to: canonical });
		for (const other of list.slice(1)) trashIds.push(other.id);
	}

	for (const es of esPages) {
		const enPath = mapDocsSpanishToEnglishPath(es.path);
		if (!enByPath.has(enPath)) {
			trashIds.push(es.id);
			continue;
		}
		const canonical = expectedEsByEn.get(enPath);
		if (!canonical) continue;
		if (es.path !== canonical) {
			renameOps.push({ id: es.id, from: es.path, to: canonical });
		}
	}

	const renameUnique = new Map();
	for (const op of renameOps) {
		if (!op.to || !op.id) continue;
		if (!renameUnique.has(op.id)) renameUnique.set(op.id, op);
	}

	const renamesPlanned = Array.from(renameUnique.values()).filter((op) => op.from !== op.to);
	const renames = [];
	for (const op of renamesPlanned) {
		const collision = esByPath.get(op.to);
		if (collision && collision.id !== op.id) {
			trashIds.push(op.id);
			continue;
		}
		await patchPage(auth, op.id, { path: op.to }).catch((e) => {
			renames.push({ ok: false, ...op, error: String(e?.message || e) });
		});
		renames.push({ ok: true, ...op });
	}

	const afterEsPages = await adminListPages(auth, ['/es/docs/'], 'es');
	const afterEsByPath = new Map(afterEsPages.map((p) => [p.path, p]));

	const missingEs = [];
	for (const [enPath, esPath] of expectedEsByEn.entries()) {
		if (!afterEsByPath.has(esPath)) missingEs.push({ enPath, esPath });
	}

	const createdMissing = [];
	for (const m of missingEs) {
		const src = enByPath.get(m.enPath);
		if (!src) continue;
		const existing = afterEsByPath.get(m.esPath);
		if (existing) continue;
		const item = await createPage(auth, {
			status: 'draft',
			language: 'es',
			path: m.esPath,
			title: src.title || m.esPath,
			description: null,
			body: placeholderEsBody(m.enPath),
			seo_title: null,
			seo_description: null,
		}).catch((e) => ({ ok: false, error: String(e?.message || e), path: m.esPath, enPath: m.enPath }));
		createdMissing.push(item && item.ok === false ? item : { ok: true, path: m.esPath, enPath: m.enPath, id: String(item?.id || '') });
	}

	const trashUnique = Array.from(new Set(trashIds.map(String).filter(Boolean)));
	const trashResults = await bulkTrash(auth, trashUnique).catch((e) => [{ ok: false, error: String(e?.message || e) }]);

	const traverse = async (rootParent, lang) => {
		const seen = new Set();
		const stack = [normalisePath(rootParent)];
		const out = [];
		while (stack.length) {
			const parent = stack.pop();
			if (!parent || seen.has(parent)) continue;
			seen.add(parent);
			const kids = await listTreeChildren(auth, { prefixes: ['/docs/'], parent, lang });
			out.push({ parent, kids });
			for (const k of kids) if (k.hasChildren) stack.push(k.path);
		}
		return out;
	};

	const enTree = await traverse('/docs/', 'en');
	const enStructure = enTree.map((x) => ({ parent: x.parent, kids: x.kids.map((k) => k.path) }));

	const reorderOps = [];
	const allowEsReorder = String(process.env.ALLOW_ES_REORDER || '').trim() === '1';
	if (APPLY && allowEsReorder) {
		for (const { parent: enParent, kids } of enTree) {
			const esParent = enParent === '/docs/' ? '/es/docs/' : mapDocsEnglishToSpanishPath(enParent);
			if (!esParent.startsWith('/es/docs/')) continue;
			const esKids = await listTreeChildren(auth, { prefixes: ['/es/docs/'], parent: esParent, lang: 'es' }).catch(() => []);
			if (!esKids.length) continue;

			const desired = [];
			for (const enChild of kids) {
				const esChild = mapDocsEnglishToSpanishPath(enChild.path);
				if (!esChild.startsWith('/es/docs/')) continue;
				desired.push(esChild);
			}

			const current = esKids.map((k) => k.path);
			const desiredSet = new Set(desired);
			const remainder = current.filter((p) => !desiredSet.has(p));
			const nextOrder = [...desired, ...remainder];
			if (nextOrder.join('|') === current.join('|')) continue;

			const cur = current.slice();
			for (let i = 0; i < nextOrder.length; i++) {
				const want = nextOrder[i];
				const at = cur[i];
				if (at === want) continue;
				const j = cur.indexOf(want);
				if (j < 0) continue;
				await reorderNode(auth, {
					nodePath: want,
					toParentPath: esParent,
					toIndex: i,
					seed: { [esParent]: cur.slice() },
				}).catch((e) => {
					reorderOps.push({ ok: false, parent: esParent, nodePath: want, toIndex: i, error: String(e?.message || e) });
				});
				reorderOps.push({ ok: true, parent: esParent, nodePath: want, toIndex: i });
				cur.splice(j, 1);
				cur.splice(i, 0, want);
			}
		}
	}

	const finalEnPages = await adminListPages(auth, ['/docs/'], 'en');
	const finalEsPages = await adminListPages(auth, ['/es/docs/'], 'es');
	const finalEsByPath2 = new Set(finalEsPages.map((p) => p.path));
	const finalExpected = new Set(finalEnPages.map((p) => mapDocsEnglishToSpanishPath(p.path)).filter((p) => p.startsWith('/es/docs/')));
	const finalMissing = Array.from(finalExpected).filter((p) => !finalEsByPath2.has(p));
	const finalExtras = finalEsPages
		.map((p) => p.path)
		.filter((p) => p.startsWith('/es/docs/'))
		.filter((p) => !finalExpected.has(p));

	const esStructure = [];
	for (const row of enStructure) {
		const esParent = row.parent === '/docs/' ? '/es/docs/' : mapDocsEnglishToSpanishPath(row.parent);
		if (!esParent.startsWith('/es/docs/')) continue;
		const esKids = await listTreeChildren(auth, { prefixes: ['/es/docs/'], parent: esParent, lang: 'es' }).catch(() => []);
		esStructure.push({ parent: esParent, kids: esKids.map((k) => k.path) });
	}

	const report = {
		ok: true,
		apply: APPLY,
		generatedAt: new Date().toISOString(),
		origin: ORIGIN,
		counts: {
			enDocsPages: finalEnPages.length,
			esDocsPages: finalEsPages.length,
			expectedEsFromEn: finalExpected.size,
			missingEsAfter: finalMissing.length,
			renamesPlanned: renamesPlanned.length,
			trashPlanned: trashUnique.length,
			reorderOps: reorderOps.filter((r) => r.ok).length,
			reorderFailures: reorderOps.filter((r) => !r.ok).length,
		},
		enStructure,
		esStructure,
		missingEsAfter: finalMissing.slice(0, 200),
		extraEsAfter: finalExtras.slice(0, 200),
		renames,
		trashed: trashResults,
		reorders: reorderOps.slice(0, 2000),
	};

	await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
	await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
	process.stdout.write(`${JSON.stringify({ ok: true, reportPath: OUT_PATH, counts: report.counts }, null, 2)}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
