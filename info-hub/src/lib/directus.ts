type DirectusItemResponse<T> = { data: T[] };

const DEFAULT_DIRECTUS_URL = 'http://127.0.0.1:8055';

function directusUrl(): string {
	return ((process.env.DIRECTUS_URL as string | undefined) || import.meta.env.DIRECTUS_URL || DEFAULT_DIRECTUS_URL).replace(
		/\/+$/,
		''
	);
}

function directusToken(): string | undefined {
	return (process.env.DIRECTUS_TOKEN as string | undefined) || import.meta.env.DIRECTUS_TOKEN || undefined;
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

const decodeHtmlEntities = (s: string) =>
	s
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&nbsp;', ' ');

const stripInfoHubSuffix = (s: string) => String(s || '').replace(/\s*(?:•|-)\s*PropertyList Info Hub\s*$/i, '').trim();

const applyCase = (source: string, replacement: string) => {
	if (source.toUpperCase() === source) return replacement.toUpperCase();
	if (source[0]?.toUpperCase() === source[0]) return replacement[0]!.toUpperCase() + replacement.slice(1);
	return replacement;
};

const toBritishEnglish = (s: string) => {
	let out = String(s || '');

	const rules: Array<[RegExp, string]> = [
		[/\bmonetiz(e|es|ed|ing|ation|ations|er|ers)\b/gi, 'monetis$1'],
		[/\boptimiz(e|es|ed|ing|ation|ations|er|ers)\b/gi, 'optimis$1'],
		[/\bmaximiz(e|es|ed|ing|ation|ations)\b/gi, 'maximis$1'],
		[/\bminimiz(e|es|ed|ing|ation|ations)\b/gi, 'minimis$1'],
		[/\bprioritiz(e|es|ed|ing|ation|ations)\b/gi, 'prioritis$1'],
		[/\bcustomiz(e|es|ed|ing|ation|ations|able)\b/gi, 'customis$1'],
		[/\borganis(e|es|ed|ing|ation|ations|er|ers)\b/gi, 'organis$1'],
		[/\borganiz(e|es|ed|ing|ation|ations|er|ers)\b/gi, 'organis$1'],
		[/\banalyz(e|es|ed|ing|er|ers)\b/gi, 'analys$1'],
		[/\bsynchroniz(e|es|ed|ing|ation|ations)\b/gi, 'synchronis$1'],
	];

	for (const [re, replacement] of rules) {
		out = out.replace(re, (match, suffix) => applyCase(match, replacement.replace('$1', suffix)));
	}

	return out;
};

export const normaliseKbText = (s: string, lang: string | undefined, opts?: { stripSuffix?: boolean; decode?: boolean }) => {
	const decoded = opts?.decode === false ? String(s || '') : decodeHtmlEntities(String(s || ''));
	const stripped = opts?.stripSuffix === false ? decoded : stripInfoHubSuffix(decoded);
	return lang === 'en' ? toBritishEnglish(stripped).trim() : stripped.trim();
};

const normaliseListItem = (p: KbPageListItem): KbPageListItem => ({
	...p,
	title: normaliseKbText(p.title, p.language, { stripSuffix: true, decode: true }),
	description: p.description ? normaliseKbText(p.description, p.language, { stripSuffix: false, decode: true }) : p.description,
});

const normalisePage = (p: KbPage): KbPage => ({
	...p,
	title: normaliseKbText(p.title, p.language, { stripSuffix: true, decode: true }),
	description: p.description ? normaliseKbText(p.description, p.language, { stripSuffix: false, decode: true }) : p.description,
	seo_title: p.seo_title ? normaliseKbText(p.seo_title, p.language, { stripSuffix: true, decode: true }) : p.seo_title,
	seo_description: p.seo_description
		? normaliseKbText(p.seo_description, p.language, { stripSuffix: false, decode: true })
		: p.seo_description,
	body: p.body && p.language === 'en' ? toBritishEnglish(p.body) : p.body,
});

export async function getKbPageByPath(path: string): Promise<KbPage | null> {
	const query = async (pathValue: string, fields: string[]) => {
		const params = new URLSearchParams();
		params.set('filter[path][_eq]', pathValue);
		params.set('limit', '1');
		params.set('fields', fields.join(','));
		const json = await directusGet<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
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
