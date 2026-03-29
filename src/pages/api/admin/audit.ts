import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertAdmin } from '../../../lib/adminAuth';

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const AUDIT_LOG_PATH = path.join(VAR_DIR, 'admin', 'audit.jsonl');

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ request }) => {
	assertAdmin(request);
	const url = new URL(request.url);
	const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));

	let raw = '';
	try {
		raw = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
	} catch {
		return json(200, { ok: true, items: [] });
	}

	const lines = raw
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	const tail = lines.slice(-limit);
	const items = tail
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.reverse();

	return json(200, { ok: true, items });
};

