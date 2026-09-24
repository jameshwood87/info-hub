import fs from 'node:fs';
// @ts-ignore - plain ES module shared with the cron scripts (scripts/blog-cron.mjs uses the same lint)
import { lintBlogPost } from '../../scripts/lib/blog-lint.mjs';
import { adminGetKbPageByPathLang, adminUpdateKbPage } from './directus';
import { writeAudit } from './adminContent';

// One publish gate for every way a blog post can go live outside the approval email
// (24-09-26): the admin Publish and bulk Publish buttons, saving in the editor with status
// published, creating a post as published, and the scheduled-publish runner. Before, all of
// them skipped the lint and published one language only; the pool post (kb 1929) went live
// that way on 20-09-26 with its Spanish twin left as a draft.
//
// The gate lints the English title and body plus the Spanish body. A blocked publish can
// still go ahead with force, which is recorded in var/admin/blog-publish-overrides.jsonl
// and the admin audit log. Publishing either language also publishes its twin when the
// twin is a draft, as the approval email already did.

export const isBlogPath = (p: string) => /^\/(es\/)?blog\/[^/]/.test(String(p || ''));
export const blogTwinPath = (p: string) => (String(p).startsWith('/es/blog/') ? String(p).replace(/^\/es/, '') : `/es${p}`);

export type BlogGate =
	| { applies: false }
	| { applies: true; ok: boolean; errors: string[]; warnings: string[]; twin: any | null };

export async function checkBlogPublish(page: { path: string; title?: string | null; body?: string | null; language?: string | null }): Promise<BlogGate> {
	if (!isBlogPath(page.path)) return { applies: false };
	const isEs = page.language === 'es' || String(page.path).startsWith('/es/');
	const twin = await adminGetKbPageByPathLang(blogTwinPath(page.path), isEs ? 'en' : 'es').catch(() => null);
	const lint = lintBlogPost({
		title: String((isEs ? twin?.title : page.title) || ''),
		body: String((isEs ? twin?.body : page.body) || ''),
		bodyEs: String((isEs ? page.body : twin?.body) || ''),
	});
	return { applies: true, ok: Boolean(lint.ok), errors: lint.errors || [], warnings: lint.warnings || [], twin };
}

export async function recordOverride(entry: { userId: string; ip: string; path: string; kbPageId: string; errors: string[]; via: string }) {
	try {
		fs.appendFileSync('/opt/info-hub/var/admin/blog-publish-overrides.jsonl', JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
	} catch {}
	await writeAudit({
		action: 'kb_pages.publish_override',
		userId: entry.userId,
		kbPageId: entry.kbPageId,
		path: entry.path,
		ip: entry.ip,
		details: { errors: entry.errors, via: entry.via },
	}).catch(() => undefined);
}

export async function publishTwin(twin: any | null, userId: string, ip = ''): Promise<string | null> {
	if (!twin || String(twin.status || '') !== 'draft') return null;
	await adminUpdateKbPage(String(twin.id), { status: 'published' } as any);
	await writeAudit({ action: 'kb_pages.publish_twin', userId, kbPageId: String(twin.id), path: twin.path, ip, details: {} }).catch(() => undefined);
	return String(twin.id);
}

export const lintBlockedResponse = (blocked: Array<{ id: string; path: string; errors: string[] }>) =>
	new Response(JSON.stringify({ ok: false, error: 'lint_blocked', blocked }), {
		status: 409,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
