import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { adminGetKbPageById, adminUpdateKbPage } from '../../../lib/directus';

// One-click approve / reject for generated blog drafts, driven from the
// approval email that blog-cron sends. Links are HMAC-signed with a server
// secret and expire, so nobody without the email can flip a page live.
//
// GET /api/blog/approve?id=<en>&es=<es>&exp=<unix>&sig=<hex>&action=approve|reject
//
// approve  -> both pages status=published, IndexNow pinged
// reject   -> both pages status=archived (kept for inspection, never served)

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || '';

const secret = () => {
	const s = readEnv('BLOG_APPROVE_SECRET');
	if (!s) throw new Error('BLOG_APPROVE_SECRET not set');
	return s;
};

export const signApproval = (id: string, es: string, exp: number, action: string) =>
	createHmac('sha256', secret()).update(`${id}|${es}|${exp}|${action}`).digest('hex');

const html = (title: string, body: string, ok = true) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
			`<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#101828">` +
			`<h1 style="font-size:22px;color:${ok ? '#0a6d61' : '#b42318'}">${title}</h1><div style="line-height:1.6">${body}</div></body>`,
		{ status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } },
	);

export const GET: APIRoute = async ({ url }) => {
	const id = String(url.searchParams.get('id') || '');
	const es = String(url.searchParams.get('es') || '');
	const exp = Number(url.searchParams.get('exp') || 0);
	const sig = String(url.searchParams.get('sig') || '');
	const action = String(url.searchParams.get('action') || '');

	if (!id || !exp || !sig || !['approve', 'reject'].includes(action)) return html('Bad link', 'This approval link is incomplete.', false);
	if (Date.now() / 1000 > exp) return html('Link expired', 'This approval link has expired. Publish or reject the draft from <a href="/admin/blog">the admin blog page</a> instead.', false);

	let expected: string;
	try {
		expected = signApproval(id, es, exp, action);
	} catch (e: any) {
		return html('Not configured', String(e?.message || e), false);
	}
	const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return html('Invalid link', 'The signature on this link does not match.', false);

	const en = await adminGetKbPageById(id).catch(() => null);
	if (!en) return html('Not found', `No page with id ${id}.`, false);
	if (en.status === 'published' && action === 'approve') return html('Already live', `<a href="${en.path}">${en.title}</a> was already published.`);

	const status = action === 'approve' ? 'published' : 'archived';
	await adminUpdateKbPage(id, { status } as any);
	if (es) await adminUpdateKbPage(es, { status } as any).catch(() => null);

	if (action === 'approve') {
		// IndexNow, best effort
		try {
			const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
			const esPage = es ? await adminGetKbPageById(es).catch(() => null) : null;
			const urls = [`https://info.propertylist.es${en.path}`, esPage ? `https://info.propertylist.es${esPage.path}` : null].filter(Boolean);
			await fetch('https://www.bing.com/indexnow', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `https://info.propertylist.es/${key}.txt`, urlList: urls }),
			});
		} catch {}
		return html('Published', `<p><a href="${en.path}">${en.title}</a> is live in English${es ? ' and Spanish' : ''}. IndexNow has been pinged.</p><p style="color:#667085;font-size:14px">To take it down later, set the status to draft on the admin blog page.</p>`);
	}
	return html('Rejected', `<p>"${en.title}" has been archived and will not be published. Nothing was sent to search engines.</p><p style="color:#667085;font-size:14px">The draft is kept in Directus with status archived if you want to look at it.</p>`);
};
