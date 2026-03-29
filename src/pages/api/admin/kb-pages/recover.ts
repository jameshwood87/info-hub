import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { assertAllowedPath, findLatestSnapshotByPath, removeKbLifecycle, sanitiseKbWrite, writeAudit } from '../../../../lib/adminContent';
import { adminCreateKbPage, adminGetKbPageByPath, adminUpdateKbPage } from '../../../../lib/directus';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const scopeForPath = (p: string) => {
	const path = String(p || '');
	if (path.startsWith('/docs/') || path.startsWith('/es/docs/')) return 'docs' as const;
	if (path.startsWith('/neighbourhood/') || path.startsWith('/es/barrios/')) return 'neighbourhood' as const;
	if (path.startsWith('/andalucia/') || path.startsWith('/es/andalucia/')) return 'area' as const;
	return 'blog' as const;
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
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

		const pathRaw = String(body?.path || '');
		if (!pathRaw) return json(400, { ok: false, error: 'missing_path' });

		const scope = scopeForPath(pathRaw);
		const targetPath = assertAllowedPath(scope, pathRaw);

		const snap = await findLatestSnapshotByPath({ path: targetPath }).catch(() => null);
		if (!snap) return json(404, { ok: false, error: 'no_recoverable_snapshot' });

		const page = snap.page || {};
		const payload = sanitiseKbWrite({
			status: 'draft',
			language: page.language === 'es' ? 'es' : 'en',
			path: targetPath,
			title: String(page.title || 'Recovered'),
			description: page.description ?? null,
			body: page.body ?? null,
			seo_title: page.seo_title ?? null,
			seo_description: page.seo_description ?? null,
		});

		const existing = await adminGetKbPageByPath(targetPath).catch(() => null);
		const item = existing ? await adminUpdateKbPage(existing.id, payload) : await adminCreateKbPage(payload);
		if (existing) await removeKbLifecycle({ id: existing.id }).catch(() => undefined);
		await writeAudit({
			action: 'kb_pages.recover',
			userId: session.userId,
			kbPageId: item.id,
			path: item.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { recoveredFromAt: new Date(snap.atMs).toISOString(), upsert: Boolean(existing) },
		}).catch(() => undefined);

		return json(200, { ok: true, item });
	} catch (e: any) {
		const status = typeof e?.status === 'number' ? e.status : 500;
		const raw = String(e?.message || 'server_error');
		if (raw.startsWith('Directus request failed: 409')) return json(409, { ok: false, error: 'path_conflict' });
		return json(status, { ok: false, error: status === 500 ? 'server_error' : raw });
	}
};
