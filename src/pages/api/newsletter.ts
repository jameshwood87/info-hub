import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Footer newsletter signup. Capture-only on purpose: no email provider is
// connected yet (see api/subscribe.ts, which 501s without Mailchimp keys), so
// this endpoint just banks the address and the digest gets sent later.
//
// Architecture mirrors src/pages/api/app-waitlist.ts exactly: public endpoint
// (no admin auth) with a honeypot + per-IP rate limit + email validation,
// storing to a private JSON queue (the app runs as infohub, so the file is
// infohub-owned). JSON POST is checkOrigin-exempt; a form-encoded fallback also
// works from a real browser (sends Origin).
const STORE = '/opt/info-hub/var/admin/newsletter.json';
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

// the page the signup came from, e.g. "/es/precios/". Anything that is not a
// site path is discarded rather than stored.
const cleanSource = (raw: string) => {
	const s = raw.trim().slice(0, 120);
	return /^\/[^\s]*$/.test(s) ? s : '/';
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);
	const ct = request.headers.get('content-type') || '';
	let email = '';
	let website = '';
	let lang = 'en';
	let source = '/';
	try {
		if (ct.includes('application/json')) {
			const b: any = await request.json();
			email = String(b?.email || '').trim();
			website = String(b?.website || '').trim();
			lang = String(b?.lang || 'en');
			source = cleanSource(String(b?.source || '/'));
		} else {
			const f = await request.formData();
			email = String(f.get('email') || '').trim();
			website = String(f.get('website') || '').trim();
			lang = String(f.get('lang') || 'en');
			source = cleanSource(String(f.get('source') || '/'));
		}
	} catch {
		return json({ ok: false, error: 'bad_request' }, 400);
	}
	lang = lang === 'es' ? 'es' : 'en';

	// honeypot: bots fill the hidden field -> pretend success, store nothing
	if (website) return json({ ok: true });
	if (!EMAIL_RE.test(email) || email.length > 160) return json({ ok: false, error: 'invalid_email' }, 400);

	// consent is recorded as true because the form states what the address is used
	// for and links the privacy policy right above the button; the POST cannot
	// happen without that submit.
	const rec = {
		id: 'n_' + Date.now().toString(36),
		at: new Date().toISOString(),
		email: email.toLowerCase(),
		lang,
		source,
		consent: true,
	};
	// duplicates are dropped silently: a returning subscriber sees the same
	// success state and learns nothing about who else is on the list.
	let isNew = false;
	try {
		let all: any[] = [];
		try {
			all = JSON.parse(await fs.readFile(STORE, 'utf8'));
		} catch {
			all = [];
		}
		if (!Array.isArray(all)) all = [];
		if (!all.some((r) => String(r?.email || '').toLowerCase() === rec.email)) {
			isNew = true;
			all.push(rec);
			const tmp = STORE + '.tmp';
			await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
			await fs.rename(tmp, STORE);
		}
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}

	if (isNew && WEBHOOK) {
		try {
			await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					username: 'PropertyList Newsletter',
					content: `New newsletter signup (${rec.lang}, ${rec.source}).`,
				}),
			});
		} catch {
			/* best effort */
		}
	}
	if (isNew) {
		await notifySubmission({
			kind: 'newsletter signup',
			fields: [
				['Email', email],
				['Page', source],
				['Language', lang],
			],
		});
	}
	return json({ ok: true });
};
