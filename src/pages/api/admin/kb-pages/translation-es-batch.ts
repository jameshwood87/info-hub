import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { normalisePath } from '../../../../lib/adminContent';
import { adminGetKbPagesByPathsLang, mapDocsEnglishToSpanishPath } from '../../../../lib/directus';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const mapError = (e: any) => {
	const status = typeof e?.status === 'number' ? e.status : 500;
	const raw = String(e?.message || 'server_error');
	if (raw === 'Directus admin token not configured') return { status: 500, error: 'directus_admin_token_missing' };
	if (raw.startsWith('Directus request failed: 401')) return { status: 502, error: 'directus_unauthorized' };
	if (raw.startsWith('Directus request failed: 403')) return { status: 502, error: 'directus_forbidden' };
	return { status, error: status === 500 ? 'server_error' : raw };
};

const isPlaceholder = (body: string | null | undefined) => String(body || '').includes('Traducción en curso');

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		assertCsrf(request, session);

		let body: any = null;
		try {
			body = await request.json();
		} catch {
			return json(400, { ok: false, error: 'invalid_json' });
		}

		const itemsRaw = Array.isArray(body?.items) ? body.items : [];
		const items = itemsRaw
			.map((it: any) => ({
				path: normalisePath(String(it?.path || '')),
				language: String(it?.language || ''),
				date_updated: String(it?.date_updated || ''),
				date_created: String(it?.date_created || ''),
			}))
			.filter((it: any) => it.path && it.path.startsWith('/docs/') && (it.language === 'en' || it.language === ''))
			.slice(0, 800);

		const sourceUpdatedMs = new Map<string, number>();
		const esPaths: string[] = [];
		for (const it of items) {
			const ms = Date.parse(it.date_updated || it.date_created || '') || 0;
			sourceUpdatedMs.set(it.path, ms);
			const es = mapDocsEnglishToSpanishPath(it.path);
			if (es && es.startsWith('/es/docs/')) esPaths.push(es);
		}

		const esPages = await adminGetKbPagesByPathsLang(esPaths, 'es');
		const esByPath = new Map<string, any>();
		for (const p of esPages) esByPath.set(normalisePath(String(p.path || '')), p);

		const map: Record<
			string,
			{
				esPath: string;
				exists: boolean;
				translated: boolean;
				reason: string;
			}
		> = {};

		for (const it of items) {
			const enPath = it.path;
			const esPath = normalisePath(mapDocsEnglishToSpanishPath(enPath));
			if (!esPath || !esPath.startsWith('/es/docs/')) {
				map[enPath] = { esPath: esPath || '', exists: false, translated: false, reason: 'unsupported' };
				continue;
			}
			const es = esByPath.get(esPath) || null;
			if (!es) {
				map[enPath] = { esPath, exists: false, translated: false, reason: 'missing' };
				continue;
			}
			const placeholder = isPlaceholder(es.body);
			const enMs = sourceUpdatedMs.get(enPath) || 0;
			const esMs = Date.parse(String(es.date_updated || es.date_created || '')) || 0;
			const stale = Boolean(enMs && esMs && enMs > esMs);
			const ok = !placeholder && !stale;
			map[enPath] = { esPath, exists: true, translated: ok, reason: ok ? 'ok' : placeholder ? 'placeholder' : stale ? 'stale' : 'unknown' };
		}

		return json(200, { ok: true, map });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

