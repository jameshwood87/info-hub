import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { notifySubmission } from '../../lib/notify';
import { sendSellerBreakdown } from '../../lib/sellerBreakdown';

// Seller enquiry from the "what is my property worth" page. Stores first, then notifies,
// then subscribes - so a mail or Mailchimp outage can never lose the lead.
//
// Agent contact is a separate explicit opt-in, never implied: we make no promise that an
// agent will call, and the opt-in is what gives us consent to pass details on later.

const STORE = '/opt/info-hub/var/admin/seller-leads.json';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: Record<string, unknown>, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// best-effort in-process rate limit: 5 per IP per hour
const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 5) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};
const clientIpOf = (request: Request, clientAddress?: string) =>
	String(request.headers.get('cf-connecting-ip') || clientAddress || 'unknown');

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let b: any = {};
	try {
		b = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid_json' }, 400);
	}

	// Bot screens FLAG, they do not drop - see walkthrough-lead.ts (27-08-26):
	// Chrome autofills fax-shaped honeypots and a real lead was lost silently.
	const flags: string[] = [];
	if (clean(b.pl_hp_x9, 40) || clean(b.company_fax, 40)) flags.push('honeypot');
	if (typeof b.t === 'number' && b.t >= 0 && b.t < 2500) flags.push('fast');
	const flagNote = flags.length ? ` [CHECK: ${flags.join('+')}]` : '';

	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);

	const email = clean(b.email, 160).toLowerCase();
	if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);

	const lang = clean(b.lang, 5) === 'es' ? 'es' : 'en';
	const rec = {
		id: 'sl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		at: new Date().toISOString(),
		email,
		name: clean(b.name, 120),
		area: clean(b.area, 60),
		propertyType: clean(b.propertyType, 40),
		bedrooms: clean(b.bedrooms, 10),
		builtSqm: clean(b.builtSqm, 10),
		condition: clean(b.condition, 40),
		estimateLow: clean(b.estimateLow, 20),
		estimateHigh: clean(b.estimateHigh, 20),
		basis: clean(b.basis, 20),
		agentOptIn: b.agentOptIn === true,
		lang,
		page: clean(b.page, 200),
	};

	// 1) durable local copy first (atomic write)
	try {
		let all: any[] = [];
		try {
			all = JSON.parse(await fs.readFile(STORE, 'utf8'));
		} catch {
			all = [];
		}
		if (!Array.isArray(all)) all = [];
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}

	// 2) tell James
	await notifySubmission({
		kind: 'seller enquiry' + flagNote,
		fields: [
			['Name', rec.name],
			['Email', rec.email],
			['Area', rec.area],
			['Property', [rec.propertyType, rec.bedrooms ? rec.bedrooms + ' bed' : '', rec.builtSqm ? rec.builtSqm + ' m2' : ''].filter(Boolean).join(' / ')],
			['Condition', rec.condition],
			['Indicative range', rec.estimateLow && rec.estimateHigh ? `${rec.estimateLow} - ${rec.estimateHigh}` : ''],
			['Wants agent contact', rec.agentOptIn ? 'YES' : 'no'],
			['Language', rec.lang],
		],
		link: '/admin/leads',
	});

	// 3) send the seller the breakdown we promised on the page. Best-effort: the lead is
	// already stored and James already notified, so a mail failure must not fail the request.
	const emailed = await sendSellerBreakdown({
		email: rec.email,
		name: rec.name,
		area: rec.area,
		builtSqm: rec.builtSqm,
		estimateLow: rec.estimateLow,
		estimateHigh: rec.estimateHigh,
		basis: rec.basis,
		lang: rec.lang,
	}).catch(() => false);

	// 4) consumer audience (never the agent CRM), tagged so sellers are segmentable
	try {
		const apiKey = (process.env.MAILCHIMP_API_KEY as string | undefined) || '';
		const audienceId = (process.env.MAILCHIMP_CONSUMER_AUDIENCE_ID as string | undefined) || '';
		const dc = apiKey.split('-')[1] || '';
		if (apiKey && audienceId && dc) {
			const hash = crypto.createHash('md5').update(email).digest('hex');
			const tags = ['seller', `lang:${lang}`];
			if (rec.area) tags.push(`area:${rec.area}`);
			if (rec.agentOptIn) tags.push('wants-agent-contact');
			await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${hash}`, {
				method: 'PUT',
				headers: {
					authorization: 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64'),
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					email_address: email,
					status_if_new: 'subscribed',
					merge_fields: rec.name ? { FNAME: rec.name.split(' ')[0] } : undefined,
					tags,
				}),
			});
		}
	} catch {
		// already stored and notified; a Mailchimp problem must not fail the submission
	}

	if (!emailed) {
		try {
			const all = JSON.parse(await fs.readFile(STORE, 'utf8'));
			const i = all.findIndex((r: any) => r?.id === rec.id);
			if (i >= 0) {
				all[i].breakdownEmailed = false;
				const tmp2 = STORE + '.tmp';
				await fs.writeFile(tmp2, JSON.stringify(all, null, 2), 'utf8');
				await fs.rename(tmp2, STORE);
			}
		} catch {}
	}

	return json({ ok: true });
};
