import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { assertAdmin, assertCsrf } from '../../../lib/adminAuth';

// Admin moderation for the public feature-request board.
const STORE = '/opt/info-hub/var/admin/feature-requests.json';
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const readAll = async (): Promise<any[]> => {
	try {
		const d = JSON.parse(await fs.readFile(STORE, 'utf8'));
		return Array.isArray(d) ? d : [];
	} catch {
		return [];
	}
};
const writeAll = async (list: any[]) => {
	const tmp = STORE + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
	await fs.rename(tmp, STORE);
};

const STATUSES = new Set(['pending', 'under-review', 'planned', 'building', 'improving', 'live', 'rejected']);

export const GET: APIRoute = async ({ request }) => {
	try {
		assertAdmin(request);
		const all = await readAll();
		const ideas = all
			.map(({ voterHashes, ...rest }) => ({ ...rest, voterCount: (voterHashes || []).length }))
			.sort((a, b) => String(b.at).localeCompare(String(a.at)));
		return json(200, { ok: true, ideas, pendingCount: all.filter((i) => i.status === 'pending').length });
	} catch (e: any) {
		return json(e?.status || 500, { ok: false, error: e?.message || 'error' });
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = assertAdmin(request);
		assertCsrf(request, session);
		const body: any = await request.json().catch(() => null);
		if (!body || typeof body.id !== 'string') return json(400, { ok: false, error: 'bad_request' });
		const all = await readAll();
		const idx = all.findIndex((i) => i.id === body.id);
		if (idx < 0) return json(404, { ok: false, error: 'not_found' });
		if (body.action === 'delete') {
			all.splice(idx, 1);
		} else if (body.action === 'status' && STATUSES.has(String(body.status))) {
			all[idx].status = String(body.status);
		} else if (body.action === 'edit') {
			if (typeof body.title === 'string' && body.title.trim()) all[idx].title = body.title.trim().slice(0, 120);
			if (typeof body.detail === 'string') all[idx].detail = body.detail.trim().slice(0, 1500);
		} else {
			return json(400, { ok: false, error: 'bad_action' });
		}
		await writeAll(all);
		return json(200, { ok: true });
	} catch (e: any) {
		return json(e?.status || 500, { ok: false, error: e?.message || 'error' });
	}
};
