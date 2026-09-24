import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { adminGetKbPageById, adminUpdateKbPage } from '../../../lib/directus';

// One-click approve / reject for the search-title proposals that scripts/ctr-experiments.mjs
// emails to James every Monday (24-09-26: titles used to be applied to live pages with no
// approval). Links are HMAC-signed with BLOG_APPROVE_SECRET and expire after 7 days.
//
// GET /api/seo/ctr-approve?pid=<proposal id>&exp=<unix>&action=approve|reject&sig=<hex>
//
// approve -> the proposed fields are written to the page, the ledger entry becomes an active
//            14-day experiment, IndexNow is pinged. Refused if the page changed since.
// reject  -> the ledger entry is marked rejected; the page is not proposed again for 60 days.

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || '';
// CTR_LEDGER_PATH lets a staging server test the links against a scratch ledger
const LEDGER = readEnv('CTR_LEDGER_PATH') || '/opt/info-hub/var/admin/ctr-experiments.json';
const ORIGIN = 'https://info.propertylist.es';

const html = (title: string, body: string, ok = true) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
			`<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#101828">` +
			`<h1 style="font-size:22px;color:${ok ? '#0a6d61' : '#b42318'}">${title}</h1><div style="line-height:1.6">${body}</div></body>`,
		{ status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } },
	);

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async ({ url }) => {
	const pid = String(url.searchParams.get('pid') || '');
	const exp = Number(url.searchParams.get('exp') || 0);
	const sig = String(url.searchParams.get('sig') || '');
	const action = String(url.searchParams.get('action') || '');

	if (!/^[a-f0-9]{6,32}$/.test(pid) || !exp || !/^[a-f0-9]{64}$/.test(sig) || !['approve', 'reject'].includes(action)) return html('Bad link', 'This link is incomplete.', false);
	if (Date.now() / 1000 > exp) return html('Link expired', 'This link has expired. The proposal stays unapplied; a new one can be made after 60 days.', false);

	const secret = readEnv('BLOG_APPROVE_SECRET');
	if (!secret) return html('Not configured', 'BLOG_APPROVE_SECRET is not set.', false);
	const expected = createHmac('sha256', secret).update(`ctr|${pid}|${exp}|${action}`).digest('hex');
	const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return html('Invalid link', 'The signature on this link does not match.', false);

	let ledger: any[] = [];
	try {
		ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
	} catch {
		return html('Ledger missing', 'The experiments ledger could not be read.', false);
	}
	const entry = ledger.find((e) => e && e.pid === pid);
	if (!entry) return html('Not found', 'No proposal with this id.', false);
	if (entry.status !== 'proposed') return html('Already handled', `This proposal is already <b>${esc(entry.status)}</b>.`);

	const save = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

	if (action === 'reject') {
		entry.status = 'rejected';
		entry.rejected_at = new Date().toISOString();
		save();
		return html('Rejected', `<p>Nothing changed on <a href="${esc(entry.path)}">${esc(entry.path)}</a>. It will not be proposed again for 60 days.</p>`);
	}

	const page = await adminGetKbPageById(String(entry.id)).catch(() => null);
	if (!page) return html('Page not found', `No page with id ${esc(entry.id)}.`, false);
	const before = entry.before || {};
	const same = (x: unknown, y: unknown) => String(x ?? '') === String(y ?? '');
	if (!same(page.title, before.title) || !same((page as any).seo_title, before.seo_title) || !same((page as any).seo_description, before.seo_description)) {
		entry.status = 'stale';
		entry.stale_at = new Date().toISOString();
		save();
		return html('Page changed since the proposal', `<p>The title or description of <a href="${esc(entry.path)}">${esc(entry.path)}</a> was edited after this proposal was made, so nothing was applied.</p>`, false);
	}

	const p = entry.proposed || {};
	await adminUpdateKbPage(String(entry.id), (entry.isDocs ? { seo_title: p.seo_title, seo_description: p.seo_description } : { title: p.title, seo_title: p.seo_title, seo_description: p.seo_description }) as any);
	entry.status = 'active';
	entry.applied = new Date().toISOString();
	entry.newTitle = p.title || p.seo_title;
	save();

	try {
		const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
		await fetch('https://www.bing.com/indexnow', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: [ORIGIN + entry.path] }),
		});
	} catch {}

	return html('Applied', `<p>The new title is live on <a href="${esc(entry.path)}">${esc(entry.path)}</a>. The before and after click rates are reported in 14 days.</p>`);
};
