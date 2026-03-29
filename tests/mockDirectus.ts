import http from 'node:http';
import { URL } from 'node:url';

type KbPage = {
	id: string;
	status: 'draft' | 'published' | string;
	language: 'en' | 'es' | string;
	path: string;
	title: string;
	description?: string | null;
	body?: string | null;
	seo_title?: string | null;
	seo_description?: string | null;
	date_created?: string | null;
	date_updated?: string | null;
};

const json = (res: http.ServerResponse, status: number, body: any) => {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('content-length', Buffer.byteLength(payload));
	res.end(payload);
};

const readBody = async (req: http.IncomingMessage) => {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks);
};

const parseJson = async (req: http.IncomingMessage) => {
	const raw = (await readBody(req)).toString('utf8');
	return raw ? JSON.parse(raw) : null;
};

export const createMockDirectusServer = async (opts?: { port?: number }) => {
	const pages = new Map<string, KbPage>();
	let nextId = 1;
	const files = new Set<string>();

	const nowIso = () => new Date().toISOString();
	const makeId = () => String(nextId++);

	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
			const pathname = url.pathname;
			const method = req.method || 'GET';

			if (pathname === '/files' && method === 'POST') {
				const id = makeId();
				files.add(id);
				return json(res, 200, { data: { id } });
			}

			if (pathname.startsWith('/assets/') && method === 'GET') {
				const id = pathname.split('/').filter(Boolean)[1] || '';
				if (!files.has(id)) return json(res, 404, { error: 'not_found' });
				res.statusCode = 200;
				res.setHeader('content-type', 'image/png');
				res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
				return;
			}

			if (pathname === '/items/kb_pages' && method === 'GET') {
				const startsWith = url.searchParams.get('filter[path][_starts_with]') || '';
				const eqLang = url.searchParams.get('filter[language][_eq]');
				const eqStatus = url.searchParams.get('filter[status][_eq]');
				const eqPath = url.searchParams.get('filter[path][_eq]');
				const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
				const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
				let items = Array.from(pages.values());
				if (eqPath) items = items.filter((p) => p.path === eqPath);
				if (startsWith) items = items.filter((p) => p.path.startsWith(startsWith));
				if (eqLang) items = items.filter((p) => p.language === eqLang);
				if (eqStatus) items = items.filter((p) => p.status === eqStatus);
				items.sort((a, b) => String(b.date_updated || '').localeCompare(String(a.date_updated || '')) || b.id.localeCompare(a.id));
				return json(res, 200, { data: items.slice(offset, offset + limit) });
			}

			if (pathname === '/items/kb_pages' && method === 'POST') {
				const payload = (await parseJson(req)) || {};
				const id = makeId();
				const created: KbPage = {
					id,
					status: payload.status || 'draft',
					language: payload.language || 'en',
					path: payload.path,
					title: payload.title,
					description: payload.description ?? null,
					body: payload.body ?? null,
					seo_title: payload.seo_title ?? null,
					seo_description: payload.seo_description ?? null,
					date_created: nowIso(),
					date_updated: nowIso(),
				};
				pages.set(id, created);
				return json(res, 200, { data: created });
			}

			const m = pathname.match(/^\/items\/kb_pages\/([^/]+)$/);
			if (m && method === 'GET') {
				const id = decodeURIComponent(m[1] || '');
				const item = pages.get(id);
				if (!item) return json(res, 404, { error: 'not_found' });
				return json(res, 200, { data: item });
			}
			if (m && method === 'PATCH') {
				const id = decodeURIComponent(m[1] || '');
				const item = pages.get(id);
				if (!item) return json(res, 404, { error: 'not_found' });
				const patch = (await parseJson(req)) || {};
				const updated = { ...item, ...patch, date_updated: nowIso() };
				pages.set(id, updated);
				return json(res, 200, { data: updated });
			}
			if (m && method === 'DELETE') {
				const id = decodeURIComponent(m[1] || '');
				pages.delete(id);
				return json(res, 200, { data: null });
			}

			return json(res, 404, { error: 'not_found' });
		} catch (e: any) {
			return json(res, 500, { error: 'server_error', message: String(e?.message || e) });
		}
	});

	const port = opts?.port ?? 0;
	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	const baseUrl = `http://127.0.0.1:${actualPort}`;

	const stop = async () => new Promise<void>((resolve) => server.close(() => resolve()));

	return {
		baseUrl,
		stop,
		seed: (page: Omit<KbPage, 'id' | 'date_created' | 'date_updated'>) => {
			const id = makeId();
			pages.set(id, { ...page, id, date_created: nowIso(), date_updated: nowIso() });
			return id;
		},
	};
};

