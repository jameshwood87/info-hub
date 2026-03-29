import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createMockDirectusServer } from './mockDirectus';
import { adminAuthCookies, createAdminSession } from '../src/lib/adminAuth';
import { assertAllowedPath, normalisePath, sanitiseKbWrite } from '../src/lib/adminContent';
import { recordWeeklyView } from '../src/lib/weeklyViews';
import { mapDocsEnglishToSpanishPath, mapDocsSpanishToEnglishPath, normaliseKbText } from '../src/lib/directus';

let directus: Awaited<ReturnType<typeof createMockDirectusServer>> | null = null;

beforeAll(async () => {
	directus = await createMockDirectusServer();
	process.env.DIRECTUS_URL = directus.baseUrl;
	process.env.DIRECTUS_ADMIN_TOKEN = 'testtoken';
});

afterAll(async () => {
	await directus?.stop();
});

const makeSessionHeaders = () => {
	const session = createAdminSession();
	const cookies = adminAuthCookies(session);
	const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;
	return { session, cookieHeader };
};

describe('admin helpers', () => {
	it('normalises and validates paths by scope', () => {
		expect(normalisePath('docs/getting-started')).toBe('/docs/getting-started/');
		expect(assertAllowedPath('docs', '/docs/getting-started/')).toBe('/docs/getting-started/');
		expect(() => assertAllowedPath('blog', '/docs/getting-started/')).toThrow();
	});

	it('sanitises dangerous html', () => {
		const out = sanitiseKbWrite({
			status: 'draft',
			language: 'en',
			path: '/blog/x/',
			title: 't',
			description: null,
			body: '<p onclick="alert(1)">x</p><script>alert(2)</script>',
			seo_title: null,
			seo_description: null,
		});
		expect(String(out.body)).not.toContain('onclick');
		expect(String(out.body)).not.toContain('<script');
	});

	it('maps docs paths between languages', () => {
		expect(mapDocsEnglishToSpanishPath('/docs/laws-procedures/')).toBe('/es/docs/leyes-procedimientos/');
		expect(mapDocsSpanishToEnglishPath('/es/docs/leyes-procedimientos/')).toBe('/docs/laws-procedures/');
	});

	it('normalises KB text', () => {
		expect(normaliseKbText('Optimize', 'en')).toBe('Optimize');
	});
});

