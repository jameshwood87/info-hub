import fs from 'node:fs/promises';
import path from 'node:path';

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

const ORIGIN = String(args.origin || process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es');
const PASSWORD = String(args.password || process.env.INFO_HUB_ADMIN_PASSWORD || '');
const LIMIT = Math.max(1, Math.min(20000, Number(args.limit || process.env.LIMIT || 20000)));
const DELAY_MS = Math.max(0, Math.min(5000, Number(args['delay-ms'] || process.env.DELAY_MS || 150)));
const ONLY_NEEDS = String(args['only-needs'] ?? process.env.ONLY_NEEDS ?? '1').trim() !== '0';
const OUT_PATH = String(args['out-path'] || process.env.OUT_PATH || path.join(process.cwd(), 'reports', 'translation-es-docs-all.json'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const apiJson = async (auth, url, init) => {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers || {}),
			cookie: auth.cookie,
			...(init?.method && init.method !== 'GET' ? { 'x-csrf-token': auth.csrf } : {}),
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

const getTranslationStatus = async (auth) => {
	const { res, json, text } = await apiJson(auth, `${ORIGIN}/api/admin/translation-status`, { method: 'GET' });
	if (!res.ok || !json?.ok) throw new Error(`translation_status_failed ${res.status} ${text.slice(0, 200)}`);
	return json;
};

const listEnglishDocs = async (auth) => {
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent('/docs/')}&status=any&bucket=all&limit=${LIMIT}&lang=en`;
	const { res, json, text } = await apiJson(auth, url, { method: 'GET' });
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`admin_list_failed ${res.status} ${text.slice(0, 200)}`);
	return json.items
		.map((it) => ({
			id: String(it?.id || ''),
			path: normalisePath(String(it?.path || '')),
			language: String(it?.language || ''),
			status: String(it?.status || ''),
			date_updated: String(it?.date_updated || ''),
			date_created: String(it?.date_created || ''),
		}))
		.filter((it) => it.id && it.path.startsWith('/docs/') && (it.language === 'en' || it.language === ''));
};

const getEsStatus = async (auth, id) => {
	const { res, json, text } = await apiJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}/translation-es`, { method: 'GET' });
	if (!res.ok || !json?.ok) throw new Error(`status_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json;
};

const translateToEs = async (auth, id) => {
	const { res, json, text } = await apiJson(auth, `${ORIGIN}/api/admin/kb-pages/${encodeURIComponent(String(id))}/translation-es`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({}),
	});
	if (!res.ok || !json?.ok) throw new Error(`translate_failed ${res.status} ${String(json?.error || text || '').slice(0, 200)}`);
	return json;
};

const main = async () => {
	const auth = await loginAdmin();
	const status = await getTranslationStatus(auth);
	if (!status.canTranslateWithDeepL) throw new Error('deepl_unavailable');

	const docs = await listEnglishDocs(auth);
	const results = [];

	let translated = 0;
	let skipped = 0;
	let failed = 0;

	for (const it of docs) {
		const id = it.id;
		try {
			const st = await getEsStatus(auth, id);
			const needs = Boolean(st?.needsRetranslate) || !String(st?.target?.id || '');
			if (ONLY_NEEDS && !needs) {
				results.push({ id, path: it.path, action: 'skip', reason: 'ok' });
				skipped++;
			} else {
				await translateToEs(auth, id);
				results.push({ id, path: it.path, action: 'translated', reason: needs ? 'needs' : 'forced' });
				translated++;
			}
		} catch (e) {
			results.push({ id, path: it.path, action: 'error', error: String(e?.message || e || 'error') });
			failed++;
		}
		if (DELAY_MS > 0) await sleep(DELAY_MS);
	}

	await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
	await fs.writeFile(
		OUT_PATH,
		JSON.stringify(
			{
				ok: true,
				origin: ORIGIN,
				counts: { total: docs.length, translated, skipped, failed },
				results,
			},
			null,
			2,
		),
	);

	process.stdout.write(`${JSON.stringify({ ok: true, outPath: OUT_PATH, counts: { total: docs.length, translated, skipped, failed } }, null, 2)}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
