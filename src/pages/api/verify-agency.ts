import type { APIRoute } from 'astro';
import { notifySubmission } from '../../lib/notify';

type VerifyRequest = {
	agency_name?: string;
	company_number?: string;
	mls_email?: string;
	contact_name?: string;
	phone?: string;
	website?: string;
	google_business?: string;
	social_link?: string;
	notes?: string;
	lang?: string;
	page?: string;
	company_fax?: string; // honeypot - must stay empty
	t?: number; // ms since form render - bots submit instantly
};

const directusUrl = () =>
	((process.env.DIRECTUS_URL as string | undefined) || import.meta.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const adminToken = () =>
	((process.env.DIRECTUS_ADMIN_TOKEN as string | undefined) || import.meta.env.DIRECTUS_ADMIN_TOKEN || '').trim();

// best-effort in-process rate limit: 3 submissions per IP per hour
const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 3) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};

const json = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const token = adminToken();
	if (!token) return json(501, { ok: false, error: 'not_configured' });

	let body: VerifyRequest = {};
	try {
		body = (await request.json()) as VerifyRequest;
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	// bot checks: honeypot filled or submitted inhumanly fast
	if ((body.company_fax || '').trim() !== '') return json(200, { ok: true });
	if (typeof body.t === 'number' && body.t >= 0 && body.t < 2500) return json(200, { ok: true });

	const ip = String(clientAddress || request.headers.get('cf-connecting-ip') || 'unknown');
	if (!allow(ip)) return json(429, { ok: false, error: 'rate_limited' });

	const clean = (v: unknown, max = 300) => String(v || '').trim().slice(0, max);
	const agencyName = clean(body.agency_name);
	const companyNumber = clean(body.company_number, 60);
	const mlsEmail = clean(body.mls_email, 200);
	const website = clean(body.website);

	if (agencyName.length < 2) return json(400, { ok: false, error: 'agency_name' });
	if (companyNumber.length < 3) return json(400, { ok: false, error: 'company_number' });
	if (!mlsEmail.includes('@') || mlsEmail.length < 6) return json(400, { ok: false, error: 'mls_email' });
	if (website.length < 4) return json(400, { ok: false, error: 'website' });

	const payload = {
		status: 'pending',
		agency_name: agencyName,
		company_number: companyNumber,
		mls_email: mlsEmail,
		contact_name: clean(body.contact_name),
		phone: clean(body.phone, 60),
		website: website.startsWith('http') ? website : `https://${website}`,
		google_business: clean(body.google_business),
		social_link: clean(body.social_link),
		notes: clean(body.notes, 2000),
		lang: clean(body.lang, 5) || 'en',
		page_url: clean(body.page, 300),
	};

	try {
		const res = await fetch(`${directusUrl()}/items/agency_verification_requests`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!res.ok) return json(502, { ok: false, error: 'store_failed' });
	} catch {
		return json(502, { ok: false, error: 'store_failed' });
	}

	await notifySubmission({
		kind: 'agency verification request',
		fields: [['Agency', payload.agency_name], ['MLS email', payload.mls_email], ['Website', payload.website], ['Contact', payload.contact_name], ['Phone', payload.phone]],
	});
	return json(200, { ok: true });
};
