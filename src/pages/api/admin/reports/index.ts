import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { assertAdmin, assertCsrf } from '../../../../lib/adminAuth';

const STORE = '/opt/info-hub/var/admin/issue-reports.json';
const json = (status: number, body: any) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

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
// normalise a reported subject for repeat detection
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/https?:\/\/(www\.)?/g, '').replace(/[^a-z0-9]+/g, '');

export const GET: APIRoute = async ({ request }) => {
	assertAdmin(request);
	const all = await readAll();
	// count how many times each normalised subject appears (only where a subject was given)
	const counts: Record<string, number> = {};
	for (const r of all) {
		const k = norm(r.subject);
		if (k) counts[k] = (counts[k] || 0) + 1;
	}
	const enriched = all
		.map((r) => ({ ...r, flagKey: norm(r.subject), flagCount: norm(r.subject) ? counts[norm(r.subject)] : 1 }))
		.sort((a, b) => String(b.at).localeCompare(String(a.at)));
	const repeats = Object.entries(counts)
		.filter(([, n]) => n >= 2)
		.map(([k, n]) => ({ key: k, count: n, subject: (all.find((r) => norm(r.subject) === k) || {}).subject || k }))
		.sort((a, b) => b.count - a.count);
	return json(200, { ok: true, reports: enriched, repeats, total: all.length, newCount: all.filter((r) => r.status === 'new').length });
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = assertAdmin(request);
		assertCsrf(request, session);
		const body: any = await request.json().catch(() => null);
		const id = String(body?.id || '');
		const status = String(body?.status || '');
		const note = String(body?.note || '').slice(0, 1000);
		const del = body?.action === 'delete';
		if (!id) return json(400, { ok: false, error: 'bad_request' });
		let all = await readAll();
		if (del) {
			all = all.filter((r) => r.id !== id);
			await writeAll(all);
			return json(200, { ok: true, action: 'deleted' });
		}
		const r = all.find((x) => x.id === id);
		if (!r) return json(404, { ok: false, error: 'not_found' });
		if (['new', 'reviewing', 'actioned', 'dismissed'].includes(status)) r.status = status;
		if (note) r.note = note;
		r.decidedAt = new Date().toISOString();
		await writeAll(all);
		return json(200, { ok: true, status: r.status });
	} catch (e: any) {
		return json(e?.status === 403 ? 403 : 500, { ok: false, error: String(e?.message || e) });
	}
};
