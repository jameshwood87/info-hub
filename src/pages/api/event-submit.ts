import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import fs from 'node:fs/promises';

// Public "Add your event" intake for the What's-On pages. Honeypot + strict
// validation; submissions land in a private queue with status=pending and are
// ONLY published after the events-cron AI screen approves them.
const STORE = '/opt/info-hub/var/admin/events/queue.json';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export const POST: APIRoute = async ({ request }) => {
	let b: Record<string, unknown> = {};
	try {
		const ct = request.headers.get('content-type') || '';
		if (ct.includes('application/json')) {
			b = (await request.json()) as Record<string, unknown>;
		} else {
			const f = await request.formData();
			b = Object.fromEntries(f.entries());
		}
	} catch {
		return json({ ok: false, error: 'bad_request' }, 400);
	}

	// honeypot
	if (clean(b.website, 200)) return json({ ok: true });

	const title = clean(b.title, 120);
	const start = clean(b.start, 10);
	const end = clean(b.end, 10);
	const town = clean(b.town, 60) || 'Marbella';
	const venue = clean(b.venue, 120);
	const category = clean(b.category, 20);
	const link = clean(b.link, 300);
	const organizer = clean(b.organizer, 80);
	const email = clean(b.email, 160).toLowerCase();
	const lang = clean(b.lang, 2) === 'es' ? 'es' : 'en';

	const todayIso = new Date().toISOString().slice(0, 10);
	if (title.length < 5) return json({ ok: false, error: 'invalid_title' }, 400);
	if (!DATE_RE.test(start) || start < todayIso) return json({ ok: false, error: 'invalid_date' }, 400);
	if (end && (!DATE_RE.test(end) || end < start)) return json({ ok: false, error: 'invalid_end' }, 400);
	if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);
	if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return json({ ok: false, error: 'invalid_link' }, 400);
	if (!venue && !link) return json({ ok: false, error: 'need_venue_or_link' }, 400);

	const rec = {
		id: 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		at: new Date().toISOString(),
		status: 'pending',
		title, start, end: end || null, town, venue: venue || null,
		category: category || null, link: link || null, organizer: organizer || null,
		email, lang,
	};

	try {
		let all: any[] = [];
		try { all = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch { all = []; }
		if (!Array.isArray(all)) all = [];
		// dedupe: same title+start already queued or processed
		const key = (t: string, s: string) => `${t.toLowerCase().replace(/\s+/g, ' ')}|${s}`;
		if (all.some((r) => key(String(r?.title || ''), String(r?.start || '')) === key(title, start))) {
			return json({ ok: true, duplicate: true });
		}
		// soft rate-limit: max 5 pending per email
		if (all.filter((r) => r?.email === email && r?.status === 'pending').length >= 5) {
			return json({ ok: false, error: 'too_many_pending' }, 429);
		}
		all.push(rec);
		const tmp = STORE + '.tmp';
		await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
		await fs.rename(tmp, STORE);
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}
	await notifySubmission({
		kind: 'event submission',
		fields: [['Title', rec.title], ['Town', rec.town], ['Starts', rec.start], ['Venue', rec.venue], ['Link', rec.link]],
		link: '/admin/analytics',
	});
	return json({ ok: true });
};
