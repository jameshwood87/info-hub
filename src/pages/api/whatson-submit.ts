import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import { mirrorSubmission } from '../../lib/submissions';
import fs from 'node:fs/promises';

// "Add your place" + "Add your event feed" intake for the What's-On pages.
// Same trust model as event-submit: honeypot + validation, stored PENDING in a
// private queue, nothing goes live without review (places are hand-curated;
// feeds are only ingested by events-cron once status is flipped to "approved").
const PLACES_QUEUE = '/opt/info-hub/var/admin/events/places-queue.json';
const FEEDS_STORE = '/opt/info-hub/var/admin/events/feeds.json';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const PLACE_CATS = ['beach', 'club', 'rest', 'night', 'market', 'other'];

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

const appendTo = async (store: string, rec: Record<string, unknown>, dedupeKey: (r: any) => string) => {
	let all: any[] = [];
	try { all = JSON.parse(await fs.readFile(store, 'utf8')); } catch { all = []; }
	if (!Array.isArray(all)) all = [];
	if (all.some((r) => dedupeKey(r) === dedupeKey(rec))) return 'duplicate';
	all.push(rec);
	const tmp = store + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
	await fs.rename(tmp, store);
	return 'ok';
};

export const POST: APIRoute = async ({ request }) => {
	let b: Record<string, unknown> = {};
	try {
		const ct = request.headers.get('content-type') || '';
		if (ct.includes('application/json')) b = (await request.json()) as Record<string, unknown>;
		else b = Object.fromEntries((await request.formData()).entries());
	} catch {
		return json({ ok: false, error: 'bad_request' }, 400);
	}

	if (clean(b.website_hp, 200)) return json({ ok: true }); // honeypot

	const kind = clean(b.kind, 10);
	const email = clean(b.email, 160).toLowerCase();
	const lang = clean(b.lang, 2) === 'es' ? 'es' : 'en';
	if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);

	const base = { id: kind + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), status: 'pending', email, lang };

	try {
		if (kind === 'place') {
			const name = clean(b.name, 100);
			const cat = clean(b.cat, 12);
			const town = clean(b.town, 60) || 'Marbella';
			const area = clean(b.area, 120);
			const web = clean(b.web, 300);
			const desc = clean(b.desc, 300);
			if (name.length < 3) return json({ ok: false, error: 'invalid_name' }, 400);
			if (!PLACE_CATS.includes(cat)) return json({ ok: false, error: 'invalid_cat' }, 400);
			if (desc.length < 10) return json({ ok: false, error: 'invalid_desc' }, 400);
			if (web && !URL_RE.test(web)) return json({ ok: false, error: 'invalid_url' }, 400);
			const res = await appendTo(PLACES_QUEUE, { ...base, name, cat, town, area: area || null, web: web || null, desc },
				(r) => `${String(r?.name || '').toLowerCase()}|${r?.town || ''}`);
			await mirrorSubmission({
				kind: 'place-suggestion',
				name: name,
				source: 'whats-on',
				payload: { ...base, name, cat, town, area, web, desc } as any,
			});
			await notifySubmission({
				kind: 'place suggestion',
				fields: [['Name', name], ['Category', cat], ['Town', town], ['Website', web], ['Description', desc]],
			});
			return json({ ok: true, duplicate: res === 'duplicate' });
		}
		if (kind === 'feed') {
			const organizer = clean(b.organizer, 100);
			const url = clean(b.url, 400);
			const town = clean(b.town, 60) || 'Marbella';
			if (organizer.length < 3) return json({ ok: false, error: 'invalid_name' }, 400);
			if (!URL_RE.test(url)) return json({ ok: false, error: 'invalid_url' }, 400);
			const res = await appendTo(FEEDS_STORE, { ...base, organizer, url, town },
				(r) => String(r?.url || '').toLowerCase().replace(/\/+$/, ''));
			await mirrorSubmission({
				kind: 'event-feed-suggestion',
				name: organizer,
				source: 'whats-on',
				payload: { ...base, organizer, url, town } as any,
			});
			await notifySubmission({
				kind: 'event feed suggestion',
				fields: [['Organizer', organizer], ['Feed URL', url], ['Town', town]],
			});
			return json({ ok: true, duplicate: res === 'duplicate' });
		}
		return json({ ok: false, error: 'invalid_kind' }, 400);
	} catch {
		return json({ ok: false, error: 'store_failed' }, 500);
	}
};
