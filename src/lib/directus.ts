type DirectusItemResponse<T> = { data: T[] };

import fs from 'node:fs';

const DEFAULT_DIRECTUS_URL = 'http://127.0.0.1:8055';

function readTokenFile(path: string | undefined): string | undefined {
	if (!path) return undefined;
	try {
		const v = fs.readFileSync(path, 'utf8').trim();
		return v ? v : undefined;
	} catch {
		return undefined;
	}
}

function directusUrl(): string {
	return ((process.env.DIRECTUS_URL as string | undefined) || import.meta.env.DIRECTUS_URL || DEFAULT_DIRECTUS_URL).replace(
		/\/+$/,
		''
	);
}

function directusToken(): string | undefined {
	return (
		(process.env.DIRECTUS_TOKEN as string | undefined) ||
		import.meta.env.DIRECTUS_TOKEN ||
		(process.env.DIRECTUS_ADMIN_TOKEN as string | undefined) ||
		import.meta.env.DIRECTUS_ADMIN_TOKEN ||
		undefined
	);
}

function directusAdminToken(): string | undefined {
	return (
		(process.env.DIRECTUS_ADMIN_TOKEN as string | undefined) ||
		import.meta.env.DIRECTUS_ADMIN_TOKEN ||
		directusToken() ||
		readTokenFile(process.env.DIRECTUS_ADMIN_TOKEN_FILE as string | undefined) ||
		undefined
	);
}

async function directusGet<T>(path: string): Promise<T> {
	const token = directusToken();
	const res = await fetch(`${directusUrl()}${path}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : undefined,
	});
	if (!res.ok) {
		throw new Error(`Directus request failed: ${res.status} ${path}`);
	}
	return (await res.json()) as T;
}

async function directusAdminRequest<T>(path: string, init?: { method?: string; body?: any }): Promise<T> {
	const token = directusAdminToken();
	if (!token) {
		throw new Error('Directus admin token not configured');
	}

	const headers = new Headers();
	headers.set('authorization', `Bearer ${token}`);
	if (init?.body !== undefined) headers.set('content-type', 'application/json');

	const res = await fetch(`${directusUrl()}${path}`, {
		method: init?.method || 'GET',
		headers,
		body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Directus request failed: ${res.status} ${path}${text ? `\n${text.slice(0, 600)}` : ''}`);
	}

	return (await res.json()) as T;
}

export type KbPage = {
	id: string;
	status: 'draft' | 'published' | string;
	language: 'en' | 'es' | string;
	path: string;
	title: string;
	description?: string | null;
	body?: string | null;
	seo_title?: string | null;
	seo_description?: string | null;
	date_created?: string | null;
	date_updated?: string | null;
};

export type KbPageListItem = Pick<KbPage, 'id' | 'language' | 'path' | 'title' | 'description' | 'date_created' | 'date_updated'>;

export type KbPageAdminListItem = Pick<
	KbPage,
	'id' | 'status' | 'language' | 'path' | 'title' | 'description' | 'date_created' | 'date_updated'
>;

export type KbPageWrite = Pick<KbPage, 'status' | 'language' | 'path' | 'title' | 'description' | 'body' | 'seo_title' | 'seo_description'>;

export type GetKbPageByPathOptions = {
	lang?: 'en' | 'es';
	status?: 'published' | 'any';
};

const decodeHtmlEntities = (s: string) =>
	s
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&nbsp;', ' ');

export const normaliseKbText = (s: string, _lang: string | undefined, opts?: { stripSuffix?: boolean; decode?: boolean }) => {
	const decoded = opts?.decode === false ? String(s || '') : decodeHtmlEntities(String(s || ''));
	return decoded.trim();
};

const normaliseListItem = <T extends { title: string; description?: string | null; language?: string }>(p: T): T => ({
	...p,
	title: normaliseKbText(p.title, (p as any).language, { stripSuffix: true, decode: true }),
	description: (p as any).description
		? normaliseKbText(String((p as any).description || ''), (p as any).language, { stripSuffix: false, decode: true })
		: (p as any).description,
} as T);

