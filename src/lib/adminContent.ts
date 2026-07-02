import fs from 'node:fs/promises';
import path from 'node:path';
import { normaliseKbText, type KbPage, type KbPageWrite } from './directus';

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const ADMIN_DIR = path.join(VAR_DIR, 'admin');
const AUDIT_LOG_PATH = path.join(ADMIN_DIR, 'audit.jsonl');
const VERSIONS_DIR = path.join(ADMIN_DIR, 'versions');
const LIFECYCLE_PATH = path.join(ADMIN_DIR, 'kb-lifecycle.json');

export type AdminScope = 'blog' | 'docs' | 'neighbourhood' | 'area';

type KbLifecycleStore = {
	version: 1;
	archived: Record<string, { at: string; by: string; prevStatus: string }>;
	trashed: Record<string, { at: string; by: string; until: string; prevStatus: string; path: string; title: string }>;
};

const retentionDays = () => {
	const raw = (process.env.INFO_HUB_TRASH_RETENTION_DAYS as string | undefined) || (import.meta as any).env?.INFO_HUB_TRASH_RETENTION_DAYS;
	const n = Math.floor(Number(raw || 30));
	return Number.isFinite(n) && n > 0 ? n : 30;
};

const retentionMs = () => retentionDays() * 24 * 60 * 60 * 1000;

const loadLifecycle = async (): Promise<KbLifecycleStore> => {
	try {
		const raw = await fs.readFile(LIFECYCLE_PATH, 'utf8');
		const parsed = JSON.parse(raw || '{}') as Partial<KbLifecycleStore>;
		const archived = parsed && typeof parsed.archived === 'object' && parsed.archived ? parsed.archived : {};
		const trashed = parsed && typeof parsed.trashed === 'object' && parsed.trashed ? parsed.trashed : {};
		return { version: 1, archived: archived as any, trashed: trashed as any };
	} catch {
		return { version: 1, archived: {}, trashed: {} };
	}
};

