import { test, expect } from '@playwright/test';

const DIRECTUS_ORIGIN = 'http://127.0.0.1:8055';

const seedPage = async (request: any, path: string, title: string) => {
	await request.post(`${DIRECTUS_ORIGIN}/items/kb_pages`, {
		data: {
			status: 'published',
			language: 'en',
			path,
			title,
			description: null,
			body: `<h1>${title}</h1><p>Body</p>`,
			seo_title: null,
			seo_description: null,
		},
	});
};

test('docs sidebar scrolls to active third-level item', async ({ page, request }) => {
	await seedPage(request, '/docs/propertylist-mls-user-manual/', 'Manual');

	for (let i = 1; i <= 40; i++) {
		const n = String(i).padStart(2, '0');
		await seedPage(request, `/docs/propertylist-mls-user-manual/section-${n}/`, `Section ${n}`);
		await seedPage(request, `/docs/propertylist-mls-user-manual/section-${n}/page-${n}/`, `Page ${n}`);
	}

	await seedPage(request, '/docs/propertylist-mls-user-manual/searching-and-alerts/', 'Searching & Alerts');
	for (let i = 1; i <= 12; i++) {
		const n = String(i).padStart(2, '0');
		await seedPage(
			request,
			`/docs/propertylist-mls-user-manual/searching-and-alerts/item-${n}/`,
			`Searching Item ${n}`,
		);
	}

	await seedPage(request, '/docs/propertylist-mls-user-manual/requests/', 'Requests');
	await seedPage(request, '/docs/propertylist-mls-user-manual/requests/agent-requests/', 'Agent Requests');

	await page.goto('/docs/propertylist-mls-user-manual/searching-and-alerts/item-12/');
	const isMobile = (page.viewportSize()?.width || 0) <= 960;
	if (isMobile) {
		await page.locator('[data-doc-nav-open]').first().click();
		await expect(page.locator('[data-doc-nav-overlay]')).toBeVisible();
	} else {
		await expect(page.locator('.docNav')).toBeVisible();
	}

	await expect
		.poll(async () => {
			return await page.evaluate(() => {
				const isMobile = window.matchMedia('(max-width: 960px)').matches;
				const container = isMobile ? document.querySelector('.docNavDrawer') : document.querySelector('.docNav');
				if (!(container instanceof HTMLElement)) return { ok: false };
				const hits = Array.from(
					container.querySelectorAll('.docNavLink.active, .docNavSummary.active, .docNavSummaryLink.active'),
				).filter((x) => x instanceof HTMLElement) as HTMLElement[];
				if (!hits.length) return { ok: false };
				let active = hits[0];
				let bestDepth = -1;
				for (const el of hits) {
					const node = el.closest('[data-depth]');
					const d = node ? Number.parseInt(node.getAttribute('data-depth') || '0', 10) : 0;
					if (d > bestDepth) {
						bestDepth = d;
						active = el;
					}
				}
				const navRect = container.getBoundingClientRect();
				const activeRect = active.getBoundingClientRect();
				const header = container.querySelector('.docNavHeader');
				const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
				const visibleTop = navRect.top + headerHeight + 8;
				const visibleBottom = navRect.bottom - 8;
				const ok = activeRect.top >= visibleTop && activeRect.bottom <= visibleBottom;
				return { ok, scrollTop: container.scrollTop };
			});
		})
		.toMatchObject({ ok: true });

	const scrollTop = await page.evaluate(() => {
		const isMobile = window.matchMedia('(max-width: 960px)').matches;
		const nav = isMobile ? document.querySelector('.docNavDrawer') : document.querySelector('.docNav');
		return nav instanceof HTMLElement ? nav.scrollTop : 0;
	});
	expect(scrollTop).toBeGreaterThan(0);
});

test('docs sidebar scrolls to active item when section is not initially in view', async ({ page, request }) => {
	await seedPage(request, '/docs/propertylist-mls-user-manual/', 'Manual');

	for (let i = 1; i <= 30; i++) {
		const n = String(i).padStart(2, '0');
		await seedPage(request, `/docs/propertylist-mls-user-manual/section-${n}/`, `Section ${n}`);
	}
	await seedPage(request, '/docs/propertylist-mls-user-manual/requests/', 'Requests');
	await seedPage(request, '/docs/propertylist-mls-user-manual/requests/agent-requests/', 'Agent Requests');

	await page.goto('/docs/propertylist-mls-user-manual/requests/agent-requests/');
	const isMobile = (page.viewportSize()?.width || 0) <= 960;
	if (isMobile) {
		await page.locator('[data-doc-nav-open]').first().click();
		await expect(page.locator('[data-doc-nav-overlay]')).toBeVisible();
	} else {
		await expect(page.locator('.docNav')).toBeVisible();
	}

	await expect
		.poll(async () => {
			return await page.evaluate(() => {
				const isMobile = window.matchMedia('(max-width: 960px)').matches;
				const container = isMobile ? document.querySelector('.docNavDrawer') : document.querySelector('.docNav');
				if (!(container instanceof HTMLElement)) return { ok: false };
				const hits = Array.from(
					container.querySelectorAll('.docNavLink.active, .docNavSummary.active, .docNavSummaryLink.active'),
				).filter((x) => x instanceof HTMLElement) as HTMLElement[];
				if (!hits.length) return { ok: false };
				const active = hits[hits.length - 1];
				const navRect = container.getBoundingClientRect();
				const activeRect = active.getBoundingClientRect();
				const header = container.querySelector('.docNavHeader');
				const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
				const visibleTop = navRect.top + headerHeight + 8;
				const visibleBottom = navRect.bottom - 8;
				const ok = activeRect.top >= visibleTop && activeRect.bottom <= visibleBottom;
				return { ok, scrollTop: container.scrollTop };
			});
		})
		.toMatchObject({ ok: true });
});
