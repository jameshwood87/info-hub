import type { APIRoute } from 'astro';
import crypto from 'node:crypto';

type SubscribeRequest = {
	email?: string;
	lang?: string;
	page?: string;
	utm?: Record<string, string>;
	/** 'agent' routes to the agent/developer CRM; anything else uses the consumer audience */
	audience?: 'agent' | 'consumer';
	/** extra Mailchimp tag, e.g. 'seller' or 'blog' */
	tag?: string;
};

function md5Lower(input: string): string {
	return crypto.createHash('md5').update(input.trim().toLowerCase()).digest('hex');
}

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

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress)))
		return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
			status: 429,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	const apiKey = (process.env.MAILCHIMP_API_KEY as string | undefined) || import.meta.env.MAILCHIMP_API_KEY || '';
	// Two audiences on purpose: the original list is a CRM mirror whose CTYPE field only
	// permits agent|developer and whose engagement fields are synced from the platform, so
	// buyers/sellers/renters must never land in it.
	const agentAudienceId =
		(process.env.MAILCHIMP_AUDIENCE_ID as string | undefined) || import.meta.env.MAILCHIMP_AUDIENCE_ID || '';
	const consumerAudienceId =
		(process.env.MAILCHIMP_CONSUMER_AUDIENCE_ID as string | undefined) ||
		import.meta.env.MAILCHIMP_CONSUMER_AUDIENCE_ID ||
		'';

	if (!apiKey || (!agentAudienceId && !consumerAudienceId)) {
		return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), {
			status: 501,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const dc = apiKey.split('-')[1] || '';
	if (!dc) {
		return new Response(JSON.stringify({ ok: false, error: 'invalid_api_key' }), {
			status: 400,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	let body: SubscribeRequest = {};
	try {
		body = (await request.json()) as SubscribeRequest;
	} catch {
		return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
			status: 400,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const email = (body.email || '').trim();
	if (!email || !email.includes('@')) {
		return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), {
			status: 400,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const lang = (body.lang || 'en').trim().toLowerCase();
	const page = (body.page || '').trim();
	const audienceId =
		body.audience === 'agent' ? agentAudienceId || consumerAudienceId : consumerAudienceId || agentAudienceId;
	if (!audienceId) {
		return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), {
			status: 501,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const tags: string[] = [];
	const extraTag = (body.tag || '').trim();
	if (extraTag) tags.push(extraTag);
	if (lang) tags.push(`lang:${lang}`);
	if (page) tags.push(`page:${page}`);
	if (body.utm) {
		for (const [k, v] of Object.entries(body.utm)) {
			if (!k || !v) continue;
			tags.push(`utm:${k}=${v}`);
		}
	}

	const subscriberHash = md5Lower(email);
	const url = `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`;

	const payload = {
		email_address: email,
		status: 'subscribed',
		tags,
	};

	const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			authorization: `Basic ${auth}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		return new Response(JSON.stringify({ ok: false, error: 'mailchimp_error' }), {
			status: 502,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
};
