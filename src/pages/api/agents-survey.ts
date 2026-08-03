import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Agents survey intake (2026-07-08). Stores a local durable copy AND forwards to the Operations
// Hub, which matches the response to an agent record so it feeds per-agent selling + strategy.
// Public endpoint: honeypot + timing + per-IP rate limit guard against bots.
const STORE = '/opt/info-hub/var/admin/agents-survey.json';
const HUB = (process.env.SURVEY_HUB_URL || import.meta.env.SURVEY_HUB_URL || '').trim();
const SECRET = (process.env.SURVEY_SECRET || import.meta.env.SURVEY_SECRET || '').trim();

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 4) return false;
	list.push(now); recent.set(ip, list); return true;
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let b: any = {};
	try { b = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }

	// bot checks: honeypot filled, or submitted inhumanly fast
	if (String(b.company_fax || '').trim() !== '') return json({ ok: true });
	if (typeof b.t === 'number' && b.t >= 0 && b.t < 3000) return json({ ok: true });

	const ip = String(clientAddress || request.headers.get('cf-connecting-ip') || 'unknown');
	if (!allow(ip)) return json({ ok: false, error: 'rate_limited' }, 429);

	const clean = (v: unknown, n = 500) => String(v ?? '').trim().slice(0, n);
	const rec = {
		id: 's_' + Date.now().toString(36), at: new Date().toISOString(),
		name: clean(b.name, 120), agency: clean(b.agency, 160), phone: clean(b.phone, 40), email: clean(b.email, 200),
		lang: clean(b.lang, 5) || 'en',
		listings_band: clean(b.listings_band, 40),
		portals: Array.isArray(b.portals) ? b.portals.map((x: any) => clean(x, 40)).slice(0, 12) : [],
		frustration: clean(b.frustration, 2000), top_value: clean(b.top_value, 60),
		mls_value: clean(b.mls_value, 40), switch_blocker: clean(b.switch_blocker, 2000),
		wants_followup: !!(clean(b.name) || clean(b.phone) || clean(b.email)),
	};
	// need at least one substantive answer
	if (!rec.listings_band && !rec.frustration && !rec.top_value && rec.portals.length === 0) {
		return json({ ok: false, error: 'empty' }, 400);
	}

	// durable local copy (atomic)
	try {
		let all: any[] = [];
		try { all = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch { all = []; }
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch { /* keep going - the hub forward is the primary sink */ }

	// forward to the Operations Hub for agent matching + outreach feed
	if (HUB && SECRET) {
		try {
			await fetch(HUB, { method: 'POST',
				headers: { 'content-type': 'application/json', 'x-survey-secret': SECRET },
				body: JSON.stringify(rec) });
		} catch { /* best effort - local copy is the backup */ }
	}
	await notifySubmission({
		kind: 'agents survey response',
		fields: [['Name', rec.name], ['Email', rec.email], ['Phone', rec.phone], ['Agency', rec.agency], ['Language', rec.lang]],
		link: '/admin/analytics',
	});
	return json({ ok: true });
};
