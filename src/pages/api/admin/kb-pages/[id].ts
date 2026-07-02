import type { APIRoute } from 'astro';
import { canonicalAreaPath } from '../../../../lib/areaProvince';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { assertAllowedPath, assertLanguageMatchesPath, sanitiseKbWrite, snapshotVersion, trashKbPage, writeAudit } from '../../../../lib/adminContent';
import { getKbMeta, setKbMeta } from '../../../../lib/adminMeta';
import { addPrefixRedirect } from '../../../../lib/kbRedirects';
import {
	adminCreateKbPage,
	adminGetKbPageById,
	adminGetKbPageByPathLang,
	adminUpdateKbPage,
	mapDocsEnglishToSpanishPath,
	mapDocsSpanishToEnglishPath,
	type KbPageWrite,
} from '../../../../lib/directus';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const mapNeighbourhoodEnglishToSpanishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/neighbourhood/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return path;
	if (parts.length === 4 && parts[1] === 'andalucia' && parts[2] === 'malaga') {
		const slug = parts[3] || '';
		if (slug) return `/es/barrios/${slug}/`;
	}
	return path;
};

const mapNeighbourhoodSpanishToEnglishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/es/barrios/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'es' || parts[1] !== 'barrios') return path;
	const slug = parts[2] || '';
	if (!slug) return path;
	return canonicalAreaPath(slug);
};

const mapAreaEnglishToSpanishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/andalucia/')) return path;
	return `/es${path.startsWith('/') ? path : `/${path}`}`;
};

const mapAreaSpanishToEnglishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/es/andalucia/')) return path;
	return path.replace(/^\/es\//, '/');
};

const makeSpanishTranslationPlaceholderBody = (enPath: string) =>
	`<h2>Traducción en curso</h2><p>Estamos preparando la versión en español de esta página.</p><p>Mientras tanto, puedes ver la versión en inglés: <a href="${enPath}">Abrir en inglés</a>.</p>`;

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

const scopeForPath = (p: string) => {
	const path = String(p || '');
	if (path.startsWith('/docs/') || path.startsWith('/es/docs/')) return 'docs' as const;
	if (path.startsWith('/neighbourhood/') || path.startsWith('/es/barrios/')) return 'neighbourhood' as const;
	if (path.startsWith('/andalucia/') || path.startsWith('/es/andalucia/')) return 'area' as const;
	return 'blog' as const;
};

