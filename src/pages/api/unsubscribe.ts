import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// One-click unsubscribe for the market email and the agent summary email.
//
// The link in every email carries the address and an HMAC of it, so the route
// can honour the request without a login and without letting anyone unsubscribe
// a stranger by guessing. The record is marked, never deleted: a deleted row
// would be re-added by the next signup form and the person would start getting
// mail again, which is the one outcome an unsubscribe must never produce.
//
// GET is what mail clients follow. POST is here because RFC 8058 one-click
// unsubscribe (the List-Unsubscribe-Post header both emails send) is a POST,
// and Gmail hides its own unsubscribe button when that fails.
//
// list=agent comes from the agent summary email (src/lib/agentSummary.mjs). That
// request also added the address to the Mailchimp agent audience, so the same
// verified link marks the member unsubscribed there too.
const STORE = '/opt/info-hub/var/admin/newsletter.json';
const SECRET = (process.env.NEWSLETTER_SECRET || '').trim();

const tokenFor = (email: string) =>
	crypto.createHmac('sha256', SECRET).update(email.toLowerCase()).digest('hex').slice(0, 32);

const safeEqual = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const done = (lang: string, state: 'ok' | 'bad') =>
	new Response(null, {
		status: 302,
		headers: { location: `${lang === 'es' ? '/es/baja/' : '/unsubscribe/'}?${state}=1`, 'cache-control': 'no-store' },
	});

// Mark the address unsubscribed in the Mailchimp agent audience. Best effort:
// a member that does not exist answers 404, which is fine, and a Mailchimp
// outage is logged rather than turned into a failed unsubscribe page.
const unsubscribeMailchimpAgent = async (email: string) => {
	const apiKey = String(process.env.MAILCHIMP_API_KEY || '').trim();
	const audienceId = String(process.env.MAILCHIMP_AUDIENCE_ID || '').trim();
	const dc = apiKey.split('-')[1] || '';
	if (!apiKey || !audienceId || !dc) return;
	const hash = crypto.createHash('md5').update(email).digest('hex');
	try {
		const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${hash}`, {
			method: 'PATCH',
			headers: {
				authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ status: 'unsubscribed' }),
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok && res.status !== 404) console.error('[unsubscribe] mailchimp http %s', res.status);
	} catch (err) {
		console.error('[unsubscribe] mailchimp failed', err && (err as Error).name);
	}
};

const handle = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
	const email = String(url.searchParams.get('e') || '').trim().toLowerCase();
	const token = String(url.searchParams.get('t') || '').trim();
	const list = url.searchParams.get('list');

	if (!SECRET || !email || !token) return done(lang, 'bad');
	if (!safeEqual(token, tokenFor(email))) return done(lang, 'bad');

	if (list === 'agent') await unsubscribeMailchimpAgent(email);

	try {
		let all: any[] = [];
		try {
			all = JSON.parse(await fs.readFile(STORE, 'utf8'));
		} catch {
			all = [];
		}
		if (!Array.isArray(all)) all = [];
		let changed = false;
		for (const r of all) {
			if (String(r?.email || '').toLowerCase() === email && !r.unsubscribedAt) {
				r.unsubscribedAt = new Date().toISOString();
				changed = true;
			}
		}
		if (changed) {
			const tmp = STORE + '.tmp';
			await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
			await fs.rename(tmp, STORE);
		}
		// An address that is not on the list still gets the confirmation page:
		// it is already true that they will not receive the email, and saying
		// "you were not subscribed" would confirm membership to whoever asked.
		return done(lang, 'ok');
	} catch {
		return done(lang, 'bad');
	}
};

export const GET: APIRoute = ({ request }) => handle(request);
export const POST: APIRoute = ({ request }) => handle(request);
