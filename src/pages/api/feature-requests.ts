import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';
import { mirrorSubmission } from '../../lib/submissions';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Public feature-request board API.
// GET  -> approved ideas (id, title, detail, status, votes), most-voted first.
// POST action=suggest -> new idea into the moderation queue (status: pending).
// POST action=vote    -> +1 on an approved idea; deduped by hashed IP+UA per idea,
//                        plus an in-memory per-IP rate limit. Client also keeps
//                        localStorage state so the button disables instantly.
const STORE = '/opt/info-hub/var/admin/feature-requests.json';

type Idea = {
	id: string;
	at: string;
	lang: 'en' | 'es';
	title: string;
	detail: string;
	email?: string;
	status: 'pending' | 'under-review' | 'planned' | 'building' | 'improving' | 'live' | 'rejected';
	votes: number;
	voterHashes: string[];
};

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to } });

const readAll = async (): Promise<Idea[]> => {
	try {
		const d = JSON.parse(await fs.readFile(STORE, 'utf8'));
		return Array.isArray(d) ? d : [];
	} catch {
		return [];
	}
};
const writeAll = async (list: Idea[]) => {
	const tmp = STORE + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
	await fs.rename(tmp, STORE);
};

const PUBLIC_STATUSES = new Set(['under-review', 'planned', 'building', 'improving', 'live']);

const clientKey = (request: Request, clientAddress: string) => {
	const ua = request.headers.get('user-agent') || '';
	return crypto.createHash('sha256').update(`${clientAddress}|${ua}`).digest('hex').slice(0, 24);
};

// in-memory rate limit: max 30 vote/suggest actions per IP per hour
const rl = new Map<string, { n: number; at: number }>();
const limited = (ip: string) => {
	const now = Date.now();
	const cur = rl.get(ip);
	if (!cur || now - cur.at > 3600_000) {
		rl.set(ip, { n: 1, at: now });
		return false;
	}
	cur.n += 1;
	return cur.n > 30;
};

export const GET: APIRoute = async () => {
	const all = await readAll();
	const out = all
		.filter((i) => PUBLIC_STATUSES.has(i.status))
		.sort((a, b) => (b.votes - a.votes) || (a.at < b.at ? -1 : 1))
		.map(({ id, title, detail, status, votes, lang }) => ({ id, title, detail, status, votes, lang }));
	return json(200, { ideas: out });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const ct = request.headers.get('content-type') || '';
	const ip = String(clientAddress || 'unknown');

	// JSON body = vote
	if (ct.includes('application/json')) {
		const body: any = await request.json().catch(() => null);
		if (!body || body.action !== 'vote' || typeof body.id !== 'string') return json(400, { ok: false });
		if (limited(ip)) return json(429, { ok: false, error: 'rate' });
		const all = await readAll();
		const idea = all.find((i) => i.id === body.id);
		if (!idea || !PUBLIC_STATUSES.has(idea.status)) return json(404, { ok: false });
		const key = clientKey(request, ip);
		if (idea.voterHashes.includes(key)) return json(200, { ok: true, votes: idea.votes, already: true });
		idea.voterHashes.push(key);
		if (idea.voterHashes.length > 5000) idea.voterHashes = idea.voterHashes.slice(-5000);
		idea.votes += 1;
		await writeAll(all);
		return json(200, { ok: true, votes: idea.votes });
	}

	// form body = suggest
	const form = await request.formData().catch(() => null);
	const lang = String(form?.get('lang') || 'en') === 'es' ? 'es' : 'en';
	const back = lang === 'es' ? '/es/solicitar-funciones/' : '/request-new-features/';
	if (!form) return redirect(back + '?error=1');
	// honeypot
	if (String(form.get('website') || '').trim()) return redirect(back + '?sent=1');
	if (limited(ip)) return redirect(back + '?error=1');
	const s = (v: FormDataEntryValue | null, n: number) => String(v || '').replace(/\s+$/g, '').slice(0, n);
	const title = s(form.get('title'), 120).trim();
	const detail = s(form.get('detail'), 1500).trim();
	const email = s(form.get('email'), 160).trim();
	if (title.length < 8) return redirect(back + '?error=1');
	const rec: Idea = {
		id: 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		at: new Date().toISOString(),
		lang,
		title,
		detail,
		email: email || undefined,
		status: 'pending',
		votes: 0,
		voterHashes: [],
	};
	const all = await readAll();
	all.push(rec);
	await writeAll(all);

	// notify Discord that a suggestion arrived (title only - no email/PII in the ping)
	const hook = (process.env.DISCORD_IDEAS_WEBHOOK || '').trim();
	if (hook) {
		fetch(hook, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				username: 'PropertyList Feature Board',
				content: `💡 New feature suggestion (${lang}): **${rec.title.replace(/@/g, '@​')}**\nReview it at https://info.propertylist.es/admin/feature-requests`,
			}),
		}).catch(() => {});
	}
	await mirrorSubmission({
		kind: 'feature-request',
		email: (rec as any)?.email,
		name: (rec as any)?.name,
		phone: (rec as any)?.phone,
		lang: (rec as any)?.lang,
		source: (rec as any)?.source,
		flags: Array.isArray((rec as any)?.flags) ? (rec as any).flags.join(', ') : (rec as any)?.flags,
		payload: rec as any,
	});
	await notifySubmission({
		kind: 'feature request',
		fields: [
			['Idea', rec.title],
			['Detail', rec.detail.slice(0, 400)],
			['From', rec.email || 'not given'],
			['Language', rec.lang.toUpperCase()],
		],
		link: '/admin/feature-requests',
	});

	return redirect(back + '?sent=1');
};
