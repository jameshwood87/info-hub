// Email notification for public form submissions, via Mandrill (Mailchimp Transactional).
//
// SEND-ONLY by design: this module never reads or changes Mandrill configuration
// (domains, templates, webhooks, subaccounts). The same Mandrill account powers
// propertylist.es transactional mail, so we only ever call messages/send.
//
// Failures are swallowed on purpose. Every caller writes its submission to storage
// BEFORE calling this, so a mail outage can delay a notification but never lose a lead.

const KEY = (process.env.MANDRILL_API_KEY || '').trim();
const FROM = (process.env.NOTIFY_FROM || '').trim();
const FROM_NAME = (process.env.NOTIFY_FROM_NAME || 'PropertyList Info Hub').trim();
const TO = (process.env.NOTIFY_TO || '').trim();
const SITE = 'https://info.propertylist.es';

const esc = (v: unknown) =>
	String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

export type NotifyOptions = {
	/** short human label, e.g. "scam report" or "buyer lead" */
	kind: string;
	/** rows shown in the email, in order. Empty values are dropped. */
	fields: Array<[string, unknown]>;
	/** optional admin path to review it, e.g. "/admin/reports" */
	link?: string;
};

export const notifySubmission = async (opts: NotifyOptions): Promise<void> => {
	if (!KEY || !TO || !FROM) return; // not configured: stay silent, never throw

	try {
		const rows = opts.fields
			.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
			.map(
				([k, v]) =>
					`<tr><td style="padding:6px 16px 6px 0;color:#667085;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
					`<td style="padding:6px 0;color:#101828"><strong>${esc(v)}</strong></td></tr>`,
			)
			.join('');

		// No admin queue for this kind of submission means no button. It used to fall back
		// to SITE, so "Review it" quietly dropped the reader on the public homepage.
		const reviewUrl = opts.link ? `${SITE}${opts.link}` : '';
		const button = reviewUrl
			? `<p style="margin:0"><a href="${esc(reviewUrl)}" style="background:#00ae9a;color:#fff;padding:10px 18px;` +
				`border-radius:8px;text-decoration:none;font-size:14px">Review it</a></p>`
			: '';
		const html =
			`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">` +
			`<p style="font-size:16px;margin:0 0 14px"><strong>New ${esc(opts.kind)}</strong> on info.propertylist.es</p>` +
			`<table style="border-collapse:collapse;font-size:14px;margin-bottom:18px">${rows}</table>` +
			button +
			`</div>`;

		const text =
			`New ${opts.kind} on info.propertylist.es\n\n` +
			opts.fields
				.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
				.map(([k, v]) => `${k}: ${v}`)
				.join('\n') +
			(reviewUrl ? `\n\nReview: ${reviewUrl}\n` : '\n');

		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 8000);
		try {
			await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				signal: ctl.signal,
				body: JSON.stringify({
					key: KEY,
					message: {
						from_email: FROM,
						from_name: FROM_NAME,
						to: TO.split(',')
							.map((a) => a.trim())
							.filter(Boolean)
							.map((email) => ({ email, type: 'to' })),
						subject: `[PropertyList] New ${opts.kind}`,
						html,
						text,
						// keep info-hub notifications separable from propertylist.es mail
						tags: ['info-hub', 'form-notification'],
						track_opens: false,
						track_clicks: false,
					},
				}),
			});
		} finally {
			clearTimeout(timer);
		}
	} catch {
		// swallow: the submission is already stored
	}
};