const normalisePage = (p: KbPage): KbPage => ({
	...p,
	title: normaliseKbText(p.title, p.language, { stripSuffix: true, decode: true }),
	description: p.description ? normaliseKbText(p.description, p.language, { stripSuffix: false, decode: true }) : p.description,
	seo_title: p.seo_title ? normaliseKbText(p.seo_title, p.language, { stripSuffix: true, decode: true }) : p.seo_title,
	seo_description: p.seo_description
		? normaliseKbText(p.seo_description, p.language, { stripSuffix: false, decode: true })
		: p.seo_description,
	body: p.body,
});

export const mapDocsSpanishToEnglishPath = (p: string) => {
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
	if (mapped === 'propertylist-mls-user-manual') {
		const sub = parts[2] || '';
		if (sub === 'empezar') parts[2] = 'getting-started';
	}
	return `/${parts.join('/')}/`;
};

export const mapDocsEnglishToSpanishPath = (p: string) => {
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
	if (mapped === 'propertylist-mls-manual-de-usuario') {
		const sub = parts[2] || '';
		if (sub === 'getting-started') parts[2] = 'empezar';
	}
	return `/es/${parts.join('/')}/`;
};

export async function getKbPageByPath(path: string, opts?: GetKbPageByPathOptions): Promise<KbPage | null> {
	const queryPublic = async (pathValue: string, fields: string[]) => {
		const params = new URLSearchParams();
		params.set('filter[path][_eq]', pathValue);
		if (opts?.status !== 'any') params.set('filter[status][_eq]', 'published');
		if (opts?.lang) params.set('filter[language][_eq]', opts.lang);
		params.set('sort', '-id');
		params.set('limit', '1');
		params.set('fields', fields.join(','));
		const json = await directusGet<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
		const raw = json.data?.[0] ?? null;
		return raw ? normalisePage(raw) : null;
	};

	const queryAdmin = async (pathValue: string, fields: string[]) => {
		const params = new URLSearchParams();
		params.set('filter[path][_eq]', pathValue);
		if (opts?.status !== 'any') params.set('filter[status][_eq]', 'published');
		if (opts?.lang) params.set('filter[language][_eq]', opts.lang);
		params.set('sort', '-id');
		params.set('limit', '1');
		params.set('fields', fields.join(','));
		const json = await directusAdminRequest<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
		const raw = json.data?.[0] ?? null;
		return raw ? normalisePage(raw) : null;
	};

	const pathsToTry = (() => {
		const p = String(path || '');
		if (!p) return [];
		const alt = p.endsWith('/') ? p.slice(0, -1) : `${p}/`;
		return alt && alt !== p ? [p, alt] : [p];
	})();

	const fieldsWithDates = [
		'id',
		'status',
		'language',
		'path',
		'title',
		'description',
		'body',
		'seo_title',
		'seo_description',
		'date_created',
		'date_updated',
	];

	const fieldsMinimal = ['id', 'status', 'language', 'path', 'title', 'description', 'body', 'seo_title', 'seo_description'];

	try {
		for (const p of pathsToTry) {
			const hit = await queryPublic(p, fieldsWithDates);
			const wantsPublished = opts?.status !== 'any';
			const isDocs = p.startsWith('/docs/') || p.startsWith('/es/docs/');
			const missingBody = hit && (!hit.body || !String(hit.body).trim());
			if (hit && wantsPublished && isDocs && missingBody) {
				try {
					const adminHit = await queryAdmin(p, fieldsWithDates);
					if (adminHit?.body && String(adminHit.body).trim()) return adminHit;
				} catch {}
			}
			if (hit) return hit;
		}
		return null;
	} catch {
		for (const p of pathsToTry) {
			const hit = await queryPublic(p, fieldsMinimal);
			if (hit) return hit;
		}
		return null;
	}
}

