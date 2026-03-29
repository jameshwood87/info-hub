import { test, expect } from '@playwright/test';

const createKbPage = async (payload: {
	status: 'published' | 'draft';
	language: 'en' | 'es';
	path: string;
	title: string;
	description?: string | null;
	body?: string | null;
	seo_title?: string | null;
	seo_description?: string | null;
}) => {
	const res = await fetch('http://127.0.0.1:8055/items/kb_pages', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
	if (!res.ok) throw new Error(`Directus POST failed: ${res.status}`);
};

test.describe('neighbourhood', () => {
	test('filter matches accent-insensitively', async ({ page }) => {
		const id = Math.random().toString(36).slice(2, 10);
		const id2 = Math.random().toString(36).slice(2, 10);
		await createKbPage({
			status: 'published',
			language: 'en',
			path: `/neighbourhood/e2e-nueva-andalucia-${id}/`,
			title: `Nueva Andalucía Neighbourhood Guide ${id}`,
			description: 'E2E neighbourhood',
			body: '<p>Body</p>',
		});
		await createKbPage({
			status: 'published',
			language: 'en',
			path: `/neighbourhood/e2e-nueva-andalucia-${id2}/`,
			title: `Nueva Andalucía Neighbourhood Guide ${id2}`,
			description: 'E2E neighbourhood',
			body: '<p>Body</p>',
		});

		await page.goto('/neighbourhood/');

		const filter = page.locator('#nb-filter');
		await expect(filter).toBeVisible();
		const top = page.locator('section.top5[aria-label="Top searched neighbourhoods"]');
		const hasTop = (await top.count()) > 0;
		if (hasTop) await expect(top).toBeVisible();
		await filter.fill(`andalucia ${id}`);

		if (hasTop) await expect(top).toBeHidden();
		await expect(page.locator('.card', { hasText: `Nueva Andalucía Neighbourhood Guide ${id}` })).toBeVisible();
		await expect(page.locator('.card', { hasText: `Nueva Andalucía Neighbourhood Guide ${id2}` })).toBeHidden();
	});
});
