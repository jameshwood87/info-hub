import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Property Services pre-registration. The services marketplace is not built yet,
// so this is a register-interest queue, not a signup. Same shape as the mobile-app
// waitlist: public endpoint, honeypot, per-IP rate limit, private JSON store owned
// by the infohub user. JSON POST is checkOrigin-exempt; the form-encoded fallback
// works from a real browser.
const STORE = '/opt/info-hub/var/admin/services-waitlist.json';
const WEBHOOK = (process.env.REPORT_WEBHOOK || '').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// best-effort in-process rate limit: 5 submissions per IP per hour
const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 5) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};
// behind Cloudflare the real client IP is cf-connecting-ip (spoofed values are stripped)
const clientIpOf = (request: Request, clientAddress?: string) =>
	String(request.headers.get('cf-connecting-ip') || clientAddress || 'unknown');

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);
	const ct = request.headers.get('content-type') || '';
	let email = '';
	let website = '';
	let trade = '';
	let business = '';
	let area = '';
	let lang = 'en';
	try {
		if (ct.includes('application/json')) {
			const b: any = await request.json();
			email = clean(b?.email, 160);
			website = clean(b?.website, 200);
			trade = clean(b?.trade, 60);
			business = clean(b?.business, 120);
			area = clean(b?.area, 120);
			lang = clean(b?.lang, 4);
		} else {
			const f = await request.formData();
			email = clean(f.get('email'), 160);
			website = clean(f.get('website'), 200);
			trade = clean(f.get('trade'), 60);
			business = clean(f.get('business'), 120);
			area = clean(f.get('area'), 120);
			lang = clean(f.get('lang'), 4);
		}
	} catch {
		return json({ ok: false, error: 'bad_request' }, 400);
	}
	lang = lang === 'es' ? 'es' : 'en';

	// honeypot: bots fill the hidden field -> pretend success, store nothing
	if (website) return json({ ok: true });
	if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);
	if (!trade) return json({ ok: false, error: 'missing_trade' }, 400);

	const rec = {
		id: 's_' + Date.now().toString(36),
		at: new Date().toISOString(),
		email: email.toLowerCase(),
		trade,
		business,
		area,
		lang,
	};
	try {
		let all: any[] = [];
		try {
			all = JSON.parse(await fs.readFile(STORE, 'utf8'));
		} catch {
			all = [];
		}
		if (!all.some((r) => String(r?.email || '').toLowerCase() === rec.email)) {
			all.push(rec);
			const tmp = STORE + '.tmp';
			await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
			await fs.rename(tmp, STORE);
		}
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}

	if (WEBHOOK) {
		try {
			await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					username: 'PropertyList Services',
					content: `New Property Services pre-registration: ${rec.trade}${rec.area ? ' in ' + rec.area : ''} (${rec.lang}).`,
				}),
			});
		} catch {
			/* best effort */
		}
	}
	await notifySubmission({
		kind: 'property services pre-registration',
		fields: [
			['Email', email],
			['Trade', trade],
			['Business', business || '-'],
			['Area', area || '-'],
			['Language', lang],
		],
		link: '/admin/leads',
	});
	return json({ ok: true });
};
