import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import { assertAllowedPath } from '../../../../lib/adminContent';
import { addPrefixRedirect } from '../../../../lib/kbRedirects';

type Body = { mappings?: Array<{ from?: string; to?: string }> };

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const POST: APIRoute = async ({ request }) => {
	const session = assertAdmin(request);
	assertRole(session, ['admin']);
	assertCsrf(request, session);

	let body: Body = {};
	try {
		body = (await request.json()) as Body;
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	const mappings = Array.isArray(body.mappings) ? body.mappings : [];
	if (!mappings.length) return json(400, { ok: false, error: 'missing_mappings' });

	const applied: Array<{ from: string; to: string; changed: boolean }> = [];
	const skipped: Array<{ from: string; to: string; error: string }> = [];

	for (const m of mappings.slice(0, 2000)) {
		const fromRaw = String(m?.from || '').trim();
		const toRaw = String(m?.to || '').trim();
		if (!fromRaw || !toRaw) continue;
		let from = '';
		let to = '';
		try {
			from = assertAllowedPath('docs', fromRaw);
			to = assertAllowedPath('docs', toRaw);
		} catch (e: any) {
			skipped.push({ from: fromRaw, to: toRaw, error: String(e?.message || 'invalid_path') });
			continue;
		}
		try {
			const res = await addPrefixRedirect(from, to);
			applied.push({ from: res.from, to: res.to, changed: Boolean(res.changed) });
		} catch (e: any) {
			skipped.push({ from, to, error: String(e?.message || 'add_failed') });
		}
	}

	return json(200, {
		ok: true,
		counts: { requested: mappings.length, applied: applied.length, changed: applied.filter((x) => x.changed).length, skipped: skipped.length },
		applied,
		skipped,
	});
};

