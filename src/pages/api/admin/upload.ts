import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf } from '../../../lib/adminAuth';
import fs from 'node:fs';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const directusUrl = () => (readEnv('DIRECTUS_URL') || 'http://127.0.0.1:8055').replace(/\/+$/g, '');
const readTokenFile = (p: string | undefined) => {
	if (!p) return '';
	try {
		return String(fs.readFileSync(p, 'utf8') || '').trim();
	} catch {
		return '';
	}
};
const directusAdminToken = () =>
	readEnv('DIRECTUS_ADMIN_TOKEN') || readEnv('DIRECTUS_TOKEN') || readTokenFile(readEnv('DIRECTUS_ADMIN_TOKEN_FILE')) || '';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const mapError = (e: any) => {
	const status = typeof e?.status === 'number' ? e.status : 500;
	const raw = String(e?.message || 'server_error');
	if (raw === 'unauthorized') return { status: 401, error: 'unauthorized' };
	if (raw === 'csrf_missing') return { status: 403, error: 'csrf_missing' };
	if (raw === 'csrf_mismatch') return { status: 403, error: 'csrf_mismatch' };
	if (raw === 'csrf_invalid') return { status: 403, error: 'csrf_invalid' };
	return { status, error: status === 500 ? 'server_error' : raw };
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = assertAdmin(request);
		assertCsrf(request, session);

		const token = directusAdminToken();
		if (!token) return json(501, { ok: false, error: 'directus_admin_token_not_configured' });

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return json(400, { ok: false, error: 'invalid_formdata' });
		}

		const file = form.get('file');
		if (!(file instanceof File)) return json(400, { ok: false, error: 'missing_file' });
		const name = String(file.name || 'upload');
		const type = String(file.type || '');
		const lowerName = name.toLowerCase();
		const ext = (lowerName.match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase();
		const allowedMimePrefixes = ['image/', 'video/'];
		const allowedMimes = new Set([
			'application/pdf',
			'text/plain',
			'application/zip',
			'application/x-zip-compressed',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		]);
		const allowedExts = new Set([
			'png',
			'jpg',
			'jpeg',
			'webp',
			'gif',
			'svg',
			'mp4',
			'webm',
			'mov',
			'm4v',
			'ogv',
			'pdf',
			'txt',
			'zip',
			'doc',
			'docx',
			'xls',
			'xlsx',
			'ppt',
			'pptx',
		]);
		const mimeOk = allowedMimePrefixes.some((p) => type.startsWith(p)) || allowedMimes.has(type);
		const extOk = allowedExts.has(ext);
		if (!mimeOk && !extOk) return json(400, { ok: false, error: 'invalid_file_type' });
		if (file.size > 25 * 1024 * 1024) return json(400, { ok: false, error: 'file_too_large' });

		const forward = new FormData();
		forward.set('file', file, name || 'upload');

		const res = await fetch(`${directusUrl()}/files`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
			body: forward,
		}).catch(() => null);

		if (!res) return json(502, { ok: false, error: 'upload_failed' });
		const data = await res.json().catch(() => null);
		if (!res.ok || !data?.data?.id) return json(502, { ok: false, error: 'directus_upload_error' });

		const id = String(data.data.id);
		const url = `/assets/${encodeURIComponent(id)}`;
		return json(200, { ok: true, id, url });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};