const saveLifecycle = async (next: KbLifecycleStore) => {
	await fs.mkdir(ADMIN_DIR, { recursive: true });
	const tmp = `${LIFECYCLE_PATH}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(next), 'utf8');
	await fs.rename(tmp, LIFECYCLE_PATH);
};

export const getKbLifecycleSnapshot = async () => {
	const store = await loadLifecycle();
	return store;
};

export const getKbLifecycleForId = async (id: string) => {
	const safeId = String(id || '');
	if (!safeId) return { archived: null as any, trashed: null as any };
	const store = await loadLifecycle();
	return {
		archived: store.archived[safeId] || null,
		trashed: store.trashed[safeId] || null,
	};
};

export const archiveKbPage = async (input: { id: string; by: string; prevStatus: string; atMs?: number }) => {
	const id = String(input.id || '');
	if (!id) throw Object.assign(new Error('missing_id'), { status: 400 });
	const by = String(input.by || '').trim() || 'unknown';
	const prevStatus = String(input.prevStatus || 'draft');
	const at = new Date(typeof input.atMs === 'number' ? input.atMs : Date.now()).toISOString();
	const store = await loadLifecycle();
	delete store.trashed[id];
	store.archived[id] = { at, by, prevStatus };
	await saveLifecycle(store);
	return store.archived[id]!;
};

export const unarchiveKbPage = async (input: { id: string }) => {
	const id = String(input.id || '');
	if (!id) throw Object.assign(new Error('missing_id'), { status: 400 });
	const store = await loadLifecycle();
	const prev = store.archived[id] || null;
	delete store.archived[id];
	await saveLifecycle(store);
	return prev;
};

export const trashKbPage = async (input: { id: string; by: string; prevStatus: string; path: string; title: string; atMs?: number }) => {
	const id = String(input.id || '');
	if (!id) throw Object.assign(new Error('missing_id'), { status: 400 });
	const by = String(input.by || '').trim() || 'unknown';
	const prevStatus = String(input.prevStatus || 'draft');
	const nowMs = typeof input.atMs === 'number' ? input.atMs : Date.now();
	const at = new Date(nowMs).toISOString();
	const until = new Date(nowMs + retentionMs()).toISOString();
	const store = await loadLifecycle();
	delete store.archived[id];
	store.trashed[id] = {
		at,
		by,
		until,
		prevStatus,
		path: normalisePath(String(input.path || '')),
		title: String(input.title || ''),
	};
	await saveLifecycle(store);
	return store.trashed[id]!;
};

export const restoreKbPageFromTrash = async (input: { id: string }) => {
	const id = String(input.id || '');
	if (!id) throw Object.assign(new Error('missing_id'), { status: 400 });
	const store = await loadLifecycle();
	const prev = store.trashed[id] || null;
	delete store.trashed[id];
	delete store.archived[id];
	await saveLifecycle(store);
	return prev;
};

export const removeKbLifecycle = async (input: { id: string }) => {
	const id = String(input.id || '');
	if (!id) return;
	const store = await loadLifecycle();
	delete store.trashed[id];
	delete store.archived[id];
	await saveLifecycle(store);
};

export const popExpiredTrash = async (nowMs?: number) => {
	const now = typeof nowMs === 'number' ? nowMs : Date.now();
	const store = await loadLifecycle();
	const expired: Array<{ id: string; entry: KbLifecycleStore['trashed'][string] }> = [];
	for (const [id, entry] of Object.entries(store.trashed)) {
		const untilMs = Date.parse(String(entry?.until || ''));
		if (!Number.isFinite(untilMs)) continue;
		if (untilMs <= now) expired.push({ id, entry: entry as any });
	}
	if (!expired.length) return { expired: [], store };
	for (const { id } of expired) {
		delete store.trashed[id];
	}
	await saveLifecycle(store);
	return { expired, store };
};

export const findLatestSnapshotByPath = async (input: { path: string; withinMs?: number }) => {
	const want = normalisePath(String(input.path || ''));
	if (!want) return null;
	const withinMs = typeof input.withinMs === 'number' && input.withinMs > 0 ? input.withinMs : retentionMs();
	const cutoff = Date.now() - withinMs;

	let dirents: Array<{ name: string }> = [];
	try {
		dirents = (await fs.readdir(VERSIONS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => ({ name: d.name }));
	} catch {
		return null;
	}

	let best: { atMs: number; userId: string; page: any } | null = null;

	for (const d of dirents) {
		const idDir = path.join(VERSIONS_DIR, d.name);
		let files: string[] = [];
		try {
			files = (await fs.readdir(idDir)).filter((f) => f.endsWith('.json')).sort();
		} catch {
			continue;
		}
		if (!files.length) continue;
		for (let i = files.length - 1; i >= 0; i--) {
			const fp = path.join(idDir, files[i]!);
			let raw = '';
			try {
				raw = await fs.readFile(fp, 'utf8');
			} catch {
				continue;
			}
			let parsed: any = null;
			try {
				parsed = JSON.parse(raw || 'null');
			} catch {
				continue;
			}
			const atMs = Date.parse(String(parsed?.at || ''));
			if (!Number.isFinite(atMs)) continue;
			if (atMs < cutoff) break;
			const page = parsed?.page || null;
			const p = normalisePath(String(page?.path || ''));
			if (p !== want) continue;
			if (!best || atMs > best.atMs) {
				best = { atMs, userId: String(parsed?.userId || ''), page };
			}
			break;
		}
	}

	return best;
};

export const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

export const assertAllowedPath = (scope: AdminScope, p: string) => {
	const path = normalisePath(p);
	if (!path || !path.startsWith('/')) throw Object.assign(new Error('invalid_path'), { status: 400 });

	if (scope === 'blog') {
		if (path.startsWith('/blog/') || path.startsWith('/general-information/') || path.startsWith('/estate-agents/')) return path;
		throw Object.assign(new Error('invalid_blog_path'), { status: 400 });
	}

	if (scope === 'docs') {
		if (path.startsWith('/docs/') || path.startsWith('/es/docs/')) return path;
		throw Object.assign(new Error('invalid_docs_path'), { status: 400 });
	}

	if (scope === 'neighbourhood') {
		if (path.startsWith('/neighbourhood/') || path.startsWith('/es/barrios/')) return path;
		throw Object.assign(new Error('invalid_neighbourhood_path'), { status: 400 });
	}

	if (scope === 'area') {
		if (path.startsWith('/andalucia/') || path.startsWith('/es/andalucia/')) return path;
		throw Object.assign(new Error('invalid_area_path'), { status: 400 });
	}

	throw Object.assign(new Error('invalid_scope'), { status: 400 });
};

export const assertLanguageMatchesPath = (scope: AdminScope, languageRaw: string, pathRaw: string) => {
	const language = languageRaw === 'es' ? 'es' : 'en';
	const path = normalisePath(pathRaw);
	if (!path) throw Object.assign(new Error('invalid_path'), { status: 400 });

	if (scope === 'docs') {
		if (language === 'en' && path.startsWith('/docs/')) return;
		if (language === 'es' && path.startsWith('/es/docs/')) return;
		throw Object.assign(new Error('language_path_mismatch'), { status: 400 });
	}

	if (scope === 'neighbourhood') {
		if (language === 'en' && path.startsWith('/neighbourhood/')) return;
		if (language === 'es' && path.startsWith('/es/barrios/')) return;
		throw Object.assign(new Error('language_path_mismatch'), { status: 400 });
	}

	if (scope === 'area') {
		if (language === 'en' && path.startsWith('/andalucia/')) return;
		if (language === 'es' && path.startsWith('/es/andalucia/')) return;
		throw Object.assign(new Error('language_path_mismatch'), { status: 400 });
	}

	if (scope === 'blog') {
		if (language === 'es' && path.startsWith('/es/')) throw Object.assign(new Error('language_path_mismatch'), { status: 400 });
		return;
	}
};

const configuredSiteUrl = String(import.meta.env.PUBLIC_SITE_URL || '').trim() || 'https://info.propertylist.es';

const stripDangerousHtml = (html: string) => {
	let out = String(html || '');
	out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
	out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
	out = out.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
	out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
	out = out.replace(/javascript:/gi, '');
	const allowedIframeHosts = new Set([
		'info.propertylist.es',
		'propertylist.es',
		'www.propertylist.es',
		'agents.propertylist.es',
		'youtube.com',
		'www.youtube.com',
		'youtube-nocookie.com',
		'www.youtube-nocookie.com',
		'player.vimeo.com',
	]);
	out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, (full) => {
		const srcMatch = String(full).match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
		const src = srcMatch ? String(srcMatch[1] || srcMatch[2] || srcMatch[3] || '').trim() : '';
		if (!src) return '';
		let url: URL;
		try {
			url = new URL(src, configuredSiteUrl);
		} catch {
			return '';
		}
		if (String(url.protocol || '').toLowerCase() !== 'https:') return '';
		const host = String(url.hostname || '').toLowerCase();
		return allowedIframeHosts.has(host) ? full : '';
	});
	return out;
};

export const sanitiseKbWrite = (payload: KbPageWrite) => {
	const language = payload.language === 'es' ? 'es' : 'en';
	const status = payload.status === 'published' ? 'published' : 'draft';
	return {
		status,
		language,
		path: normalisePath(payload.path),
		title: normaliseKbText(String(payload.title || ''), language, { stripSuffix: false, decode: true }).slice(0, 220),
		description: payload.description ? normaliseKbText(String(payload.description || ''), language, { stripSuffix: false, decode: true }).slice(0, 420) : null,
		seo_title: payload.seo_title ? normaliseKbText(String(payload.seo_title || ''), language, { stripSuffix: false, decode: true }).slice(0, 220) : null,
		seo_description: payload.seo_description
			? normaliseKbText(String(payload.seo_description || ''), language, { stripSuffix: false, decode: true }).slice(0, 420)
			: null,
		body: payload.body ? stripDangerousHtml(String(payload.body || '')) : null,
	} satisfies KbPageWrite;
};

export const validateKbWrite = (payload: KbPageWrite) => {
	if (!payload.path) throw Object.assign(new Error('missing_path'), { status: 400 });
	if (!payload.title) throw Object.assign(new Error('missing_title'), { status: 400 });
	if (!payload.language) throw Object.assign(new Error('missing_language'), { status: 400 });
};

export const writeAudit = async (entry: {
	action: string;
	userId: string;
	kbPageId?: string;
	path?: string;
	ip?: string;
	details?: any;
}) => {
	const record = {
		at: new Date().toISOString(),
		...entry,
	};
	await fs.mkdir(ADMIN_DIR, { recursive: true });
	await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
};

export const snapshotVersion = async (page: KbPage, userId: string) => {
	const id = String(page.id || '');
	if (!id) return;
	const ts = new Date().toISOString().replaceAll(':', '-');
	const dir = path.join(VERSIONS_DIR, id);
	await fs.mkdir(dir, { recursive: true });
	const fp = path.join(dir, `${ts}.json`);
	await fs.writeFile(fp, JSON.stringify({ at: new Date().toISOString(), userId, page }), 'utf8');
};
