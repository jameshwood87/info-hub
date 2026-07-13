import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { assertAdmin, assertCsrf } from '../../../../lib/adminAuth';

const PROPOSALS = '/opt/info-hub/var/admin/content-proposals.json';
const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const ORIGIN = 'https://info.propertylist.es';

const json = (status: number, body: any) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const readAll = async (): Promise<any[]> => {
	try {
		return JSON.parse(await fs.readFile(PROPOSALS, 'utf8'));
	} catch {
		return [];
	}
};
const writeAll = async (list: any[]) => fs.writeFile(PROPOSALS, JSON.stringify(list, null, 2), 'utf8');

export const GET: APIRoute = async ({ request }) => {
	assertAdmin(request);
	const all = await readAll();
	return json(200, { ok: true, proposals: all.filter((p) => p.status === 'pending') });
};

export const POST: APIRoute = async ({ request }) => {
  try {
	const session = assertAdmin(request);
	assertCsrf(request, session);
	const body: any = await request.json().catch(() => null);
	const id = String(body?.id || '');
	const action = String(body?.action || '');
	if (!id || !['approve', 'discard'].includes(action)) return json(400, { ok: false, error: 'bad_request' });

	const all = await readAll();
	const p = all.find((x) => x.id === id && x.status === 'pending');
	if (!p) return json(404, { ok: false, error: 'not_found' });

	if (action === 'discard') {
		p.status = 'discarded';
		p.decidedAt = new Date().toISOString();
		await writeAll(all);
		return json(200, { ok: true, action: 'discarded' });
	}

	// approve: insert the section before an FAQ heading if present, else append
	const recRes = await fetch(`${DIRECTUS_URL}/items/kb_pages/${p.pageId}?fields=body`, { headers: { Authorization: `Bearer ${TOKEN}` } });
	if (!recRes.ok) return json(502, { ok: false, error: 'directus_read' });
	const cur = String((await recRes.json())?.data?.body || '');
	let next: string;
	const faq = cur.search(/<h2[^>]*>[^<]*(?:FAQ|Frequently asked|Preguntas)/i);
	if (faq !== -1) next = cur.slice(0, faq) + p.html + cur.slice(faq);
	else next = cur + p.html;

	const patch = await fetch(`${DIRECTUS_URL}/items/kb_pages/${p.pageId}`, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ body: next }),
	});
	if (!patch.ok) return json(502, { ok: false, error: 'directus_write' });

	// IndexNow ping (best effort)
	try {
		const key = (await fs.readFile('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8')).trim();
		await fetch('https://www.bing.com/indexnow', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: [ORIGIN + p.path] }),
		});
	} catch {
		/* ignore */
	}

	// verify it renders (best effort)
	let rendered = false;
	try {
		const live = await fetch(`http://127.0.0.1:3000${p.path}`, { signal: AbortSignal.timeout(6000) }).then((r) => r.text());
		rendered = live.includes(p.heading);
	} catch {
		/* ignore */
	}

	p.status = 'approved';
	p.decidedAt = new Date().toISOString();
	p.rendered = rendered;
	await writeAll(all);
	return json(200, { ok: true, action: 'approved', rendered });
  } catch (e: any) {
    return json(e?.status === 403 ? 403 : 500, { ok: false, error: String(e?.message || e) });
  }
};
