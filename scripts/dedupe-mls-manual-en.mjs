import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';
const APPLY = String(process.env.APPLY || '').trim() === '1';
const LIMIT = Math.max(1, Math.min(20000, Number(process.env.LIMIT || 5000)));
const OUT_PATH = process.env.OUT_PATH || path.join(process.cwd(), 'reports', 'mls-manual-dedupe.json');

const base = '/docs/propertylist-mls-user-manual/';

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const decodeHtmlEntities = (s) =>
	String(s || '')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&nbsp;', ' ');

const cleanTitle = (t) =>
	decodeHtmlEntities(String(t || '').replace(/\s*•\s*PropertyList Info Hub\s*$/i, '').trim());

const titleKey = (t) =>
	cleanTitle(t)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const stripTags = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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

const adminListPages = async (auth, prefixes, lang) => {
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${prefixes.map(encodeURIComponent).join(',')}&status=any&bucket=active&limit=${encodeURIComponent(String(LIMIT))}${
		lang ? `&lang=${encodeURIComponent(lang)}` : ''
	}`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status}`);
	return json.items.map((it) => ({
		id: String(it?.id || ''),
		path: normalisePath(String(it?.path || '')),
		language: String(it?.language || ''),
		status: String(it?.status || ''),
		title: cleanTitle(it?.title || ''),
	}));
};

const adminGetById = async (auth, id) => {
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.item) throw new Error(`admin_get_failed ${res.status}`);
	const it = json.item;
	return {
		id: String(it?.id || ''),
		path: normalisePath(String(it?.path || '')),
		status: String(it?.status || ''),
		title: cleanTitle(it?.title || ''),
		body: String(it?.body || ''),
	};
};

const adminPatchById = async (auth, id, patch) => {
	if (!APPLY) return { ok: true, dryRun: true, id: String(id), patch };
	const res = await fetch(`${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) throw new Error(`admin_patch_failed ${res.status}`);
	return json.item;
};

const preferredPathOrder = [
	'/docs/propertylist-mls-user-manual/getting-started/',
	'/docs/propertylist-mls-user-manual/your-account/',
	'/docs/propertylist-mls-user-manual/listing-a-property/',
	'/docs/propertylist-mls-user-manual/managing-listings/',
	'/docs/propertylist-mls-user-manual/searching-for-properties/',
	'/docs/propertylist-mls-user-manual/mls-property-alerts/',
	'/docs/propertylist-mls-user-manual/managing-your-leads/',
	'/docs/propertylist-mls-user-manual/requests/',
	'/docs/propertylist-mls-user-manual/contacts/',
	'/docs/propertylist-mls-user-manual/sales-pipeline-tracking/',
	'/docs/propertylist-mls-user-manual/microsite-share-properties-listings/',
	'/docs/propertylist-mls-user-manual/marketing-and-promotion/',
	'/docs/propertylist-mls-user-manual/tracking-listing-exposure/',
	'/docs/propertylist-mls-user-manual/reports-and-statistics/',
	'/docs/propertylist-mls-user-manual/ai-ezd_ampersand-automation/',
	'/docs/propertylist-mls-user-manual/new-developments/',
	'/docs/propertylist-mls-user-manual/integrations/',
	'/docs/propertylist-mls-user-manual/technical-documentation/',
	'/docs/propertylist-mls-user-manual/security/',
	'/docs/propertylist-mls-user-manual/credits/',
	'/docs/propertylist-mls-user-manual/referrals/',
	'/docs/propertylist-mls-user-manual/support/',
	'/docs/propertylist-mls-user-manual/additional-resources/',
	'/docs/propertylist-mls-user-manual/new-features-roadmap/',
	'/docs/propertylist-mls-user-manual/faq-mls/',
];

const pathRank = (p) => {
	const idx = preferredPathOrder.findIndex((pref) => String(p || '').startsWith(pref));
	return idx >= 0 ? idx : 9999;
};

const pickKeep = (pages) => {
	const scored = pages.map((p) => {
		const textLen = stripTags(p.body).length;
		const pub = p.status === 'published' ? 1 : 0;
		const rank = pathRank(p.path);
		return { ...p, _score: { pub, rank, textLen } };
	});
	scored.sort((a, b) => {
		if (a._score.pub !== b._score.pub) return b._score.pub - a._score.pub;
		if (a._score.rank !== b._score.rank) return a._score.rank - b._score.rank;
		if (a._score.textLen !== b._score.textLen) return b._score.textLen - a._score.textLen;
		return String(a.id).localeCompare(String(b.id));
	});
	return scored[0];
};

const main = async () => {
	const auth = await loginAdmin();
	const list = await adminListPages(auth, [base], 'en');

	const groups = new Map();
	for (const it of list) {
		if (!it.path.startsWith(base)) continue;
		const k = titleKey(it.title);
		if (!k) continue;
		const arr = groups.get(k) || [];
		arr.push(it);
		groups.set(k, arr);
	}

	const candidates = [...groups.entries()]
		.map(([k, v]) => ({ key: k, pages: v }))
		.filter((g) => g.pages.length > 1)
		.sort((a, b) => b.pages.length - a.pages.length);

	const changes = [];
	const skipped = [];

	for (const g of candidates) {
		const full = [];
		for (const p of g.pages) {
			try {
				full.push(await adminGetById(auth, p.id));
			} catch (e) {
				skipped.push({ key: g.key, id: p.id, path: p.path, error: String(e?.message || e) });
			}
		}
		if (full.length < 2) continue;
		const keep = pickKeep(full);
		const keepId = String(keep.id);
		const publishedOthers = full.filter((p) => p.id !== keepId && p.status === 'published');
		if (!publishedOthers.length) continue;

		for (const p of publishedOthers) {
			try {
				await adminPatchById(auth, p.id, { status: 'draft' });
				changes.push({ key: g.key, action: 'demote_to_draft', id: p.id, path: p.path, keepId, keepPath: keep.path });
			} catch (e) {
				skipped.push({ key: g.key, id: p.id, path: p.path, error: String(e?.message || e) });
			}
		}
	}

	const report = {
		ok: true,
		apply: APPLY,
		generatedAt: new Date().toISOString(),
		origin: ORIGIN,
		base,
		counts: {
			totalPages: list.length,
			duplicateGroups: candidates.length,
			changes: changes.length,
			skipped: skipped.length,
		},
		changes: changes.slice(0, 2000),
		skipped: skipped.slice(0, 2000),
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