export const GET: APIRoute = async ({ request, params, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		const id = String(params.id || '');
		const page = await adminGetKbPageById(id).catch(() => null);
		if (!page) return json(404, { ok: false, error: 'not_found' });

		await writeAudit({
			action: 'kb_pages.get',
			userId: session.userId,
			kbPageId: page.id,
			path: page.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
		}).catch(() => undefined);

		return json(200, { ok: true, item: page });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

export const PATCH: APIRoute = async ({ request, params, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		assertCsrf(request, session);

		const id = String(params.id || '');
		const existing = await adminGetKbPageById(id).catch(() => null);
		if (!existing) return json(404, { ok: false, error: 'not_found' });

		let body: any = null;
		try {
			body = await request.json();
		} catch {
			return json(400, { ok: false, error: 'invalid_json' });
		}

		const patch = body?.patch as Partial<KbPageWrite> | undefined;
		if (!patch) return json(400, { ok: false, error: 'missing_patch' });

		const scope = scopeForPath(existing.path);
		const prevPath = existing.path;
		const prevLang = existing.language === 'es' ? 'es' : 'en';
		const nextPath = patch.path ? assertAllowedPath(scope, patch.path) : existing.path;
		const sanitised = sanitiseKbWrite({
			status: patch.status ?? existing.status,
			language: (patch.language ?? existing.language) as any,
			path: nextPath,
			title: patch.title ?? existing.title,
			description: patch.description ?? existing.description ?? null,
			body: patch.body ?? existing.body ?? null,
			seo_title: patch.seo_title ?? existing.seo_title ?? null,
			seo_description: patch.seo_description ?? existing.seo_description ?? null,
		});
		assertLanguageMatchesPath(scope, sanitised.language, sanitised.path);

		await snapshotVersion(existing, session.userId).catch(() => undefined);
		const updated = await adminUpdateKbPage(id, sanitised);
		if (prevPath && updated.path && prevPath !== updated.path) {
			await addPrefixRedirect(prevPath, updated.path).catch(() => undefined);
		}

		let translation: null | { ok: boolean; id?: string; path?: string; language?: string; error?: string } = null;
		const isSupportedScope = scope === 'docs' || scope === 'neighbourhood' || scope === 'area';
		if (isSupportedScope) {
			const sourceLang = updated.language === 'es' ? 'es' : 'en';
			const targetLang = sourceLang === 'en' ? 'es' : 'en';
			const autoPublishTranslation = String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES_PUBLISH') || '').trim() === '1';

			const enPath =
				scope === 'docs'
					? updated.path.startsWith('/es/docs/')
						? mapDocsSpanishToEnglishPath(updated.path)
						: updated.path
					: scope === 'neighbourhood'
						? updated.path.startsWith('/es/barrios/')
							? mapNeighbourhoodSpanishToEnglishPath(updated.path)
							: updated.path
						: updated.path.startsWith('/es/andalucia/')
							? mapAreaSpanishToEnglishPath(updated.path)
							: updated.path;

			const esPath =
				scope === 'docs'
					? enPath.startsWith('/docs/')
						? mapDocsEnglishToSpanishPath(enPath)
						: mapDocsEnglishToSpanishPath(updated.path)
					: scope === 'neighbourhood'
						? mapNeighbourhoodEnglishToSpanishPath(enPath)
						: mapAreaEnglishToSpanishPath(enPath);

			const targetPath = targetLang === 'en' ? enPath : esPath;
			const prevEnPath =
				scope === 'docs'
					? prevPath.startsWith('/es/docs/')
						? mapDocsSpanishToEnglishPath(prevPath)
						: prevPath
					: scope === 'neighbourhood'
						? prevPath.startsWith('/es/barrios/')
							? mapNeighbourhoodSpanishToEnglishPath(prevPath)
							: prevPath
						: prevPath.startsWith('/es/andalucia/')
							? mapAreaSpanishToEnglishPath(prevPath)
							: prevPath;
			const prevEsPath =
				scope === 'docs'
					? prevEnPath.startsWith('/docs/')
						? mapDocsEnglishToSpanishPath(prevEnPath)
						: mapDocsEnglishToSpanishPath(prevPath)
					: scope === 'neighbourhood'
						? mapNeighbourhoodEnglishToSpanishPath(prevEnPath)
						: mapAreaEnglishToSpanishPath(prevEnPath);
			const prevTargetPath = targetLang === 'en' ? prevEnPath : prevEsPath;

			if (targetPath && targetPath !== updated.path) {
				try {
					const existingTarget = await adminGetKbPageByPathLang(targetPath, targetLang).catch(() => null);
					if (existingTarget) {
						translation = { ok: true, id: existingTarget.id, path: existingTarget.path, language: existingTarget.language };
					} else {
						const oldTarget = prevTargetPath ? await adminGetKbPageByPathLang(prevTargetPath, targetLang).catch(() => null) : null;
						if (oldTarget) {
							const status = targetLang === 'es' ? (autoPublishTranslation ? (updated.status as any) : ('draft' as any)) : (updated.status as any);
							const moved = await adminUpdateKbPage(oldTarget.id, {
								status,
								path: targetPath,
								title: updated.title,
								description: updated.description ?? null,
								seo_title: updated.seo_title ?? null,
								seo_description: updated.seo_description ?? null,
							} as any);
							translation = { ok: true, id: moved.id, path: moved.path, language: moved.language };
							await addPrefixRedirect(prevTargetPath, targetPath).catch(() => undefined);
						} else {
						const status = targetLang === 'es' ? (autoPublishTranslation ? (updated.status as any) : ('draft' as any)) : (updated.status as any);
						const body = targetLang === 'es' && sourceLang === 'en' ? makeSpanishTranslationPlaceholderBody(enPath) : (updated.body ?? null);
						const createdTranslation = await adminCreateKbPage(
							sanitiseKbWrite({
								status,
								language: targetLang as any,
								path: targetPath,
								title: updated.title,
								description: updated.description ?? null,
								body,
								seo_title: updated.seo_title ?? null,
								seo_description: updated.seo_description ?? null,
							})
						);

						const meta = await getKbMeta(updated.id).catch(() => null as any);
						if (meta && (meta.docCategories || meta.docCategory)) {
							await setKbMeta(createdTranslation.id, {
								docCategories: Array.isArray(meta.docCategories) ? meta.docCategories : undefined,
								docCategory: meta.docCategory || undefined,
							}).catch(() => undefined);
						}

						translation = { ok: true, id: createdTranslation.id, path: createdTranslation.path, language: createdTranslation.language };
						await writeAudit({
							action: 'kb_pages.translation.create',
							userId: session.userId,
							kbPageId: createdTranslation.id,
							path: createdTranslation.path,
							ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
							details: { sourceId: updated.id, sourcePath: updated.path, sourceLanguage: updated.language },
						}).catch(() => undefined);
						}
					}
				} catch (e: any) {
					translation = { ok: false, error: String(e?.message || 'error') };
				}
			}
		}

		await writeAudit({
			action: 'kb_pages.update',
			userId: session.userId,
			kbPageId: updated.id,
			path: updated.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { scope, status: updated.status, language: updated.language },
		});
		return json(200, { ok: true, item: updated, translation });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

export const DELETE: APIRoute = async ({ request, params, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		assertCsrf(request, session);

		const id = String(params.id || '');
		const existing = await adminGetKbPageById(id).catch(() => null);
		if (!existing) return json(404, { ok: false, error: 'not_found' });

		await snapshotVersion(existing, session.userId).catch(() => undefined);
		const trashed = await trashKbPage({
			id,
			by: session.userId,
			prevStatus: String(existing.status || 'draft'),
			path: existing.path,
			title: existing.title,
		});
		if (String(existing.status || '') !== 'draft') {
			await adminUpdateKbPage(id, { status: 'draft' }).catch(() => undefined);
		}
		await writeAudit({
			action: 'kb_pages.trash',
			userId: session.userId,
			kbPageId: existing.id,
			path: existing.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { until: trashed.until, prevStatus: trashed.prevStatus },
		});
		return json(200, { ok: true, trashed });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};
