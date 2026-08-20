import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Mobile-app early-access waitlist. Public endpoint (no admin auth) with a
// honeypot + email validation. Stores to a private JSON queue (app runs as
// infohub, so the file is infohub-owned). JSON POST is checkOrigin-exempt;
// a form-encoded fallback also works from a real browser (sends Origin).
const STORE = '/opt/info-hub/var/admin/app-waitlist.json';
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

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);
	const ct = request.headers.get('content-type') || '';
	let email = '';
	let website = '';
	let lang = 'en';
	let source = 'mobile-app';
	try {
		if (ct.includes('application/json')) {
			const b: any = await request.json();
			email = String(b?.email || '').trim();
			website = String(b?.website || '').trim();
			lang = String(b?.lang || 'en');
			source = String(b?.source || 'mobile-app').slice(0, 40);
		} else {
			const f = await request.formData();
			email = String(f.get('email') || '').trim();
			website = String(f.get('website') || '').trim();
			lang = String(f.get('lang') || 'en');
			source = String(f.get('source') || 'mobile-app').slice(0, 40);
		}
	} catch {
		return json({ ok: false, error: 'bad_request' }, 400);
	}
	lang = lang === 'es' ? 'es' : 'en';

	// honeypot: bots fill the hidden field -> pretend success, store nothing
	if (website) return json({ ok: true });
	if (!EMAIL_RE.test(email) || email.length > 160) return json({ ok: false, error: 'invalid_email' }, 400);

	const rec = { id: 'w_' + Date.now().toString(36), at: new Date().toISOString(), email: email.toLowerCase(), lang, source };
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
				body: JSON.stringify({ username: 'PropertyList App', content: `New mobile-app waitlist signup (${rec.lang}, ${rec.source}).` }),
			});
		} catch {
			/* best effort */
		}
	}
	await notifySubmission({
		kind: 'app waitlist signup',
		fields: [['Email', email], ['Source', source], ['Language', lang]],
		link: '/admin/leads',
	});
	return json({ ok: true });
};
