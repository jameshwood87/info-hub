import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { sanitiseKbWrite, writeAudit } from '../../../../lib/adminContent';
import {
	adminCreateKbPage,
	adminGetKbPagesByPathsLang,
	adminGetKbPageById,
	adminGetKbPageByPathLang,
	adminListKbPagesByPrefix,
	adminUpdateKbPage,
	mapDocsEnglishToSpanishPath,
} from '../../../../lib/directus';
import { addPrefixRedirect } from '../../../../lib/kbRedirects';
import { canTranslateWithDeepL, deeplTranslate, deeplTranslateHtml } from '../../../../lib/deepl';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const isPlaceholderBody = (body: string) => String(body || '').includes('Traducción en curso');

const EN_WORDS = [
	'the',
	'and',
	'for',
	'with',
	'to',
	'from',
	'this',
	'that',
	'you',
	'your',
	'are',
	'not',
	'guide',
	'neighbourhood',
	'market',
	'buyers',
	'renters',
];
const ES_WORDS = [
	'de',
	'la',
	'el',
	'y',
	'para',
	'con',
	'este',
	'esta',
	'que',
	'tu',
	'tus',
	'guía',
	'barrio',
	'mercado',
	'compradores',
	'inquilinos',
];

const countWords = (text: string, words: string[]) => {
	const t = String(text || '').toLowerCase();
	let n = 0;
	for (const w of words) {
		const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g');
		const m = t.match(re);
		if (m) n += m.length;
	}
	return n;
};

const looksEnglish = (html: string) => {
	const text = String(html || '').replace(/<[^>]*>/g, ' ');
	const en = countWords(text, EN_WORDS);
	const es = countWords(text, ES_WORDS);
	if (es === 0 && en > 0) return true;
	return en >= es * 1.8 && en >= 25;
};

