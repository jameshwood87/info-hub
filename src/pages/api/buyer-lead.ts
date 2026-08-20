import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Buyer/renter alert lead from the property finder (2026-07-08). Stores a local durable copy
// AND forwards to the Operations Hub, where these consumer leads can be routed to the agents
// who list in that area (the finder -> buyer-lead -> agent flywheel).
// Public endpoint: honeypot + timing + per-IP rate limit guard against bots.
const STORE = '/opt/info-hub/var/admin/buyer-leads.json';
const SURVEY_HUB = (process.env.SURVEY_HUB_URL || import.meta.env.SURVEY_HUB_URL || '').trim();
const HUB = SURVEY_HUB.replace('/api/survey/intake', '/api/leads/intake');
const SECRET = (process.env.SURVEY_SECRET || import.meta.env.SURVEY_SECRET || '').trim();

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 6) return false;
	list.push(now); recent.set(ip, list); return true;
};

const OPS = new Set(['for-sale', 'for-rent', 'holiday-rentals']);

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
	// an alert is useless without a way to reach them
	if (!email && !phone) return json({ ok: false, error: 'no_contact' }, 400);
	const op = clean(b.op, 20);
	if (!OPS.has(op)) return json({ ok: false, error: 'bad_op' }, 400);

	const rec = {
		id: 'l_' + Date.now().toString(36), at: new Date().toISOString(),
		op, area: clean(b.area, 60), area_name: clean(b.area_name, 80),
		budget: clean(b.budget, 40), beds: clean(b.beds, 10),
		name: clean(b.name, 120), email, phone,
		consent: b.consent === true, lang: clean(b.lang, 5) || 'en',
	};

	// durable local copy (atomic)
	try {
		let all: any[] = [];
		try { all = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch { all = []; }
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch { /* keep going - the hub forward is the primary sink */ }

	// forward to the Operations Hub (consumer lead feed for agents)
	if (HUB && SECRET) {
		try {
			await fetch(HUB, { method: 'POST',
				headers: { 'content-type': 'application/json', 'x-survey-secret': SECRET },
				body: JSON.stringify(rec) });
		} catch { /* best effort - local copy is the backup */ }
	}
	await notifySubmission({
		kind: 'buyer lead',
		fields: [['Name', rec.name], ['Email', rec.email], ['Phone', rec.phone], ['Looking for', rec.op], ['Area', rec.area_name || rec.area], ['Budget', rec.budget]],
		link: '/admin/leads',
	});
	return json({ ok: true });
};
