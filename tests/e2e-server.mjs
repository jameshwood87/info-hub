import http from 'node:http';
import { spawn } from 'node:child_process';

const json = (res, status, body) => {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('content-length', Buffer.byteLength(payload));
	res.end(payload);
};

const startMockDirectus = async (port) => {
	const pages = new Map();
	let nextId = 1;
	const nowIso = () => new Date().toISOString();
	const makeId = () => String(nextId++);

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		const read = async () => {
			const chunks = [];
			for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			return Buffer.concat(chunks).toString('utf8');
		};

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
			const raw = await read();
			const payload = raw ? JSON.parse(raw) : {};
			const id = makeId();
			const item = {
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
			pages.set(id, item);
			return json(res, 200, { data: item });
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
			const raw = await read();
			const patch = raw ? JSON.parse(raw) : {};
			const updated = { ...item, ...patch, date_updated: nowIso() };
			pages.set(id, updated);
			return json(res, 200, { data: updated });
		}
		if (m && method === 'DELETE') {
			const id = decodeURIComponent(m[1] || '');
			pages.delete(id);
			return json(res, 200, { data: null });
		}

		if (pathname === '/files' && method === 'POST') {
			return json(res, 200, { data: { id: makeId() } });
		}

		if (pathname.startsWith('/assets/') && method === 'GET') {
			res.statusCode = 200;
			res.setHeader('content-type', 'image/png');
			res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
			return;
		}

		return json(res, 404, { error: 'not_found' });
	});

	await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
	return { server };
};

const DIRECTUS_PORT = 8055;
const ASTRO_PORT = 4567;

const directus = await startMockDirectus(DIRECTUS_PORT);

const child = spawn(
	'npm',
	['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(ASTRO_PORT)],
	{
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: true,
		env: {
			...process.env,
			DIRECTUS_URL: `http://127.0.0.1:${DIRECTUS_PORT}`,
			DIRECTUS_ADMIN_TOKEN: 'e2e',
		},
	}
);

let ready = false;
const waitForReady = async () =>
	new Promise((resolve, reject) => {
		const onData = (d) => {
			const s = String(d || '');
			if (!ready && s.includes(`http://127.0.0.1:${ASTRO_PORT}`)) {
				ready = true;
				resolve();
			}
		};
		const onErr = (d) => {
			const s = String(d || '');
			if (s.toLowerCase().includes('error') && !ready) {
				// ignore noisy fetch failed logs
			}
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onErr);
		child.on('exit', (code) => {
			if (!ready) reject(new Error(`dev server exited ${code}`));
		});
	});

await waitForReady();
process.stdout.write(`ready http://127.0.0.1:${ASTRO_PORT}/\n`);

const shutdown = async () => {
	try {
		child.kill('SIGTERM');
	} catch {}
	try {
		await new Promise((resolve) => directus.server.close(() => resolve()));
	} catch {}
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {}, 10_000);
