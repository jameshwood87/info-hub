import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createMockDirectusServer } from './mockDirectus';
import { adminAuthCookies, createAdminSession } from '../src/lib/adminAuth';

let directus: Awaited<ReturnType<typeof createMockDirectusServer>> | null = null;

beforeAll(async () => {
	directus = await createMockDirectusServer();
	process.env.DIRECTUS_URL = directus.baseUrl;
	process.env.DIRECTUS_ADMIN_TOKEN = 'testtoken';
});

afterAll(async () => {
	await directus?.stop();
});

describe('admin kb-pages routes', () => {
	it('creates, reads, updates, and deletes a blog post', async () => {
		const { POST: create } = await import('../src/pages/api/admin/kb-pages/index');
		const { GET: getOne, PATCH: patchOne, DELETE: deleteOne } = await import('../src/pages/api/admin/kb-pages/[id]');
		const { GET: list } = await import('../src/pages/api/admin/kb-pages/index');
		const { POST: bulk } = await import('../src/pages/api/admin/kb-pages/bulk');
		const { POST: recover } = await import('../src/pages/api/admin/kb-pages/recover');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		const createReq = new Request('http://test/api/admin/kb-pages', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({
				scope: 'blog',
				page: {
					status: 'draft',
					language: 'en',
					path: '/blog/testing/hello-world/',
					title: 'Hello <b>World</b>',
					description: 'Desc',
					body: '<h2>Hi</h2><script>alert(1)</script><p>ok</p>',
					seo_title: 'SEO',
					seo_description: 'SEO desc',
				},
			}),
		});

		const createRes = await create({ request: createReq, clientAddress: '127.0.0.1' } as any);
		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		expect(created.ok).toBe(true);
		const id = String(created.item.id);
		expect(id).toBeTruthy();
		expect(String(created.item.body || '')).not.toContain('<script');

		const listReq = new Request('http://test/api/admin/kb-pages?prefixes=/blog/', { headers: { cookie: cookieHeader } });
		const listRes = await list({ request: listReq, clientAddress: '127.0.0.1' } as any);
		const listJson = await listRes.json();
		expect(listJson.ok).toBe(true);
		expect(Array.isArray(listJson.items)).toBe(true);

		const getReq = new Request(`http://test/api/admin/kb-pages/${id}`, { headers: { cookie: cookieHeader } });
		const getRes = await getOne({ request: getReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		const got = await getRes.json();
		expect(got.ok).toBe(true);
		expect(got.item.id).toBe(id);

		const patchReq = new Request(`http://test/api/admin/kb-pages/${id}`, {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ patch: { status: 'published', title: 'Updated' } }),
		});
		const patchRes = await patchOne({ request: patchReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		const patched = await patchRes.json();
		expect(patched.ok).toBe(true);
		expect(patched.item.status).toBe('published');
		expect(patched.item.title).toContain('Updated');

		const recoverReq = new Request(`http://test/api/admin/kb-pages/recover`, {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ path: '/blog/testing/hello-world/' }),
		});
		const recoverRes = await recover({ request: recoverReq, clientAddress: '127.0.0.1' } as any);
		expect(recoverRes.status).toBe(200);
		const recovered = await recoverRes.json();
		expect(recovered.ok).toBe(true);
		expect(String(recovered.item.path)).toBe('/blog/testing/hello-world/');
		expect(String(recovered.item.title)).not.toContain('Updated');

		const delReq = new Request(`http://test/api/admin/kb-pages/${id}`, {
			method: 'DELETE',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken },
		});
		const delRes = await deleteOne({ request: delReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		expect(delRes.status).toBe(200);

		const listActiveReq = new Request('http://test/api/admin/kb-pages?prefixes=/blog/&status=any&bucket=active', {
			headers: { cookie: cookieHeader },
		});
		const listActiveRes = await list({ request: listActiveReq, clientAddress: '127.0.0.1' } as any);
		const listActiveJson = await listActiveRes.json();
		expect(listActiveJson.ok).toBe(true);
		expect((listActiveJson.items || []).some((it: any) => String(it.id) === id)).toBe(false);

		const listTrashReq = new Request('http://test/api/admin/kb-pages?prefixes=/blog/&status=any&bucket=trash', {
			headers: { cookie: cookieHeader },
		});
		const listTrashRes = await list({ request: listTrashReq, clientAddress: '127.0.0.1' } as any);
		const listTrashJson = await listTrashRes.json();
		expect(listTrashJson.ok).toBe(true);
		const trashedHit = (listTrashJson.items || []).find((it: any) => String(it.id) === id) || null;
		expect(trashedHit).toBeTruthy();
		expect(trashedHit.trashedAt).toBeTruthy();
		expect(trashedHit.trashUntil).toBeTruthy();

		const restoreReq = new Request('http://test/api/admin/kb-pages/bulk', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'restore', ids: [id] }),
		});
		const restoreRes = await bulk({ request: restoreReq, clientAddress: '127.0.0.1' } as any);
		const restoreJson = await restoreRes.json();
		expect(restoreJson.ok).toBe(true);
		expect((restoreJson.results || [])[0]?.ok).toBe(true);

		const archiveReq = new Request('http://test/api/admin/kb-pages/bulk', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'archive', ids: [id] }),
		});
		const archiveRes = await bulk({ request: archiveReq, clientAddress: '127.0.0.1' } as any);
		const archiveJson = await archiveRes.json();
		expect(archiveJson.ok).toBe(true);
		expect((archiveJson.results || [])[0]?.ok).toBe(true);

		const listArchivedReq = new Request('http://test/api/admin/kb-pages?prefixes=/blog/&status=any&bucket=archived', {
			headers: { cookie: cookieHeader },
		});
		const listArchivedRes = await list({ request: listArchivedReq, clientAddress: '127.0.0.1' } as any);
		const listArchivedJson = await listArchivedRes.json();
		expect(listArchivedJson.ok).toBe(true);
		expect((listArchivedJson.items || []).some((it: any) => String(it.id) === id)).toBe(true);

		const unarchiveReq = new Request('http://test/api/admin/kb-pages/bulk', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'unarchive', ids: [id] }),
		});
		const unarchiveRes = await bulk({ request: unarchiveReq, clientAddress: '127.0.0.1' } as any);
		const unarchiveJson = await unarchiveRes.json();
		expect(unarchiveJson.ok).toBe(true);
		expect((unarchiveJson.results || [])[0]?.ok).toBe(true);

		const purgeReq = new Request('http://test/api/admin/kb-pages/bulk', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'purge', ids: [id] }),
		});
		const purgeRes = await bulk({ request: purgeReq, clientAddress: '127.0.0.1' } as any);
		const purgeJson = await purgeRes.json();
		expect(purgeJson.ok).toBe(true);
		expect((purgeJson.results || [])[0]?.ok).toBe(true);

		const getAfterPurgeReq = new Request(`http://test/api/admin/kb-pages/${id}`, { headers: { cookie: cookieHeader } });
		const getAfterPurgeRes = await getOne({ request: getAfterPurgeReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		expect(getAfterPurgeRes.status).toBe(404);
	});

	it('lists more than 500 items when limit exceeds one page', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { GET: list } = await import('../src/pages/api/admin/kb-pages/index');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		for (let i = 0; i < 520; i++) {
			await adminCreateKbPage({
				status: 'draft',
				language: 'en',
				path: `/docs/paginate/${i}/`,
				title: `P${i}`,
				description: null,
				body: '<p>x</p>',
				seo_title: null,
				seo_description: null,
			});
		}

		const listReq = new Request('http://test/api/admin/kb-pages?prefixes=/docs/&status=any&limit=5000', { headers: { cookie: cookieHeader } });
		const listRes = await list({ request: listReq, clientAddress: '127.0.0.1' } as any);
		expect(listRes.status).toBe(200);
		const listJson = await listRes.json();
		expect(listJson.ok).toBe(true);
		expect(Array.isArray(listJson.items)).toBe(true);
		expect(listJson.items.length).toBeGreaterThan(500);
	});

	it('lists tree children for docs and blog prefixes', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { GET: tree } = await import('../src/pages/api/admin/kb-tree');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		const docsParent = await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/tree-parent/',
			title: 'Tree Parent',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/tree-parent/child/',
			title: 'Child',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const docsRootReq = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/', { headers: { cookie: cookieHeader } });
		const docsRootRes = await tree({ request: docsRootReq, clientAddress: '127.0.0.1' } as any);
		expect(docsRootRes.status).toBe(200);
		const docsRootJson = await docsRootRes.json();
		expect(docsRootJson.ok).toBe(true);
		const parentNode = (docsRootJson.nodes || []).find((n: any) => n.path === '/docs/tree-parent/');
		expect(parentNode).toBeTruthy();
		expect(parentNode.hasPage).toBe(true);
		expect(parentNode.pageId).toBe(String(docsParent.id));
		expect(parentNode.hasChildren).toBe(true);

		const docsChildReq = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/tree-parent/', {
			headers: { cookie: cookieHeader },
		});
		const docsChildRes = await tree({ request: docsChildReq, clientAddress: '127.0.0.1' } as any);
		const docsChildJson = await docsChildRes.json();
		expect((docsChildJson.nodes || []).some((n: any) => n.path === '/docs/tree-parent/child/')).toBe(true);

		const blogCat = await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/blog/tree/news/',
			title: 'News',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/blog/tree/news/hello/',
			title: 'Hello',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const blogReq = new Request('http://test/api/admin/kb-tree?prefixes=/blog/,/general-information/&parent=/blog/', {
			headers: { cookie: cookieHeader },
		});
		const blogRes = await tree({ request: blogReq, clientAddress: '127.0.0.1' } as any);
		const blogJson = await blogRes.json();
		expect(blogJson.ok).toBe(true);
		const newsNode = (blogJson.nodes || []).find((n: any) => n.path === '/blog/tree/');
		expect(newsNode).toBeTruthy();
		expect(newsNode.hasChildren).toBe(true);
		expect(String(blogCat.id)).toBeTruthy();
	});

	it('reorders docs tree nodes and persists ordering', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { GET: tree } = await import('../src/pages/api/admin/kb-tree');
		const { POST: reorder } = await import('../src/pages/api/admin/kb-tree/reorder');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/reorder/a/',
			title: 'A',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/reorder/b/',
			title: 'B',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/reorder/c/',
			title: 'C',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/reorder/d/',
			title: 'D',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const listReq1 = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listRes1 = await tree({ request: listReq1, clientAddress: '127.0.0.1' } as any);
		const listJson1 = await listRes1.json();
		expect(listJson1.ok).toBe(true);
		expect((listJson1.nodes || []).map((n: any) => n.path)).toEqual(['/docs/reorder/a/', '/docs/reorder/b/', '/docs/reorder/c/', '/docs/reorder/d/']);

		const reorderMiddleReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({
				nodePath: '/docs/reorder/d/',
				toParentPath: '/docs/reorder/',
				toIndex: 2,
				seed: { '/docs/reorder/': ['/docs/reorder/a/', '/docs/reorder/b/', '/docs/reorder/c/', '/docs/reorder/d/'] },
			}),
		});
		const reorderMiddleRes = await reorder({ request: reorderMiddleReq, clientAddress: '127.0.0.1' } as any);
		const reorderMiddleJson = await reorderMiddleRes.json();
		expect(reorderMiddleJson.ok).toBe(true);

		const listReqMiddle = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listResMiddle = await tree({ request: listReqMiddle, clientAddress: '127.0.0.1' } as any);
		const listJsonMiddle = await listResMiddle.json();
		expect((listJsonMiddle.nodes || []).map((n: any) => n.path)).toEqual([
			'/docs/reorder/a/',
			'/docs/reorder/b/',
			'/docs/reorder/d/',
			'/docs/reorder/c/',
		]);

		const reorderReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ nodePath: '/docs/reorder/c/', toParentPath: '/docs/reorder/', toIndex: 0 }),
		});
		const reorderRes = await reorder({ request: reorderReq, clientAddress: '127.0.0.1' } as any);
		const reorderJson = await reorderRes.json();
		expect(reorderJson.ok).toBe(true);

		const listReq2 = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listRes2 = await tree({ request: listReq2, clientAddress: '127.0.0.1' } as any);
		const listJson2 = await listRes2.json();
		expect((listJson2.nodes || []).map((n: any) => n.path)).toEqual(['/docs/reorder/c/', '/docs/reorder/a/', '/docs/reorder/b/', '/docs/reorder/d/']);

		const moveReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ nodePath: '/docs/reorder/b/', toParentPath: '/docs/reorder/a/', toIndex: 0 }),
		});
		const moveRes = await reorder({ request: moveReq, clientAddress: '127.0.0.1' } as any);
		expect(moveRes.status).toBe(200);

		const listReqMovedRoot = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listResMovedRoot = await tree({ request: listReqMovedRoot, clientAddress: '127.0.0.1' } as any);
		const listJsonMovedRoot = await listResMovedRoot.json();
		expect((listJsonMovedRoot.nodes || []).map((n: any) => n.path)).toEqual(['/docs/reorder/c/', '/docs/reorder/a/', '/docs/reorder/d/']);

		const listReq3 = new Request('http://test/api/admin/kb-tree?prefixes=/docs/&parent=/docs/reorder/a/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listRes3 = await tree({ request: listReq3, clientAddress: '127.0.0.1' } as any);
		const listJson3 = await listRes3.json();
		expect((listJson3.nodes || []).map((n: any) => n.path)).toEqual(['/docs/reorder/a/b/']);
	});

	it('rejects move when target path is already taken', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { POST: reorder } = await import('../src/pages/api/admin/kb-tree/reorder');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/move/a/',
			title: 'A',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/move/b/',
			title: 'B',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/move/a/b/',
			title: 'Already Taken',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const moveReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ nodePath: '/docs/move/b/', toParentPath: '/docs/move/a/', toIndex: 0 }),
		});
		const moveRes = await reorder({ request: moveReq, clientAddress: '127.0.0.1' } as any);
		expect(moveRes.status).toBe(409);
		const moveJson = await moveRes.json();
		expect(moveJson.ok).toBe(false);
		expect(String(moveJson.error || '')).toBe('target_path_taken');
	});

	it('rejects moving a node into its descendant', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { POST: reorder } = await import('../src/pages/api/admin/kb-tree/reorder');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/desc/a/',
			title: 'A',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/docs/desc/a/child/',
			title: 'Child',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const moveReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ nodePath: '/docs/desc/a/', toParentPath: '/docs/desc/a/child/', toIndex: 0 }),
		});
		const moveRes = await reorder({ request: moveReq, clientAddress: '127.0.0.1' } as any);
		expect(moveRes.status).toBe(400);
		const moveJson = await moveRes.json();
		expect(moveJson.ok).toBe(false);
		expect(String(moveJson.error || '')).toBe('cannot_move_into_descendant');
	});

	it('reorders blog tree nodes and persists ordering', async () => {
		const { adminCreateKbPage } = await import('../src/lib/directus');
		const { GET: tree } = await import('../src/pages/api/admin/kb-tree');
		const { POST: reorder } = await import('../src/pages/api/admin/kb-tree/reorder');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/blog/reorder/a/',
			title: 'A',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});
		await adminCreateKbPage({
			status: 'draft',
			language: 'en',
			path: '/blog/reorder/b/',
			title: 'B',
			description: null,
			body: '<p>x</p>',
			seo_title: null,
			seo_description: null,
		});

		const listReq1 = new Request('http://test/api/admin/kb-tree?prefixes=/blog/,/general-information/&parent=/blog/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listRes1 = await tree({ request: listReq1, clientAddress: '127.0.0.1' } as any);
		const listJson1 = await listRes1.json();
		expect(listJson1.ok).toBe(true);
		expect((listJson1.nodes || []).map((n: any) => n.path)).toEqual(['/blog/reorder/a/', '/blog/reorder/b/']);

		const reorderReq = new Request('http://test/api/admin/kb-tree/reorder', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ nodePath: '/blog/reorder/b/', toParentPath: '/blog/reorder/', toIndex: 0 }),
		});
		const reorderRes = await reorder({ request: reorderReq, clientAddress: '127.0.0.1' } as any);
		const reorderJson = await reorderRes.json();
		expect(reorderJson.ok).toBe(true);

		const listReq2 = new Request('http://test/api/admin/kb-tree?prefixes=/blog/,/general-information/&parent=/blog/reorder/&status=any&cap=5000', {
			headers: { cookie: cookieHeader },
		});
		const listRes2 = await tree({ request: listReq2, clientAddress: '127.0.0.1' } as any);
		const listJson2 = await listRes2.json();
		expect((listJson2.nodes || []).map((n: any) => n.path)).toEqual(['/blog/reorder/b/', '/blog/reorder/a/']);
	});

	it('schedules a publish via meta and scheduler', async () => {
		const { POST: create } = await import('../src/pages/api/admin/kb-pages/index');
		const { PATCH: patchMeta } = await import('../src/pages/api/admin/meta/[id]');
		const { runPublishScheduler } = await import('../src/lib/adminScheduler');
		const { adminGetKbPageById } = await import('../src/lib/directus');

		const session = createAdminSession();
		const cookies = adminAuthCookies(session);
		const cookieHeader = `${cookies.session.split(';')[0]}; ${cookies.csrf.split(';')[0]}`;

		const createReq = new Request('http://test/api/admin/kb-pages', {
			method: 'POST',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({
				scope: 'blog',
				page: {
					status: 'draft',
					language: 'en',
					path: '/blog/testing/scheduled/',
					title: 'Scheduled',
					description: null,
					body: '<p>later</p>',
					seo_title: null,
					seo_description: null,
				},
			}),
		});
		const created = await (await create({ request: createReq, clientAddress: '127.0.0.1' } as any)).json();
		const id = String(created.item.id);

		const scheduledAt = new Date(Date.now() - 60_000).toISOString();
		const metaReq = new Request(`http://test/api/admin/meta/${id}`, {
			method: 'PATCH',
			headers: { cookie: cookieHeader, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
			body: JSON.stringify({ scheduledAt }),
		});
		const metaRes = await patchMeta({ request: metaReq, params: { id }, clientAddress: '127.0.0.1' } as any);
		expect(metaRes.status).toBe(200);

		await runPublishScheduler({ minIntervalMs: 0 });
		const page = await adminGetKbPageById(id);
		expect(page?.status).toBe('published');
	});
});