export async function listKbPagesByPrefix(opts: {
	prefix: string;
	lang: 'en' | 'es';
	limit?: number;
}): Promise<KbPageListItem[]> {
	const { prefix, lang, limit = 24 } = opts;

	const baseParams = new URLSearchParams();
	baseParams.set('filter[status][_eq]', 'published');
	baseParams.set('filter[language][_eq]', lang);
	baseParams.set('filter[path][_starts_with]', prefix);
	baseParams.set('sort', '-id');
	baseParams.set('limit', `${limit}`);

	const queryWithFields = async (fields: string[]) => {
		const params = new URLSearchParams(baseParams);
		params.set('fields', fields.join(','));
		const json = await directusGet<DirectusItemResponse<KbPageListItem>>(`/items/kb_pages?${params.toString()}`);
		return Array.isArray(json.data) ? json.data.map(normaliseListItem) : [];
	};

	try {
		return await queryWithFields(['id', 'language', 'path', 'title', 'description', 'date_created', 'date_updated']);
	} catch {
		return await queryWithFields(['id', 'language', 'path', 'title', 'description']);
	}
}

export async function listKbPagesByPrefixes(opts: {
	prefixes: string[];
	lang: 'en' | 'es';
	limit?: number;
}): Promise<KbPageListItem[]> {
	const { prefixes, lang, limit = 24 } = opts;
	const cleanedPrefixes = prefixes.map((p) => String(p || '')).filter(Boolean);
	if (!cleanedPrefixes.length) return [];

	const all: KbPageListItem[] = [];
	for (const prefix of cleanedPrefixes) {
		const items = await listKbPagesByPrefix({ prefix, lang, limit });
		all.push(...items);
	}
	return all;
}

export async function listKbMainDocs(opts: { lang: 'en' | 'es'; limit?: number }): Promise<KbPageListItem[]> {
	const lang = opts.lang === 'es' ? 'es' : 'en';
	const prefix = lang === 'es' ? '/es/docs/' : '/docs/';
	const limit = Math.max(1, Math.min(500, Number(opts.limit) || 200));

	const isNewer = (a: KbPageListItem, b: KbPageListItem) => {
		const ta = Date.parse(String(a.date_updated || a.date_created || '')) || 0;
		const tb = Date.parse(String(b.date_updated || b.date_created || '')) || 0;
		if (ta !== tb) return ta > tb;
		const na = Number(a.id);
		const nb = Number(b.id);
		if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb;
		return String(a.id || '').localeCompare(String(b.id || '')) > 0;
	};

	const dedupeByPath = (items: KbPageListItem[]) => {
		const byPath = new Map<string, KbPageListItem>();
		for (const it of items) {
			const p = String(it?.path || '');
			if (!p) continue;
			const prev = byPath.get(p);
			if (!prev || isNewer(it, prev)) byPath.set(p, it);
		}
		return Array.from(byPath.values()).sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
	};

	const queryRegex = async (request: (path: string) => Promise<DirectusItemResponse<KbPageListItem>>) => {
		const params = new URLSearchParams();
		params.set('filter[status][_eq]', 'published');
		params.set('filter[language][_eq]', lang);
		params.set('filter[path][_regex]', `^${prefix.replaceAll('/', '\\/')}(?:[^\\/]+)\\/$`);
		params.set('sort', 'path');
		params.set('limit', String(limit));
		params.set('fields', ['id', 'language', 'path', 'title', 'description', 'date_created', 'date_updated'].join(','));
		const json = await request(`/items/kb_pages?${params.toString()}`);
		const items = Array.isArray(json.data) ? json.data.map(normaliseListItem) : [];
		return dedupeByPath(items);
	};

	try {
		const items = await queryRegex((p) => directusGet<DirectusItemResponse<KbPageListItem>>(p));
		if (items.length) return items;
	} catch {}

	try {
		const items = await queryRegex((p) => directusAdminRequest<DirectusItemResponse<KbPageListItem>>(p));
		if (items.length) return items;
	} catch {}

	const queryByPrefix = async (request: (path: string) => Promise<DirectusItemResponse<KbPageListItem>>) => {
		const out: KbPageListItem[] = [];
		for (let offset = 0; offset < 10000; offset += 500) {
			const params = new URLSearchParams();
			params.set('filter[status][_eq]', 'published');
			params.set('filter[language][_eq]', lang);
			params.set('filter[path][_starts_with]', prefix);
			params.set('sort', 'path');
			params.set('limit', '500');
			params.set('offset', String(offset));
			params.set('fields', ['id', 'language', 'path', 'title', 'description', 'date_created', 'date_updated'].join(','));
			const json = await request(`/items/kb_pages?${params.toString()}`);
			const page = Array.isArray(json.data) ? json.data.map(normaliseListItem) : [];
			for (const it of page) {
				const p = String(it.path || '');
				const segs = p.startsWith(prefix) ? p.slice(prefix.length).split('/').filter(Boolean) : [];
				if (segs.length === 1) out.push(it);
			}
			if (page.length < 500) break;
		}
		return dedupeByPath(out);
	};

	try {
		return await queryByPrefix((p) => directusGet<DirectusItemResponse<KbPageListItem>>(p));
	} catch {
		return await queryByPrefix((p) => directusAdminRequest<DirectusItemResponse<KbPageListItem>>(p));
	}
}

