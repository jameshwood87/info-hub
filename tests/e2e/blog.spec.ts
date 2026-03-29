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

test.describe('blog', () => {
	test('blog listing supports filtering and includes SEO metadata', async ({ page }) => {
		const id = Math.random().toString(36).slice(2, 10);
		await createKbPage({
			status: 'published',
			language: 'en',
			path: `/blog/e2e-post-${id}/`,
			title: `E2E Blog Post ${id}`,
			description: 'E2E blog description',
			body: '<p>Body</p>',
			seo_title: 'E2E Blog SEO',
			seo_description: 'E2E Blog SEO desc',
		});
		await createKbPage({
			status: 'published',
			language: 'en',
			path: `/general-information/e2e-news-${id}/`,
			title: `E2E News Post ${id}`,
			description: 'E2E news description',
			body: '<p>Body</p>',
			seo_title: 'E2E News SEO',
			seo_description: 'E2E News SEO desc',
		});

		await page.goto('/blog/');
		await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible();
		await expect(page.getByRole('link', { name: `E2E Blog Post ${id}`, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: `E2E News Post ${id}`, exact: true })).toBeVisible();

		await page.getByLabel('Filter', { exact: true }).fill(`news post ${id}`);
		await expect(page.locator('#blog-results')).toContainText('Showing 1 post');
		await expect(page.getByRole('link', { name: `E2E News Post ${id}`, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: `E2E Blog Post ${id}`, exact: true })).toBeHidden();

		await page.locator('button[data-cat="blog"]').click();
		await expect(page.locator('#blog-results')).toContainText('Showing 0 posts');

		await page.locator('button[data-cat="all"]').click();
		await page.getByLabel('Filter', { exact: true }).fill('');
		await expect(page.getByRole('link', { name: `E2E Blog Post ${id}`, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: `E2E News Post ${id}`, exact: true })).toBeVisible();

		const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
		expect(ogTitle || '').toContain('Blog');

		const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
		expect(ogImage || '').toContain('/blog/hero-default.svg');

		await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2);
	});

	test('injects GA snippet and consent banner can enable tracking', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => {
			try {
				localStorage.setItem('pl_ga_consent', 'granted');
			} catch {}
		});
		await page.reload();

		await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-"]')).toHaveCount(1);

		const state = await page.evaluate(() => {
			const v = (() => {
				try {
					return localStorage.getItem('pl_ga_consent');
				} catch {
					return null;
				}
			})();
			const dl = Array.isArray((window as any).dataLayer) ? (window as any).dataLayer : [];
			const calls = dl
				.map((x: any) => {
					if (Array.isArray(x)) return x;
					if (x && typeof x === 'object' && typeof x.length === 'number') return Array.from(x);
					return null;
				})
				.filter(Boolean)
				.filter((x: any[]) => x[0] === 'config' || x[0] === 'consent');
			return { v, calls };
		});

		expect(state.v).toBe('granted');
		expect(state.calls.some((c: any[]) => c[0] === 'consent' && c[1] === 'update')).toBeTruthy();
		expect(state.calls.some((c: any[]) => c[0] === 'config' && /^G-/i.test(String(c[1] || '')))).toBeTruthy();
	});
});
