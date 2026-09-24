import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { adminGetKbPageById, adminUpdateKbPage } from '../../../lib/directus';
import { writeAudit } from '../../../lib/adminContent';

// The Undo link for the automatic search-title tests of scripts/ctr-experiments.mjs, sent in the
// weekly email. HMAC-signed with BLOG_APPROVE_SECRET, valid 30 days.
//
// GET /api/seo/ctr-approve?pid=<test id>&exp=<unix>&action=undo&sig=<hex>
//
// Puts the wording from before the test back and pings IndexNow. Refused when the test is not
// live, when the old wording was not saved or failed the checks (undo_ok, set by the script, so
// an Undo can never restore a wrong title), or when the page was edited since the test started.
// 24-09-26: James asked for title changes without his approval, so the approve and reject links
// of the version before are gone (none was ever sent).

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
const same = (x: unknown, y: unknown) => String(x ?? '') === String(y ?? '');
// INFO_HUB_VAR_DIR is the app's own var-dir override; a test server pointed at a scratch dir has no key, so it pings nobody
const pingIndexNow = async (path: string) => {
	try {
		const key = fs.readFileSync(`${(process.env.INFO_HUB_VAR_DIR as string | undefined) || '/opt/info-hub/var'}/admin/indexnow-key.txt`, 'utf8').trim();
		await fetch('https://www.bing.com/indexnow', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: [ORIGIN + path] }),
		});
	} catch {}
};

export const GET: APIRoute = async ({ url }) => {
	const pid = String(url.searchParams.get('pid') || '');
	const exp = Number(url.searchParams.get('exp') || 0);
	const sig = String(url.searchParams.get('sig') || '');
	const action = String(url.searchParams.get('action') || '');

	if (!/^[a-f0-9]{6,32}$/.test(pid) || !exp || !/^[a-f0-9]{64}$/.test(sig) || action !== 'undo') return html('Bad link', 'This link is incomplete.', false);
	if (Date.now() / 1000 > exp) return html('Link expired', 'This link has expired, so nothing changed.', false);

	const secret = readEnv('BLOG_APPROVE_SECRET');
	if (!secret) return html('Not configured', 'BLOG_APPROVE_SECRET is not set.', false);
	const expected = createHmac('sha256', secret).update(`ctr|${pid}|${exp}|${action}`).digest('hex');
	const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return html('Invalid link', 'The signature on this link does not match.', false);

	let ledger: any[] = [];
	try {
		ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
	} catch {
		return html('Ledger missing', 'The title-test ledger could not be read.', false);
	}
	const entry = ledger.find((e) => e && e.pid === pid);
	if (!entry) return html('Not found', 'No title test with this id.', false);
	if (!['active', 'kept', 'worse_not_undone'].includes(String(entry.status))) return html('Already handled', `This test is already <b>${esc(entry.status)}</b>, so nothing changed.`);

	const fields = entry.applied_fields || {};
	const before = entry.before || {};
	const keys = Object.keys(fields);
	if (!keys.length || !keys.every((k) => k in before)) return html('Cannot undo', 'The wording from before this test was not saved, so nothing changed.', false);
	if (entry.undo_ok !== true) return html('Cannot undo', 'The wording from before this test did not pass the checks, so it is not put back. If the current title reads wrong, the page needs a rewrite.', false);
	const page = await adminGetKbPageById(String(entry.id)).catch(() => null);
	if (!page) return html('Page not found', `No page with id ${esc(entry.id)}.`, false);
	if (!keys.every((k) => same((page as any)[k], fields[k]))) return html('Page changed since the test', `<p>The title or description of <a href="${esc(entry.path)}">${esc(entry.path)}</a> was edited after the test started, so nothing was undone.</p>`, false);

	const restore: Record<string, string> = {};
	for (const k of keys) restore[k] = String(before[k] ?? '');
	await adminUpdateKbPage(String(entry.id), restore as any);
	entry.status = 'undone_by_james';
	entry.undone_at = new Date().toISOString();
	fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
	await writeAudit({ action: 'seo.title_test_undone', userId: 'james (undo link)', kbPageId: String(entry.id), path: entry.path, details: { pid, restored: restore } }).catch(() => undefined);
	await pingIndexNow(entry.path);
	return html('Undone', `<p>The old wording is back on <a href="${esc(entry.path)}">${esc(entry.path)}</a>. The page will not be tested again for 90 days.</p>`);
};