export async function adminListKbPagesByPrefix(opts: {
	prefix: string;
	lang?: 'en' | 'es';
	status?: 'published' | 'draft' | 'any';
	limit?: number;
	offset?: number;
}): Promise<KbPageAdminListItem[]> {
	const prefix = String(opts.prefix || '');
	const limit = Math.max(1, Math.min(500, Number(opts.limit) || 200));
	const offset = Math.max(0, Number(opts.offset) || 0);

	const baseParams = new URLSearchParams();
	baseParams.set('filter[path][_starts_with]', prefix);
	if (opts.lang) baseParams.set('filter[language][_eq]', opts.lang);
	if (opts.status && opts.status !== 'any') baseParams.set('filter[status][_eq]', opts.status);
	baseParams.set('limit', String(limit));
	baseParams.set('offset', String(offset));

	const queryWith = async (fields: string[], sort: string) => {
		const params = new URLSearchParams(baseParams);
		params.set('sort', sort);
		params.set('fields', fields.join(','));
		const json = await directusAdminRequest<DirectusItemResponse<KbPageAdminListItem>>(`/items/kb_pages?${params.toString()}`);
		return Array.isArray(json.data) ? json.data.map(normaliseListItem) : [];
	};

	try {
		return await queryWith(
			['id', 'status', 'language', 'path', 'title', 'description', 'date_created', 'date_updated'],
			'-date_updated,-id'
		);
	} catch {
		return await queryWith(['id', 'status', 'language', 'path', 'title', 'description'], '-id');
	}
}

export async function adminGetKbPageById(id: string): Promise<KbPage | null> {
	const safeId = encodeURIComponent(String(id || ''));
	const json = await directusAdminRequest<{ data?: KbPage }>(`/items/kb_pages/${safeId}`);
	return json?.data ? normalisePage(json.data) : null;
}

export async function adminGetKbPageByPath(path: string): Promise<KbPage | null> {
	const query = async (pathValue: string, fields: string[]) => {
		const params = new URLSearchParams();
		params.set('filter[path][_eq]', pathValue);
		params.set('sort', '-id');
		params.set('limit', '1');
		params.set('fields', fields.join(','));
		const json = await directusAdminRequest<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
		const raw = json.data?.[0] ?? null;
		return raw ? normalisePage(raw) : null;
	};

	const pathsToTry = (() => {
		const p = String(path || '');
		if (!p) return [];
		const alt = p.endsWith('/') ? p.slice(0, -1) : `${p}/`;
		return alt && alt !== p ? [p, alt] : [p];
	})();

	const fieldsWithDates = [
		'id',
		'status',
		'language',
		'path',
		'title',
		'description',
		'body',
		'seo_title',
		'seo_description',
		'date_created',
		'date_updated',
	];

	const fieldsMinimal = ['id', 'status', 'language', 'path', 'title', 'description', 'body', 'seo_title', 'seo_description'];

	try {
		for (const p of pathsToTry) {
			const hit = await query(p, fieldsWithDates);
			if (hit) return hit;
		}
		return null;
	} catch {
		for (const p of pathsToTry) {
			const hit = await query(p, fieldsMinimal);
			if (hit) return hit;
		}
		return null;
	}
}

