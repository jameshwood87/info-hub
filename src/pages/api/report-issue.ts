import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';

// Confidential issue/scam intake. Stores to a private queue; notifies a trust
// webhook if configured. Never publishes. Public endpoint (no admin auth) with a
// honeypot + minimal validation. GDPR/retention handling is part of legal review.
const STORE = '/opt/info-hub/var/admin/issue-reports.json';
const WEBHOOK = (process.env.REPORT_WEBHOOK || '').trim();

const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
const s = (v: FormDataEntryValue | null, n: number) => String(v || '').replace(/\s+$/g, '').slice(0, n);

export const POST: APIRoute = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const lang = String(form?.get('lang') || 'en') === 'es' ? 'es' : 'en';
	const back = lang === 'es' ? '/es/reportar-un-problema/' : '/report-a-problem/';
	if (!form) return redirect(back + '?error=1');

	// honeypot: bots fill hidden field -> pretend success, store nothing
	if (String(form.get('website') || '').trim()) return redirect(back + '?sent=1');

	const rec = {
		id: 'r_' + Date.now().toString(36),
		at: new Date().toISOString(),
		lang,
		type: s(form.get('type'), 40),
		subject: s(form.get('subject'), 200),
		detail: s(form.get('detail'), 5000),
		amount: s(form.get('amount'), 40),
		when: s(form.get('when'), 60),
		evidence: s(form.get('evidence'), 600),
		reporterName: s(form.get('reporter_name'), 120),
		reporterEmail: s(form.get('reporter_email'), 160),
		consent: Boolean(form.get('consent')),
		status: 'new',
	};
	if (rec.detail.length < 10 || !rec.consent) return redirect(back + '?error=1');

	try {
		let all: any[] = [];
		try {
			all = JSON.parse(await fs.readFile(STORE, 'utf8'));
		} catch {
			all = [];
		}
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch {
		return redirect(back + '?error=1');
	}

	// notify only that a report arrived - never the sensitive detail
	if (WEBHOOK) {
		try {
			await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username: 'PropertyList Trust', content: `New confidential report received (type: ${rec.type || 'n/a'}${rec.subject ? `, re: ${rec.subject}` : ''}). Review it in the trust queue.` }),
			});
		} catch {
			/* best effort */
		}
	}
	return redirect(back + '?sent=1');
};
