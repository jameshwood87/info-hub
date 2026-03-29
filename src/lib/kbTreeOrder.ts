import fs from 'node:fs/promises';
import path from 'node:path';

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const ADMIN_DIR = path.join(VAR_DIR, 'admin');
const ORDER_PATH = path.join(ADMIN_DIR, 'kb-tree-order.json');

export type KbTreeOrderStore = {
	version: 1;
	parentChildren: Record<string, string[]>;
	parentOverride: Record<string, string>;
};

let loaded = false;
let store: KbTreeOrderStore = { version: 1, parentChildren: {}, parentOverride: {} };
let flushing: Promise<void> | null = null;

const ensureLoaded = async () => {
	if (loaded) return;
	loaded = true;
	try {
		const raw = await fs.readFile(ORDER_PATH, 'utf8');
		const json = JSON.parse(raw) as KbTreeOrderStore;
		if (
			json &&
			json.version === 1 &&
			json.parentChildren &&
			typeof json.parentChildren === 'object' &&
			json.parentOverride &&
			typeof json.parentOverride === 'object'
		) {
			store = json;
		}
	} catch {
		store = { version: 1, parentChildren: {}, parentOverride: {} };
	}
};

const flush = async () => {
	await ensureLoaded();
	await fs.mkdir(ADMIN_DIR, { recursive: true });
	const tmp = `${ORDER_PATH}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
	await fs.rename(tmp, ORDER_PATH);
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

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const derivedParentPath = (p: string) => {
	const path = normalisePath(p);
	if (!path) return '';
	const parts = path.split('/').filter(Boolean);
	if (parts.length <= 1) return '';
	return `/${parts.slice(0, -1).join('/')}/`;
};

export const getKbTreeOrderSnapshot = async (): Promise<KbTreeOrderStore> => {
	await ensureLoaded();
	return {
		version: 1,
		parentChildren: JSON.parse(JSON.stringify(store.parentChildren || {})),
		parentOverride: { ...(store.parentOverride || {}) },
	};
};

export const getExplicitParentOverride = async (childPath: string) => {
	await ensureLoaded();
	const key = normalisePath(childPath);
	return key ? store.parentOverride[key] || '' : '';
};

export const listOrderedChildren = async (parentPath: string) => {
	await ensureLoaded();
	const key = normalisePath(parentPath);
	const v = key ? store.parentChildren[key] || [] : [];
	return Array.isArray(v) ? v.map(normalisePath).filter(Boolean) : [];
};

export const reorderTreeNode = async (input: {
	nodePath: string;
	derivedParentPath: string;
	toParentPath: string;
	toIndex: number;
	seed?: Record<string, string[]>;
}) => {
	await ensureLoaded();
	const nodePath = normalisePath(input.nodePath);
	const derivedParentPath = normalisePath(input.derivedParentPath);
	const toParentPath = normalisePath(input.toParentPath);
	const toIndex = Math.max(0, Math.floor(Number(input.toIndex) || 0));
	const seed = input.seed && typeof input.seed === 'object' ? input.seed : null;

	if (!nodePath || !toParentPath) throw Object.assign(new Error('invalid_path'), { status: 400 });
	if (nodePath === '/docs/' || nodePath === '/es/docs/' || nodePath === '/blog/' || nodePath === '/general-information/') {
		throw Object.assign(new Error('cannot_move_root'), { status: 400 });
	}
	if (toParentPath.startsWith(nodePath)) throw Object.assign(new Error('cannot_move_into_descendant'), { status: 400 });

	const oldParent = (store.parentOverride[nodePath] && normalisePath(store.parentOverride[nodePath]!)) || derivedParentPath;
	if (!oldParent) throw Object.assign(new Error('missing_parent'), { status: 400 });

	const seedParent = (parent: string) => {
		if (!seed) return;
		const hintRaw = seed[parent] || seed[normalisePath(parent)];
		if (!Array.isArray(hintRaw) || !hintRaw.length) return;
		const hint = Array.from(new Set(hintRaw.map(normalisePath).filter(Boolean)));
		if (!hint.length) return;
		const existing = Array.isArray(store.parentChildren[parent]) ? store.parentChildren[parent]!.map(normalisePath).filter(Boolean) : [];
		if (!existing.length) {
			store.parentChildren[parent] = hint;
			return;
		}
		const merged = hint.slice();
		for (const p of existing) {
			if (!merged.includes(p)) merged.push(p);
		}
		store.parentChildren[parent] = merged;
	};

	seedParent(oldParent);
	seedParent(toParentPath);

	const removeFrom = (parent: string) => {
		const cur = Array.isArray(store.parentChildren[parent]) ? [...store.parentChildren[parent]!] : [];
		const next = cur.map(normalisePath).filter(Boolean).filter((p) => p !== nodePath);
		if (next.length) store.parentChildren[parent] = next;
		else delete store.parentChildren[parent];
	};

	const insertInto = (parent: string) => {
		const cur = Array.isArray(store.parentChildren[parent]) ? [...store.parentChildren[parent]!] : [];
		const without = cur.map(normalisePath).filter(Boolean).filter((p) => p !== nodePath);
		const idx = Math.max(0, Math.min(toIndex, without.length));
		without.splice(idx, 0, nodePath);
		store.parentChildren[parent] = without;
	};

	removeFrom(oldParent);
	insertInto(toParentPath);

	if (derivedParentPath && derivedParentPath === toParentPath) delete store.parentOverride[nodePath];
	else store.parentOverride[nodePath] = toParentPath;

	await flushSoon();
	return { nodePath, fromParentPath: oldParent, toParentPath, toIndex };
};

export const renameTreePathPrefix = async (input: { fromPrefix: string; toPrefix: string }) => {
	await ensureLoaded();
	const from = normalisePath(input.fromPrefix);
	const to = normalisePath(input.toPrefix);
	if (!from || !to) throw Object.assign(new Error('invalid_path'), { status: 400 });
	if (from === to) return { ok: true, from, to, changed: false };

	const nextParentChildren: Record<string, string[]> = {};
	for (const [parentRaw, kidsRaw] of Object.entries(store.parentChildren || {})) {
		const parent = normalisePath(parentRaw);
		if (!parent) continue;
		const nextParent = parent.startsWith(from) ? normalisePath(`${to}${parent.slice(from.length)}`) : parent;
		const kids = Array.isArray(kidsRaw) ? kidsRaw : [];
		const mappedKids = Array.from(
			new Set(
				kids
					.map((k) => normalisePath(k))
					.filter(Boolean)
					.map((k) => (k.startsWith(from) ? normalisePath(`${to}${k.slice(from.length)}`) : k))
					.filter(Boolean),
			),
		);
		if (!mappedKids.length) continue;
		const existing = nextParentChildren[nextParent] || [];
		nextParentChildren[nextParent] = Array.from(new Set([...existing, ...mappedKids]));
	}
	store.parentChildren = nextParentChildren;

	const nextOverrides: Record<string, string> = {};
	for (const [childRaw, parentRaw] of Object.entries(store.parentOverride || {})) {
		const child = normalisePath(childRaw);
		const parent = normalisePath(parentRaw);
		if (!child || !parent) continue;
		const nextChild = child.startsWith(from) ? normalisePath(`${to}${child.slice(from.length)}`) : child;
		const nextParent = parent.startsWith(from) ? normalisePath(`${to}${parent.slice(from.length)}`) : parent;
		if (!nextChild || !nextParent) continue;
		const derived = derivedParentPath(nextChild);
		if (derived && derived === nextParent) continue;
		nextOverrides[nextChild] = nextParent;
	}
	store.parentOverride = nextOverrides;

	await flushSoon();
	return { ok: true, from, to, changed: true };
};

export const sortPathsWithOrder = (opts: {
	parentPath: string;
	paths: string[];
	order: string[];
	fallbackCompare?: (a: string, b: string) => number;
}) => {
	const parentPath = normalisePath(opts.parentPath);
	const order = (opts.order || []).map(normalisePath).filter(Boolean);
	const fallbackCompare = opts.fallbackCompare || ((a, b) => a.localeCompare(b));
	const index = new Map(order.map((p, i) => [p, i]));
	const unique = Array.from(new Set((opts.paths || []).map(normalisePath).filter(Boolean)));
	unique.sort((a, b) => {
		const ai = index.has(a) ? (index.get(a) as number) : Infinity;
		const bi = index.has(b) ? (index.get(b) as number) : Infinity;
		if (ai !== bi) return ai - bi;
		return fallbackCompare(a, b);
	});
	return { parentPath, ordered: unique };
};
