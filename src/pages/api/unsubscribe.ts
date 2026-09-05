import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// One-click unsubscribe for the market email.
//
// The link in every issue carries the address and an HMAC of it, so the route
// can honour the request without a login and without letting anyone unsubscribe
// a stranger by guessing. The record is marked, never deleted: a deleted row
// would be re-added by the next signup form and the person would start getting
// mail again, which is the one outcome an unsubscribe must never produce.
//
// GET is what mail clients follow. POST is here because RFC 8058 one-click
// unsubscribe (the List-Unsubscribe-Post header the digest sends) is a POST,
// and Gmail hides its own unsubscribe button when that fails.
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

const handle = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
	const email = String(url.searchParams.get('e') || '').trim().toLowerCase();
	const token = String(url.searchParams.get('t') || '').trim();

	if (!SECRET || !email || !token) return done(lang, 'bad');
	if (!safeEqual(token, tokenFor(email))) return done(lang, 'bad');

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
