import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const APPLY = String(process.env.APPLY || '').trim() === '1';
const REPORT_PATH = process.env.REPORT_PATH || path.join(process.cwd(), 'reports', 'mls-manual-admin-audit.json');

const wrongSlugPrefix = '/es/docs/propertylist-mls-user-manual/';
const canonicalPrefix = '/es/docs/propertylist-mls-manual-de-usuario/';
const missingEsReferralsPath = '/es/docs/propertylist-mls-manual-de-usuario/credits/referrals/';

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const parentPath = (p) => {
	const path = normalisePath(p);
	const parts = path.split('/').filter(Boolean);
	if (parts.length <= 1) return '';
	return `/${parts.slice(0, -1).join('/')}/`;
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
			'x-csrf-token': auth.csrf,
			...(init?.body ? { 'content-type': 'application/json' } : {}),
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

const listDocsMeta = async (auth) => {
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent('/docs/')},${encodeURIComponent(
		'/es/docs/',
	)}&status=any&limit=20000&bucket=all`;
	const { res, json } = await adminJson(auth, url, { method: 'GET' });
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status}`);
	return json.items.map((it) => ({
		id: String(it?.id || ''),
		path: normalisePath(String(it?.path || '')),
		language: String(it?.language || ''),
		status: String(it?.status || ''),
		title: String(it?.title || ''),
	}));
};

const reorderPath = async (auth, nodePath, toParentPath) => {
	if (!APPLY) return { ok: true, dryRun: true, nodePath: normalisePath(nodePath), toParentPath: normalisePath(toParentPath) };
	const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-tree/reorder`, {
		method: 'POST',
		body: JSON.stringify({ nodePath, toParentPath, toIndex: 0 }),
	});
	if (!res.ok || !json?.ok) throw new Error(`reorder_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json;
};

const bulkTrash = async (auth, ids) => {
	const uniq = Array.from(new Set(ids.map((x) => String(x || '')).filter(Boolean)));
	const batches = [];
	for (let i = 0; i < uniq.length; i += 200) batches.push(uniq.slice(i, i + 200));
	const out = [];
	for (const batch of batches) {
		if (!APPLY) {
			out.push(...batch.map((id) => ({ id, ok: true, dryRun: true, action: 'trash' })));
			continue;
		}
		const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/bulk`, {
			method: 'POST',
			body: JSON.stringify({ action: 'trash', ids: batch }),
		});
		if (!res.ok || !json?.ok) throw new Error(`bulk_trash_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
		out.push(...(Array.isArray(json.results) ? json.results : []));
	}
	return out;
};

const createKbPage = async (auth, scope, page) => {
	if (!APPLY) return { ok: true, dryRun: true, scope, page };
	const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages`, {
		method: 'POST',
		body: JSON.stringify({ scope, page }),
	});
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`create_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json;
};

const main = async () => {
	const reportRaw = await fs.readFile(REPORT_PATH, 'utf8');
	const report = JSON.parse(reportRaw);
	const items = Array.isArray(report?.spanishAdminClassification) ? report.spanishAdminClassification : [];
	const expectedEs = new Set((Array.isArray(report?.expected?.esPaths) ? report.expected.esPaths : []).map(normalisePath).filter(Boolean));

	const auth = await loginAdmin();
	const live = await listDocsMeta(auth);
	const liveByPath = new Map(live.map((it) => [it.path, it]));

	const wrongParent = items
		.filter((it) => String(it?.structureCategory || '') === 'wrong_parent' && it?.suggestedTargetPath)
		.map((it) => ({ id: String(it.id || ''), from: normalisePath(it.path), to: normalisePath(it.suggestedTargetPath) }))
		.filter((x) => x.from && x.to);
	wrongParent.sort((a, b) => b.from.length - a.from.length);

	const reorderResults = [];
	for (const mv of wrongParent) {
		const fromLive = liveByPath.get(mv.from);
		if (!fromLive) {
			reorderResults.push({ ok: false, action: 'reorder', from: mv.from, to: mv.to, error: 'missing_source' });
			continue;
		}
		const toParent = parentPath(mv.to);
		if (!toParent) {
			reorderResults.push({ ok: false, action: 'reorder', from: mv.from, to: mv.to, error: 'invalid_target_parent' });
			continue;
		}
		const expectedLeaf = mv.to.split('/').filter(Boolean).slice(-1)[0] || '';
		const actualLeaf = mv.from.split('/').filter(Boolean).slice(-1)[0] || '';
		if (expectedLeaf && actualLeaf && expectedLeaf !== actualLeaf) {
			reorderResults.push({ ok: false, action: 'reorder', from: mv.from, to: mv.to, error: 'leaf_mismatch' });
			continue;
		}
		await reorderPath(auth, mv.from, toParent);
		reorderResults.push({ ok: true, action: 'reorder', from: mv.from, to: mv.to });
	}

	const afterMoves = await listDocsMeta(auth);
	const afterByPath = new Map(afterMoves.map((it) => [it.path, it]));

	const canonicalGroups = new Map();
	for (const it of items) {
		const cp = normalisePath(it?.canonicalPath || it?.path || '');
		if (!cp) continue;
		const list = canonicalGroups.get(cp) || [];
		list.push({ id: String(it.id || ''), path: normalisePath(it.path), canonicalPath: cp, structureCategory: String(it?.structureCategory || '') });
		canonicalGroups.set(cp, list);
	}

	const toTrash = [];
	for (const [canonicalPath, group] of canonicalGroups.entries()) {
		if (!canonicalPath.startsWith(canonicalPrefix)) continue;
		const liveCanonical = afterByPath.get(canonicalPath) || null;
		const liveWrong = group
			.map((g) => afterByPath.get(normalisePath(g.path)) || null)
			.filter(Boolean)
			.filter((x) => x.path.startsWith(wrongSlugPrefix));

		if (liveCanonical) {
			for (const dup of liveWrong) toTrash.push(dup.id);
			continue;
		}

		if (liveWrong.length === 1) {
			const src = liveWrong[0];
			if (!APPLY) continue;
			const { res, json, text } = await adminJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(src.id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ patch: { path: canonicalPath } }),
			});
			if (!res.ok || !json?.ok) throw new Error(`rename_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
			continue;
		}
	}

	const trashResults = await bulkTrash(auth, toTrash);

	if (expectedEs.has(normalisePath(missingEsReferralsPath)) && !afterByPath.has(normalisePath(missingEsReferralsPath))) {
		await createKbPage(auth, 'docs', {
			status: 'draft',
			language: 'es',
			path: missingEsReferralsPath,
			title: 'Referidos',
			description: null,
			body: null,
			seo_title: null,
			seo_description: null,
		});
	}

	const out = {
		ok: true,
		apply: APPLY,
		reportPath: REPORT_PATH,
		counts: {
			wrongParentMovesPlanned: wrongParent.length,
			wrongParentMovesOk: reorderResults.filter((r) => r.ok).length,
			wrongParentMovesFailed: reorderResults.filter((r) => !r.ok).length,
			wrongSlugTrashPlanned: toTrash.length,
			wrongSlugTrashApplied: trashResults.filter((r) => r.ok).length,
		},
		failures: reorderResults.filter((r) => !r.ok),
	};
	process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
