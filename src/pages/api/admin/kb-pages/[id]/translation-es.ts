import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../../lib/adminAuth';
import { assertLanguageMatchesPath, sanitiseKbWrite, writeAudit } from '../../../../../lib/adminContent';
import { adminCreateKbPage, adminGetKbPageById, adminGetKbPageByPathLang, adminUpdateKbPage, mapDocsEnglishToSpanishPath } from '../../../../../lib/directus';
import { canTranslateWithDeepL, deeplTranslate, deeplTranslateHtml } from '../../../../../lib/deepl';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const isPlaceholder = (body: string) => String(body || '').includes('Traducción en curso');

const mapError = (e: any) => {
	const status = typeof e?.status === 'number' ? e.status : 500;
	const raw = String(e?.message || 'server_error');
	if (raw === 'Directus admin token not configured') return { status: 500, error: 'directus_admin_token_missing' };
	if (raw.startsWith('Directus request failed: 401')) return { status: 502, error: 'directus_unauthorized' };
	if (raw.startsWith('Directus request failed: 403')) return { status: 502, error: 'directus_forbidden' };
	return { status, error: status === 500 ? 'server_error' : raw };
};

const computeStatus = async (sourceId: string) => {
	const source = await adminGetKbPageById(sourceId).catch(() => null);
	if (!source) throw Object.assign(new Error('not_found'), { status: 404 });

	const scope = source.path.startsWith('/docs/') || source.path.startsWith('/es/docs/') ? 'docs' : 'other';
	if (scope !== 'docs') throw Object.assign(new Error('not_supported'), { status: 400 });

	if (String(source.language || '') !== 'en') throw Object.assign(new Error('source_not_english'), { status: 400 });
	assertLanguageMatchesPath('docs', source.language, source.path);

	const sourceByPath = await adminGetKbPageByPathLang(source.path, 'en').catch(() => null);
	const sourceDates = sourceByPath || source;

	const esPath = mapDocsEnglishToSpanishPath(source.path);
	const target = esPath ? await adminGetKbPageByPathLang(esPath, 'es').catch(() => null) : null;

	const sourceUpdatedMs = Date.parse(String(sourceDates.date_updated || sourceDates.date_created || '')) || 0;
	const targetUpdatedMs = target ? Date.parse(String(target.date_updated || target.date_created || '')) || 0 : 0;
	const needsRetranslate = Boolean(
		(target && sourceUpdatedMs && targetUpdatedMs && sourceUpdatedMs > targetUpdatedMs) || (target && isPlaceholder(String(target.body || '')))
	);

	return {
		source: {
			id: source.id,
			path: source.path,
			status: source.status,
			language: source.language,
			date_created: sourceDates.date_created,
			date_updated: sourceDates.date_updated,
		},
		target: target
			? {
					id: target.id,
					path: target.path,
					status: target.status,
					language: target.language,
					date_created: target.date_created,
					date_updated: target.date_updated,
					isPlaceholder: isPlaceholder(String(target.body || '')),
				}
			: {
					id: '',
					path: esPath,
					status: '',
					language: 'es',
					date_created: '',
					date_updated: '',
					isPlaceholder: false,
				},
		autoTranslateEnabled: String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES') || '').trim() !== '0',
		autoPublishTranslation: String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES_PUBLISH') || '').trim() === '1',
		canTranslateWithDeepL: canTranslateWithDeepL(),
		needsRetranslate,
	};
};

export const GET: APIRoute = async ({ request, params }) => {
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		const id = String(params.id || '');
		const status = await computeStatus(id);
		return json(200, { ok: true, ...status });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		assertCsrf(request, session);

		const id = String(params.id || '');
		const statusBefore = await computeStatus(id);
		if (!statusBefore.canTranslateWithDeepL) return json(400, { ok: false, error: 'deepl_unavailable' });

		const source = await adminGetKbPageById(id).catch(() => null);
		if (!source) return json(404, { ok: false, error: 'not_found' });

		const esPath = statusBefore.target.path;
		const existingTarget = esPath ? await adminGetKbPageByPathLang(esPath, 'es').catch(() => null) : null;

		const translatedTitle = source.title ? await deeplTranslate(String(source.title || ''), { html: false }) : '';
		const translatedDescription = source.description ? await deeplTranslate(String(source.description || ''), { html: false }) : null;
		const translatedSeoTitle = source.seo_title ? await deeplTranslate(String(source.seo_title || ''), { html: false }) : null;
		const translatedSeoDesc = source.seo_description ? await deeplTranslate(String(source.seo_description || ''), { html: false }) : null;
		const translatedBody = source.body ? await deeplTranslateHtml(String(source.body || '')) : null;

		const autoPublishTranslation = statusBefore.autoPublishTranslation;
		const nextStatus = autoPublishTranslation ? (source.status as any) : (existingTarget?.status as any) || ('draft' as any);

		const payload = sanitiseKbWrite({
			status: nextStatus,
			language: 'es' as any,
			path: esPath,
			title: translatedTitle || String(source.title || ''),
			description: translatedDescription ?? null,
			body: translatedBody ?? null,
			seo_title: translatedSeoTitle ?? null,
			seo_description: translatedSeoDesc ?? null,
		});

		const saved = existingTarget ? await adminUpdateKbPage(String(existingTarget.id), payload) : await adminCreateKbPage(payload);

		await writeAudit({
			action: 'kb_pages.translation.translate_es',
			userId: session.userId,
			kbPageId: saved.id,
			path: saved.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { sourceId: source.id, sourcePath: source.path, targetPath: saved.path },
		}).catch(() => undefined);

		const statusAfter = await computeStatus(id);
		return json(200, { ok: true, saved, ...statusAfter });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};
