import type { APIRoute } from 'astro';
import crypto from 'node:crypto';

type SubscribeRequest = {
	email?: string;
	lang?: string;
	page?: string;
	utm?: Record<string, string>;
};

function md5Lower(input: string): string {
	return crypto.createHash('md5').update(input.trim().toLowerCase()).digest('hex');
}

export const POST: APIRoute = async ({ request }) => {
	const apiKey = (process.env.MAILCHIMP_API_KEY as string | undefined) || import.meta.env.MAILCHIMP_API_KEY || '';
	const audienceId =
		(process.env.MAILCHIMP_AUDIENCE_ID as string | undefined) || import.meta.env.MAILCHIMP_AUDIENCE_ID || '';

	if (!apiKey || !audienceId) {
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

	const tags: string[] = [];
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
