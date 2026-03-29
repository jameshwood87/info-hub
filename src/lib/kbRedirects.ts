import fs from 'node:fs/promises';
import path from 'node:path';

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const ADMIN_DIR = path.join(VAR_DIR, 'admin');
const REDIRECTS_PATH = path.join(ADMIN_DIR, 'kb-redirects.json');

type Store = {
	version: 1;
	prefix: Record<string, string>;
};

let loaded = false;
let store: Store = { version: 1, prefix: {} };
let flushing: Promise<void> | null = null;
let prefixIndex: string[] = [];

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const buildIndex = () => {
	const keys = Object.keys(store.prefix || {})
		.map(normalisePath)
		.filter(Boolean);
	keys.sort((a, b) => b.length - a.length);
	prefixIndex = keys;
};

const ensureLoaded = async () => {
	if (loaded) return;
	loaded = true;
	try {
		const raw = await fs.readFile(REDIRECTS_PATH, 'utf8');
		const json = JSON.parse(raw) as Store;
		if (json && json.version === 1 && json.prefix && typeof json.prefix === 'object') {
			store = { version: 1, prefix: { ...(json.prefix || {}) } };
		}
	} catch {
		store = { version: 1, prefix: {} };
	}
	buildIndex();
};

const flush = async () => {
	await ensureLoaded();
	await fs.mkdir(ADMIN_DIR, { recursive: true });
	const tmp = `${REDIRECTS_PATH}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
	await fs.rename(tmp, REDIRECTS_PATH);
};

const flushSoon = () => {
	if (flushing) return flushing;
	flushing = flush()
		.catch(() => undefined)
		.finally(() => {
			flushing = null;
		});
	return flushing;
};

export const addPrefixRedirect = async (fromPrefixRaw: string, toPrefixRaw: string) => {
	await ensureLoaded();
	const from = normalisePath(fromPrefixRaw);
	const to = normalisePath(toPrefixRaw);
	if (!from || !to) throw Object.assign(new Error('invalid_path'), { status: 400 });
	if (from === to) return { ok: true, from, to, changed: false };
	if (to.startsWith(from)) throw Object.assign(new Error('redirect_loop'), { status: 400 });

	store.prefix[from] = to;
	buildIndex();
	await flushSoon();
	return { ok: true, from, to, changed: true };
};

export const removePrefixRedirect = async (fromPrefixRaw: string) => {
	await ensureLoaded();
	const from = normalisePath(fromPrefixRaw);
	if (!from) throw Object.assign(new Error('invalid_path'), { status: 400 });
	const prev = store.prefix[from];
	if (!prev) return { ok: true, from, removed: false };
	delete store.prefix[from];
	buildIndex();
	await flushSoon();
	return { ok: true, from, removed: true };
};

export const listPrefixRedirects = async () => {
	await ensureLoaded();
	return Object.entries(store.prefix || {}).map(([from, to]) => ({ from: normalisePath(from), to: normalisePath(to) }));
};

export const resolveRedirect = async (pathnameRaw: string) => {
	await ensureLoaded();
	const pathname = normalisePath(pathnameRaw);
	if (!pathname) return '';
	for (const from of prefixIndex) {
		const to = store.prefix[from];
		if (!to) continue;
		if (!pathname.startsWith(from)) continue;
		const rest = pathname.slice(from.length);
		const target = normalisePath(`${to}${rest}`);
		if (target && target !== pathname) return target;
	}
	return '';
};
