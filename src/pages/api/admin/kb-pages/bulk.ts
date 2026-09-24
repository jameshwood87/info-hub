import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import {
	archiveKbPage,
	removeKbLifecycle,
	restoreKbPageFromTrash,
	snapshotVersion,
	trashKbPage,
	unarchiveKbPage,
	writeAudit,
} from '../../../../lib/adminContent';
import { adminDeleteKbPage, adminGetKbPageById, adminUpdateKbPage } from '../../../../lib/directus';
import { checkBlogPublish, lintBlockedResponse, publishTwin, recordOverride } from '../../../../lib/blogPublishGate';

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

		const action = String(body?.action || '');
		const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x || '')).filter(Boolean) : [];
		if (!ids.length) return json(400, { ok: false, error: 'missing_ids' });

		const effectiveAction = action === 'delete' ? 'trash' : action;
		if (!['trash', 'restore', 'archive', 'unarchive', 'purge', 'publish', 'draft'].includes(effectiveAction)) {
			return json(400, { ok: false, error: 'invalid_action' });
		}
		if (effectiveAction === 'purge') assertRole(session, ['admin']);

		// Blog posts: lint before publishing (24-09-26). A blocked publish returns 409 with the
		// reasons; the admin page asks "publish anyway?" and resends with force, which is logged.
		const gateIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '';
		const gates = new Map<string, any>();
		if (effectiveAction === 'publish') {
			const blocked: Array<{ id: string; path: string; errors: string[] }> = [];
			for (const id of ids) {
				const p = await adminGetKbPageById(id).catch(() => null);
				if (!p || String(p.status || '') === 'published') continue;
				const g = await checkBlogPublish(p as any);
				if (!g.applies) continue;
				gates.set(id, g);
				if (!g.ok) blocked.push({ id, path: p.path, errors: g.errors });
			}
			if (blocked.length && body?.force !== true) return lintBlockedResponse(blocked);
		}

		const results: Array<{ id: string; ok: boolean; error?: string }> = [];
		for (const id of ids) {
			try {
				const existing = await adminGetKbPageById(id);
				if (!existing) {
					results.push({ id, ok: false, error: 'not_found' });
					continue;
				}
				await snapshotVersion(existing, session.userId).catch(() => undefined);
				if (effectiveAction === 'trash') {
					const trashed = await trashKbPage({
						id,
						by: session.userId,
						prevStatus: String(existing.status || 'draft'),
						path: existing.path,
						title: existing.title,
					});
					if (String(existing.status || '') !== 'draft') await adminUpdateKbPage(id, { status: 'draft' }).catch(() => undefined);
					results.push({ id, ok: true });
					await writeAudit({
						action: 'kb_pages.trash',
						userId: session.userId,
						kbPageId: existing.id,
						path: existing.path,
						ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
						details: { until: trashed.until, prevStatus: trashed.prevStatus, bulk: true },
					}).catch(() => undefined);
					continue;
				}

				if (effectiveAction === 'restore') {
					const prev = await restoreKbPageFromTrash({ id }).catch(() => null);
					const nextStatus = prev?.prevStatus === 'published' ? 'published' : 'draft';
					await adminUpdateKbPage(id, { status: nextStatus }).catch(() => undefined);
					results.push({ id, ok: true });
					await writeAudit({
						action: 'kb_pages.restore',
						userId: session.userId,
						kbPageId: existing.id,
						path: existing.path,
						ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
						details: { prevStatus: prev?.prevStatus || null, bulk: true },
					}).catch(() => undefined);
					continue;
				}

				if (effectiveAction === 'archive') {
					const archived = await archiveKbPage({
						id,
						by: session.userId,
						prevStatus: String(existing.status || 'draft'),
					});
					if (String(existing.status || '') !== 'draft') await adminUpdateKbPage(id, { status: 'draft' }).catch(() => undefined);
					results.push({ id, ok: true });
					await writeAudit({
						action: 'kb_pages.archive',
						userId: session.userId,
						kbPageId: existing.id,
						path: existing.path,
						ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
						details: { archivedAt: archived.at, prevStatus: archived.prevStatus, bulk: true },
					}).catch(() => undefined);
					continue;
				}

				if (effectiveAction === 'unarchive') {
					const prev = await unarchiveKbPage({ id }).catch(() => null);
					const nextStatus = prev?.prevStatus === 'published' ? 'published' : 'draft';
					await adminUpdateKbPage(id, { status: nextStatus }).catch(() => undefined);
					results.push({ id, ok: true });
					await writeAudit({
						action: 'kb_pages.unarchive',
						userId: session.userId,
						kbPageId: existing.id,
						path: existing.path,
						ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
						details: { prevStatus: prev?.prevStatus || null, bulk: true },
					}).catch(() => undefined);
					continue;
				}

				if (effectiveAction === 'purge') {
					await adminDeleteKbPage(id);
					await removeKbLifecycle({ id }).catch(() => undefined);
					results.push({ id, ok: true });
					await writeAudit({
						action: 'kb_pages.purge',
						userId: session.userId,
						kbPageId: existing.id,
						path: existing.path,
						ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
						details: { bulk: true },
					}).catch(() => undefined);
					continue;
				}

				const status = effectiveAction === 'publish' ? 'published' : effectiveAction === 'draft' ? 'draft' : existing.status;
				await adminUpdateKbPage(id, { status });
				if (effectiveAction === 'publish' && gates.has(id)) {
					const g = gates.get(id);
					if (!g.ok) await recordOverride({ userId: session.userId, ip: gateIp, path: existing.path, kbPageId: String(existing.id), errors: g.errors, via: 'admin publish button' });
					await publishTwin(g.twin, session.userId, gateIp);
				}
				results.push({ id, ok: true });
			} catch (e: any) {
				const { error } = mapError(e);
				results.push({ id, ok: false, error });
			}
		}

		await writeAudit({
			action: `kb_pages.bulk.${effectiveAction}`,
			userId: session.userId,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { ids, results },
		}).catch(() => undefined);

		return json(200, { ok: true, results });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};