export async function adminGetKbPageByPathLang(path: string, lang: 'en' | 'es'): Promise<KbPage | null> {
	const safeLang = lang === 'en' || lang === 'es' ? lang : 'en';
	const query = async (pathValue: string, fields: string[]) => {
		const params = new URLSearchParams();
		params.set('filter[path][_eq]', pathValue);
		params.set('filter[language][_eq]', safeLang);
		params.set('sort', '-id');
		params.set('limit', '1');
		params.set('fields', fields.join(','));
		const json = await directusAdminRequest<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
		const raw = json.data?.[0] ?? null;
		return raw ? normalisePage(raw) : null;
	};

	const pathsToTry = (() => {
		const p = String(path || '');
		if (!p) return [];
		const alt = p.endsWith('/') ? p.slice(0, -1) : `${p}/`;
		return alt && alt !== p ? [p, alt] : [p];
	})();

	const fieldsWithDates = [
		'id',
		'status',
		'language',
		'path',
		'title',
		'description',
		'body',
		'seo_title',
		'seo_description',
		'date_created',
		'date_updated',
	];

	const fieldsMinimal = ['id', 'status', 'language', 'path', 'title', 'description', 'body', 'seo_title', 'seo_description'];

	try {
		for (const p of pathsToTry) {
			const hit = await query(p, fieldsWithDates);
			if (hit) return hit;
		}
		return null;
	} catch {
		for (const p of pathsToTry) {
			const hit = await query(p, fieldsMinimal);
			if (hit) return hit;
		}
		return null;
	}
}

export async function adminGetKbPagesByPathsLang(paths: string[], lang: 'en' | 'es'): Promise<KbPage[]> {
	const safeLang = lang === 'en' || lang === 'es' ? lang : 'en';
	const uniq = Array.from(new Set(paths.map((p) => String(p || '').trim()).filter(Boolean)));
	if (!uniq.length) return [];

	const fields = ['id', 'status', 'language', 'path', 'title', 'description', 'body', 'seo_title', 'seo_description', 'date_created', 'date_updated'];
	const out: KbPage[] = [];
	const chunkSize = 40;

	for (let i = 0; i < uniq.length; i += chunkSize) {
		const chunk = uniq.slice(i, i + chunkSize);
		try {
			const params = new URLSearchParams();
			params.set('filter[language][_eq]', safeLang);
			params.set('filter[path][_in]', chunk.join(','));
			params.set('sort', '-id');
			params.set('limit', `${Math.max(1, chunk.length)}`);
			params.set('fields', fields.join(','));
			const json = await directusAdminRequest<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
			const items = Array.isArray(json.data) ? json.data : [];
			out.push(...items.map(normalisePage));
		} catch {
			for (const p of chunk) {
				const hit = await adminGetKbPageByPathLang(p, safeLang).catch(() => null);
				if (hit) out.push(hit);
			}
		}
	}

	const dedup = new Map<string, KbPage>();
	for (const it of out) {
		const key = `${String(it.path || '').trim()}|${String(it.language || '').trim()}`;
		if (!dedup.has(key)) dedup.set(key, it);
	}
	return Array.from(dedup.values());
}

export async function adminCreateKbPage(payload: KbPageWrite): Promise<KbPage> {
	const json = await directusAdminRequest<{ data: KbPage }>(`/items/kb_pages`, { method: 'POST', body: payload });
	return normalisePage(json.data);
}

export async function adminUpdateKbPage(id: string, payload: Partial<KbPageWrite>): Promise<KbPage> {
	const safeId = encodeURIComponent(String(id || ''));
	const json = await directusAdminRequest<{ data: KbPage }>(`/items/kb_pages/${safeId}`, { method: 'PATCH', body: payload });
	return normalisePage(json.data);
}

export async function adminDeleteKbPage(id: string): Promise<void> {
	const safeId = encodeURIComponent(String(id || ''));
	await directusAdminRequest(`/items/kb_pages/${safeId}`, { method: 'DELETE' });
}
