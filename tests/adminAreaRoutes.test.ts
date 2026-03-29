import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockDirectusServer } from './mockDirectus';
import { adminAuthCookies, createAdminSession } from '../src/lib/adminAuth';

let directus: Awaited<ReturnType<typeof createMockDirectusServer>> | null = null;
let varDir = '';

beforeAll(async () => {
	directus = await createMockDirectusServer();
	process.env.DIRECTUS_URL = directus.baseUrl;
	process.env.DIRECTUS_ADMIN_TOKEN = 'testtoken';
	varDir = await fs.mkdtemp(path.join(process.cwd(), 'var-test-area-'));
	process.env.INFO_HUB_VAR_DIR = varDir;
	process.env.INFO_HUB_STATS_TOKEN = 'stats-token';
});

afterAll(async () => {
	await directus?.stop();
	if (varDir) await fs.rm(varDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('area pages admin + meta + share/publish helpers', () => {
	it('creates an area page, updates meta, runs stats refresh, and generates pdf export', async () => {
		const { POST: create } = await import('../src/pages/api/admin/kb-pages/index');
		const { GET: getMeta, PATCH: patchMeta } = await import('../src/pages/api/admin/meta/[id]');
		const { POST: updateAreaStats } = await import('../src/pages/api/update-area-stats');
		const { GET: areaPdf } = await import('../src/pages/api/area-pdf');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		const createReq = new Request('http://test/api/admin/kb-pages', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({
				scope: 'area',
				page: {
					status: 'draft',
					language: 'en',
					path: '/andalucia/malaga/marbella/',
					title: 'Marbella Area Guide',
					description: 'Marbella overview',
					body: '<h2>Overview</h2><p>Intro</p>',
					seo_title: 'Marbella property guide',
					seo_description: 'Marbella guide',
				},
			}),
		});

		const createRes = await create({ request: createReq, clientAddress: '127.0.0.1' } as any);
		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		expect(created.ok).toBe(true);
		const id = String(created.item.id);
		expect(id).toBeTruthy();
		expect(String(created.item.path)).toBe('/andalucia/malaga/marbella/');

		const patchMetaReq = new Request(`http://test/api/admin/meta/${id}`, {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({
				tags: ['malaga', 'marbella'],
				areaStats: { avgPrice: 750000, rentalYield: 4.2, airportDistance: 52.5, beachDistance: 1.1, priceTrend: 'Rising', listingCount: 1234 },
				areaHeroImage: {
					url: 'https://example.com/x.webp',
					alt: 'Marbella',
					source: 'Wikimedia',
					pageUrl: 'https://example.com/page',
					creditName: 'Photographer',
					creditUrl: 'https://example.com/credit',
					licenseName: 'CC BY-SA 4.0',
					licenseUrl: 'https://example.com/licence',
				},
				areaFaq: [
					{ q: 'Is Marbella good for families?', a: 'Yes.' },
					{ q: 'What is the airport?', a: 'Málaga (AGP).' },
				],
			}),
		});
		const patchMetaRes = await patchMeta({ request: patchMetaReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		expect(patchMetaRes.status).toBe(200);
		const patched = await patchMetaRes.json();
		expect(patched.ok).toBe(true);
		expect(patched.meta?.areaStats?.avgPrice).toBe(750000);
		expect(patched.meta?.areaHeroImage?.url).toBe('https://example.com/x.webp');
		expect(Array.isArray(patched.meta?.areaFaq)).toBe(true);

		const getMetaReq = new Request(`http://test/api/admin/meta/${id}`, { headers: { cookie: cookieHeader } });
		const getMetaRes = await getMeta({ request: getMetaReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		const gotMeta = await getMetaRes.json();
		expect(gotMeta.ok).toBe(true);
		expect(gotMeta.meta?.areaStats?.rentalYield).toBe(4.2);

		const statsReq = new Request('http://test/api/update-area-stats', {
			method: 'POST',
			headers: { authorization: `Bearer ${process.env.INFO_HUB_STATS_TOKEN}`, 'content-type': 'application/json' },
			body: JSON.stringify({ keys: [id], force: true }),
		});
		const statsRes = await updateAreaStats({ request: statsReq } as any);
		expect(statsRes.status).toBe(200);
		const statsJson = await statsRes.json();
		expect(statsJson.ok).toBe(true);
		expect(statsJson.updated).toBe(1);

		const gotMeta2Res = await getMeta({ request: getMetaReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		const gotMeta2 = await gotMeta2Res.json();
		expect(typeof gotMeta2.meta?.areaStatsUpdatedAt).toBe('string');
		expect(typeof gotMeta2.meta?.areaStatsDueAt).toBe('string');

		const originalFetch = globalThis.fetch;
		const fetchSpy = vi.fn(async (input: any) => {
			const u = String(input || '');
			expect(u).toContain('/andalucia/malaga/marbella/');
			expect(u).toContain('client=1');
			return new Response('<html><body>ok</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
		});
		(globalThis as any).fetch = fetchSpy;

		const pdfReq = new Request('http://test/api/area-pdf?path=/share/andalucia/malaga/marbella/');
		const pdfRes = await areaPdf({ request: pdfReq } as any);
		expect(pdfRes.status).toBe(200);
		expect(String(pdfRes.headers.get('content-type'))).toContain('text/html');
		expect(String(pdfRes.headers.get('content-disposition'))).toContain('malaga-marbella.html');
		const html = await pdfRes.text();
		expect(html).toContain('<html');

		(globalThis as any).fetch = originalFetch;
	});
});
