import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../../lib/adminAuth';
import { snapshotVersion, trashKbPage, writeAudit } from '../../../../../lib/adminContent';
import { adminGetKbPageById, adminUpdateKbPage } from '../../../../../lib/directus';

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

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
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
		}).catch(() => undefined);

		return json(200, { ok: true, trashed });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

