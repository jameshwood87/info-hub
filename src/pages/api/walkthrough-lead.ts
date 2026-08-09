import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// 360 walkthrough interest lead (2026-08-09). The service is coming soon; the
// pricing cards on /360-walkthrough/ collect contact details per property type
// and promise "someone will be in touch shortly", so every lead must reach
// James by email. Durable local copy FIRST, then the notification, so a mail
// outage can delay but never lose one. Same bot screens as buyer-lead:
// honeypot, minimum fill time, per-IP rate limit.
const STORE = '/opt/info-hub/var/admin/walkthrough-leads.json';

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 6) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};

const TYPES = new Set(['apartment', 'townhouse', 'villa']);

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let b: any = {};
	try { b = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }

	// bot checks: honeypot filled, or submitted inhumanly fast
	if (String(b.company_fax || '').trim() !== '') return json({ ok: true });
	if (typeof b.t === 'number' && b.t >= 0 && b.t < 3000) return json({ ok: true });

	const ip = String(clientAddress || request.headers.get('cf-connecting-ip') || 'unknown');
	if (!allow(ip)) return json({ ok: false, error: 'rate_limited' }, 429);

	const clean = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n);
	const email = clean(b.email, 200), phone = clean(b.phone, 40);
	// "someone will be in touch" needs someone to be in touch WITH
	if (!email && !phone) return json({ ok: false, error: 'no_contact' }, 400);
	const ptype = clean(b.ptype, 20);
	if (!TYPES.has(ptype)) return json({ ok: false, error: 'bad_type' }, 400);

	const rec = {
		id: 'w_' + Date.now().toString(36),
		at: new Date().toISOString(),
		ptype,
		name: clean(b.name, 120),
		agency: clean(b.agency, 120),
		email, phone,
		lang: clean(b.lang, 5) || 'en',
	};

	// durable local copy (atomic)
	try {
		let all: any[] = [];
		try { all = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch { all = []; }
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}

	await notifySubmission({
		kind: '360 walkthrough request',
		fields: [
			['Property type', ptype],
			['Name', rec.name],
			['Agency', rec.agency],
			['Phone', phone],
			['Email', email],
			['Language', rec.lang],
		],
	});

	return json({ ok: true });
};
