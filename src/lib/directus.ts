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
};

export type KbPageListItem = Pick<KbPage, 'id' | 'language' | 'path' | 'title' | 'description'>;

export async function getKbPageByPath(path: string): Promise<KbPage | null> {
	const params = new URLSearchParams();
	params.set('filter[path][_eq]', path);
	params.set('limit', '1');
	params.set(
		'fields',
		[
			'id',
			'status',
			'language',
			'path',
			'title',
			'description',
			'body',
			'seo_title',
			'seo_description',
		].join(',')
	);

	const json = await directusGet<DirectusItemResponse<KbPage>>(`/items/kb_pages?${params.toString()}`);
	return json.data?.[0] ?? null;
}

export async function listKbPagesByPrefix(opts: {
	prefix: string;
	lang: 'en' | 'es';
	limit?: number;
}): Promise<KbPageListItem[]> {
	const { prefix, lang, limit = 24 } = opts;

	const params = new URLSearchParams();
	params.set('filter[status][_eq]', 'published');
	params.set('filter[language][_eq]', lang);
	params.set('filter[path][_starts_with]', prefix);
	params.set('sort', '-id');
	params.set('limit', `${limit}`);
	params.set('fields', ['id', 'language', 'path', 'title', 'description'].join(','));

	const json = await directusGet<DirectusItemResponse<KbPageListItem>>(`/items/kb_pages?${params.toString()}`);
	return Array.isArray(json.data) ? json.data : [];
}