const mapError = (e: any) => {
	const status = typeof e?.status === 'number' ? e.status : 500;
	const raw = String(e?.message || 'server_error');
	if (raw === 'Directus admin token not configured') return { status: 500, error: 'directus_admin_token_missing' };
	if (raw.startsWith('Directus request failed: 401')) return { status: 502, error: 'directus_unauthorized' };
	if (raw.startsWith('Directus request failed: 403')) return { status: 502, error: 'directus_forbidden' };
	if (raw === 'missing_DEEPL_API_KEY') return { status: 400, error: 'deepl_unavailable' };
	if (raw === 'deepl_quota_exceeded') return { status: 429, error: 'deepl_quota_exceeded' };
	if (raw.startsWith('deepl_failed 456') && raw.toLowerCase().includes('quota exceeded')) return { status: 429, error: 'deepl_quota_exceeded' };
	if (raw.startsWith('deepl_failed')) return { status: 400, error: raw };
	return { status, error: status === 500 ? 'server_error' : raw };
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let sessionUserId = '';
	let ip = '';
	let cursorForLog = 0;
	try {
		const session = assertAdmin(request);
		assertRole(session, ['admin', 'editor']);
		assertCsrf(request, session);
		sessionUserId = session.userId;
		ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '';

		if (!canTranslateWithDeepL()) return json(400, { ok: false, error: 'deepl_unavailable' });

		const bodyRaw = await request.text().catch(() => '');
		const body = (() => {
			try {
				return JSON.parse(bodyRaw || '{}');
			} catch {
				return {};
			}
		})();

		const cursor = Math.max(0, Math.floor(Number(body?.cursor || 0)));
		cursorForLog = cursor;
		const pageSize = Math.max(20, Math.min(250, Math.floor(Number(body?.pageSize || 150))));
		const maxTranslate = Math.max(1, Math.min(25, Math.floor(Number(body?.maxTranslate || 1))));

		const docsEn = (await adminListKbPagesByPrefix({ prefix: '/docs/', lang: 'en', status: 'any', limit: pageSize, offset: cursor }))
			.map((it) => ({ ...it, path: normalisePath(it.path) }))
			.filter((it) => it.path.startsWith('/docs/'));

		const mapped = docsEn
			.map((it) => ({ source: it, esPath: normalisePath(mapDocsEnglishToSpanishPath(it.path)) }))
			.filter((it) => it.esPath.startsWith('/es/docs/'));

		const esPaths = mapped.map((it) => it.esPath);
		const existingEs = esPaths.length ? await adminGetKbPagesByPathsLang(esPaths, 'es').catch(() => []) : [];
		const existing = new Map(existingEs.map((p) => [normalisePath(p.path), p] as const));

		let created = 0;
		let updated = 0;
		let moved = 0;
		let translated = 0;
		const createdPaths: string[] = [];
		const translatedPaths: string[] = [];

		const findExistingTarget = async (canonicalPath: string) => {
			const hit = existing.get(canonicalPath) || null;
			if (hit) return { page: hit, path: canonicalPath, legacyFrom: '' };
			if (canonicalPath.includes('/empezar/')) {
				const legacy = canonicalPath.replace('/empezar/', '/getting-started/');
				const legacyHit = await adminGetKbPageByPathLang(legacy, 'es').catch(() => null);
				if (legacyHit) return { page: legacyHit, path: legacy, legacyFrom: legacy };
			}
			return { page: null, path: canonicalPath, legacyFrom: '' };
		};

		for (const it of mapped) {
			if (translated >= maxTranslate) break;
			const canonicalEsPath = it.esPath;
			const targetLookup = await findExistingTarget(canonicalEsPath);
			const target = targetLookup.page;

			const source = await adminGetKbPageById(String(it.source.id || '')).catch(() => null);
			if (!source) continue;

			const sourceUpdatedMs = Date.parse(String(source.date_updated || source.date_created || '')) || 0;
			const targetUpdatedMs = target ? Date.parse(String(target.date_updated || target.date_created || '')) || 0 : 0;
			const needs =
				!target ||
				!String(target.body || '').trim() ||
				isPlaceholderBody(String(target.body || '')) ||
				looksEnglish(String(target.body || '')) ||
				Boolean(targetUpdatedMs && sourceUpdatedMs && sourceUpdatedMs > targetUpdatedMs);
			if (!needs) continue;

			const fast = { maxAttempts: 1, timeoutMs: 18000 };
			const translatedTitle = source.title ? await deeplTranslate(String(source.title || ''), { html: false, ...fast }) : '';
			const translatedDescription = source.description ? await deeplTranslate(String(source.description || ''), { html: false, ...fast }) : null;
			const translatedSeoTitle = source.seo_title ? await deeplTranslate(String(source.seo_title || ''), { html: false, ...fast }) : null;
			const translatedSeoDesc = source.seo_description ? await deeplTranslate(String(source.seo_description || ''), { html: false, ...fast }) : null;
			const translatedBody = source.body ? await deeplTranslateHtml(String(source.body || ''), { maxChunkLen: 100000, ...fast }) : null;

			const payload = sanitiseKbWrite({
				status: 'draft',
				language: 'es' as any,
				path: canonicalEsPath,
				title: translatedTitle || String(source.title || ''),
				description: translatedDescription ?? null,
				body: translatedBody ?? null,
				seo_title: translatedSeoTitle ?? null,
				seo_description: translatedSeoDesc ?? null,
			});

			if (target) {
				const prevPath = normalisePath(String(target.path || ''));
				const next = await adminUpdateKbPage(String(target.id), payload);
				updated++;
				if (prevPath && prevPath !== canonicalEsPath) {
					await addPrefixRedirect(prevPath, canonicalEsPath).catch(() => undefined);
					moved++;
				}
				existing.set(canonicalEsPath, next);
			} else {
				const saved = await adminCreateKbPage(payload);
				created++;
				existing.set(canonicalEsPath, saved);
				if (createdPaths.length < 200) createdPaths.push(canonicalEsPath);
			}
			translated++;
			if (translatedPaths.length < 200) translatedPaths.push(canonicalEsPath);
		}

		const scanned = docsEn.length;
		const nextCursor = cursor + scanned;
		const done = scanned < pageSize;

		await writeAudit({
			action: 'kb_pages.translation.sync_es_structure',
			userId: sessionUserId,
			ip,
			details: {
				cursor,
				pageSize,
				scanned,
				nextCursor,
				done,
				maxTranslate,
				created,
				updated,
				moved,
				translated,
				sampleCreated: createdPaths.slice(0, 30),
				sampleTranslated: translatedPaths.slice(0, 30),
			},
		}).catch(() => undefined);

		return json(200, {
			ok: true,
			cursor,
			pageSize,
			scanned,
			nextCursor,
			done,
			maxTranslate,
			created,
			updated,
			moved,
			translated,
			sampleCreated: createdPaths,
			sampleTranslated: translatedPaths,
		});
	} catch (e: any) {
		if (sessionUserId) {
			await writeAudit({
				action: 'kb_pages.translation.sync_es_structure.error',
				userId: sessionUserId,
				ip,
				details: { cursor: cursorForLog, error: String(e?.message || e || 'error').slice(0, 500) },
			}).catch(() => undefined);
		}
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};