describe('admin misc routes', () => {
	it('/api/admin/me reports authentication', async () => {
		const { GET } = await import('../src/pages/api/admin/me');
		const { cookieHeader } = makeSessionHeaders();
		const req = new Request('http://test/api/admin/me', { headers: { cookie: cookieHeader } });
		const res = await GET({ request: req } as any);
		const data = await res.json();
		expect(data.authenticated).toBe(true);
		expect(data.csrfToken).toBeTruthy();
	});

	it('/api/admin/me reports unauthenticated when missing session', async () => {
		const { GET } = await import('../src/pages/api/admin/me');
		const req = new Request('http://test/api/admin/me');
		const res = await GET({ request: req } as any);
		const data = await res.json();
		expect(data.authenticated).toBe(false);
	});

	it('/api/admin/logout clears cookies', async () => {
		const { POST } = await import('../src/pages/api/admin/logout');
		const { cookieHeader } = makeSessionHeaders();
		const req = new Request('http://test/api/admin/logout', { method: 'POST', headers: { cookie: cookieHeader } });
		const res = await POST({ request: req } as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie') || '').toContain('pl_admin_session=');
	});

	it('/api/admin/upload proxies image uploads to Directus', async () => {
		const { POST } = await import('../src/pages/api/admin/upload');
		const { session, cookieHeader } = makeSessionHeaders();

		const fd = new FormData();
		fd.set('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));

		const req = new Request('http://test/api/admin/upload', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken },
			body: fd,
		});

		const res = await POST({ request: req } as any);
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.ok).toBe(true);
		expect(String(data.url)).toContain('/assets/');
	});

	it('/api/admin/analytics/views returns recent view counts', async () => {
		const { POST } = await import('../src/pages/api/admin/analytics/views');
		const { cookieHeader } = makeSessionHeaders();
		await recordWeeklyView('/docs/getting-started/');
		const filler = Array.from({ length: 650 }, (_, i) => `/docs/filler-${i}/`);
		const req = new Request('http://test/api/admin/analytics/views', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'content-type': 'application/json' },
			body: JSON.stringify({ paths: [...filler, '/docs/getting-started', '/docs/getting-started/'] }),
		});
		const res = await POST({ request: req } as any);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(Number(data.counts['/docs/getting-started/'])).toBeGreaterThan(0);
		expect(Number(data.counts['/docs/getting-started'])).toBeGreaterThan(0);
	});

	it('/api/admin/audit returns recent actions', async () => {
		const { GET: getAudit } = await import('../src/pages/api/admin/audit');
		const { GET: listPages } = await import('../src/pages/api/admin/kb-pages/index');
		const { session, cookieHeader } = makeSessionHeaders();

		const listReq = new Request('http://test/api/admin/kb-pages?prefixes=/blog/', { headers: { cookie: cookieHeader } });
		await listPages({ request: listReq, clientAddress: '127.0.0.1' } as any);

		const auditReq = new Request('http://test/api/admin/audit?limit=10', { headers: { cookie: cookieHeader } });
		const auditRes = await getAudit({ request: auditReq } as any);
		const data = await auditRes.json();
		expect(data.ok).toBe(true);
		expect(Array.isArray(data.items)).toBe(true);
	});

	it('/api/admin/kb-pages/bulk publishes multiple items', async () => {
		const { POST: create } = await import('../src/pages/api/admin/kb-pages/index');
		const { POST: bulk } = await import('../src/pages/api/admin/kb-pages/bulk');
		const { session, cookieHeader } = makeSessionHeaders();

		const mk = async (path: string) => {
			const req = new Request('http://test/api/admin/kb-pages', {
				method: 'POST',
				headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
				body: JSON.stringify({
					scope: 'blog',
					page: {
						status: 'draft',
						language: 'en',
						path,
						title: path,
						description: null,
						body: '<p>x</p>',
						seo_title: null,
						seo_description: null,
					},
				}),
			});
			return (await (await create({ request: req, clientAddress: '127.0.0.1' } as any)).json()).item.id as string;
		};

		const a = await mk('/blog/bulk/a/');
		const b = await mk('/blog/bulk/b/');

		const bulkReq = new Request('http://test/api/admin/kb-pages/bulk', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'publish', ids: [a, b] }),
		});

		const bulkRes = await bulk({ request: bulkReq, clientAddress: '127.0.0.1' } as any);
		const data = await bulkRes.json();
		expect(data.ok).toBe(true);
		expect(data.results.every((r: any) => r.ok)).toBe(true);
	});

	it('/api/admin/meta/[id] reads and updates metadata', async () => {
		const { GET, PATCH } = await import('../src/pages/api/admin/meta/[id]');
		const { session, cookieHeader } = makeSessionHeaders();

		const getReq = new Request('http://test/api/admin/meta/123', { headers: { cookie: cookieHeader } });
		const getRes = await GET({ request: getReq, params: { id: '123' }, clientAddress: '127.0.0.1' } as any);
		const getJson = await getRes.json();
		expect(getJson.ok).toBe(true);

		const patchReq = new Request('http://test/api/admin/meta/123', {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ tags: ['a', 'b'], docCategory: 'estate-agent' }),
		});
		const patchRes = await PATCH({ request: patchReq, params: { id: '123' }, clientAddress: '127.0.0.1' } as any);
		const patchJson = await patchRes.json();
		expect(patchRes.status).toBe(200);
		expect(patchJson.ok).toBe(true);
		expect(patchJson.meta.tags).toEqual(['a', 'b']);
		expect(patchJson.meta.docCategory).toBe('estate-agent');
	});

	it('/api/admin/meta/[id] rejects invalid scheduledAt', async () => {
		const { PATCH } = await import('../src/pages/api/admin/meta/[id]');
		const { session, cookieHeader } = makeSessionHeaders();
		const patchReq = new Request('http://test/api/admin/meta/124', {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ scheduledAt: 'not-a-date' }),
		});
		const res = await PATCH({ request: patchReq, params: { id: '124' }, clientAddress: '127.0.0.1' } as any);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.ok).toBe(false);
		expect(json.error).toBe('invalid_scheduledAt');
	});

	it('/api/admin/meta/[id] rejects invalid docCategory', async () => {
		const { PATCH } = await import('../src/pages/api/admin/meta/[id]');
		const { session, cookieHeader } = makeSessionHeaders();
		const patchReq = new Request('http://test/api/admin/meta/125', {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ docCategory: 'nope' }),
		});
		const res = await PATCH({ request: patchReq, params: { id: '125' }, clientAddress: '127.0.0.1' } as any);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.ok).toBe(false);
		expect(json.error).toBe('invalid_docCategory');
	});
});
