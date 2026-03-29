import { test, expect, type Page } from '@playwright/test';

const ADMIN_PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const loginAsAdmin = async (page: Page) => {
	if (!ADMIN_PASSWORD) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');
	await page.goto('/admin/');
	await page.waitForURL(/\/admin\/login/);
	await page.getByLabel('Password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.waitForURL(/\/admin\/?$/);
};

const setCaretToEnd = async (page: Page, selector: string) => {
	await page.evaluate((sel: string) => {
		const el = document.querySelector(sel);
		if (!(el instanceof HTMLElement)) return;
		el.focus();
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(false);
		const selection = window.getSelection();
		if (!selection) return;
		selection.removeAllRanges();
		selection.addRange(range);
	}, selector);
};

const selectTextInRte = async (page: Page, selector: string, needle: string) => {
	await page.evaluate(
		({ sel, text }: { sel: string; text: string }) => {
			const root = document.querySelector(sel);
			if (!(root instanceof HTMLElement)) return;
			root.focus();
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node = walker.nextNode();
			while (node) {
				const value = node.nodeValue || '';
				const i = value.indexOf(text);
				if (i >= 0) {
					const r = document.createRange();
					r.setStart(node, i);
					r.setEnd(node, i + text.length);
					const selection = window.getSelection();
					if (!selection) return;
					selection.removeAllRanges();
					selection.addRange(r);
					return;
				}
				node = walker.nextNode();
			}
		},
		{ sel: selector, text: needle }
	);
};

const getRteHtml = async (page: Page, selector: string) =>
	await page.locator(selector).evaluate((el: Element) => (el instanceof HTMLElement ? el.innerHTML : ''));

test.describe.serial('admin', () => {
	test.skip(!ADMIN_PASSWORD, 'missing_INFO_HUB_ADMIN_PASSWORD');

	test('admin can login and CRUD a blog post', async ({ page }) => {
		await loginAsAdmin(page);

		await page.getByRole('link', { name: 'Blog Posts' }).click();
		await page.waitForURL(/\/admin\/blog/);

		await page.getByRole('button', { name: 'New post' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');

		await page.locator('#f_path').fill('/blog/e2e/my-post/');
		await page.locator('#f_title').fill('E2E Post');
		await page.locator('#f_desc').fill('E2E description');
		await page.locator('#f_seo_title').fill('E2E SEO');
		await page.locator('#f_seo_desc').fill('E2E SEO desc');
		await page.locator('#f_tags').fill('e2e, test');
		await page.locator('#f_body').click();
		await page.keyboard.type('Hello from e2e');

		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('E2E Post')).toBeVisible();

		const row = page.locator('tr', { hasText: 'E2E Post' });
		await row.getByRole('checkbox').check();
		await page.getByRole('button', { name: 'Publish' }).click();
		await page.getByRole('button', { name: 'Reload' }).click();
		await expect(page.getByText('E2E Post')).toBeVisible();

		await row.getByRole('button', { name: 'Edit' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');
		await expect(page.locator('#f_status')).toHaveValue('published');
		await page.getByRole('button', { name: 'Close' }).click();

		await row.getByRole('button', { name: 'Edit' }).click();
		await page.locator('#f_title').fill('E2E Post Updated');
		await page.getByRole('button', { name: 'Save' }).click();
		await page.getByRole('button', { name: 'Reload' }).click();
		await expect(page.locator('tr', { hasText: 'E2E Post Updated' })).toBeVisible();
	});

	test('blog editor formatting persists after save/reopen', async ({ page }) => {
		const id = Math.random().toString(36).slice(2, 10);
		await loginAsAdmin(page);

		await page.getByRole('link', { name: 'Blog Posts' }).click();
		await page.waitForURL(/\/admin\/blog/);

		await page.getByRole('button', { name: 'New post' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');

		await page.locator('#f_path').fill(`/blog/e2e/rte-${id}/`);
		await page.locator('#f_title').fill(`RTE ${id}`);
		await page.locator('#f_desc').fill('RTE formatting test');
		await page.locator('#f_seo_title').fill('RTE SEO');
		await page.locator('#f_seo_desc').fill('RTE SEO desc');

		await page.locator('#f_body').click();
		await page.keyboard.type('Heading One');
		await page.keyboard.press('Control+A');
		await page.locator('#editor .toolbar .tool[data-cmd="formatBlock"][data-arg="h1"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Bold Text');
		await selectTextInRte(page, '#f_body', 'Bold Text');
		await page.locator('#editor .toolbar .tool[data-cmd="bold"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Link Text');
		await selectTextInRte(page, '#f_body', 'Link Text');
		page.once('dialog', (d) => d.accept('https://example.com'));
		await page.locator('#editor .toolbar .tool[data-action="link"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.locator('#editor .toolbar .tool[data-cmd="insertUnorderedList"]').click();
		await page.keyboard.type('Item 1');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Item 2');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');

		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAAZoN1cAAAAASUVORK5CYII=',
			'base64',
		);
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.locator('#editor .toolbar .tool[data-action="image"]').click(),
		]);
		await chooser.setFiles({ name: 'x.png', mimeType: 'image/png', buffer: png });
		await expect(page.locator('#f_body img')).toHaveCount(1);

		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText(`RTE ${id}`)).toBeVisible();

		const row = page.locator('tr', { hasText: `RTE ${id}` });
		await row.getByRole('button', { name: 'Edit' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');

		const html = await getRteHtml(page, '#f_body');
		expect(html).toContain('<h1');
		expect(html).toContain('Heading One');
		expect(html).toContain('<strong');
		expect(html).toContain('Bold Text');
		expect(html).toContain('<a');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('Link Text');
		expect(html).toContain('<ul');
		expect(html).toContain('<li');
		expect(html).toContain('Item 1');
		expect(html).toContain('Item 2');
		expect(html).toContain('<img');
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('decoding="async"');
	});

	test('docs editor formatting persists after save/reopen', async ({ page }) => {
		const id = Math.random().toString(36).slice(2, 10);
		await loginAsAdmin(page);

		await page.getByRole('link', { name: 'Documentation' }).click();
		await page.waitForURL(/\/admin\/docs/);

		await page.getByRole('button', { name: 'New page' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');

		await page.locator('#f_path').fill(`/docs/e2e/rte-${id}/`);
		await page.locator('#f_title').fill(`RTE Docs ${id}`);
		await page.locator('#f_desc').fill('RTE formatting test');
		await page.locator('#f_seo_title').fill('RTE SEO');
		await page.locator('#f_seo_desc').fill('RTE SEO desc');

		await page.locator('#f_body').click();
		await page.keyboard.type('Heading One');
		await page.keyboard.press('Control+A');
		await page.locator('#editor .toolbar .tool[data-cmd="formatBlock"][data-arg="h1"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Bold Text');
		await selectTextInRte(page, '#f_body', 'Bold Text');
		await page.locator('#editor .toolbar .tool[data-cmd="bold"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Link Text');
		await selectTextInRte(page, '#f_body', 'Link Text');
		page.once('dialog', (d) => d.accept('https://example.com'));
		await page.locator('#editor .toolbar .tool[data-action="link"]').click();

		await setCaretToEnd(page, '#f_body');
		await page.keyboard.press('Enter');
		await page.locator('#editor .toolbar .tool[data-cmd="insertUnorderedList"]').click();
		await page.keyboard.type('Item 1');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Item 2');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');

		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAAZoN1cAAAAASUVORK5CYII=',
			'base64',
		);
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.locator('#editor .toolbar .tool[data-action="image"]').click(),
		]);
		await chooser.setFiles({ name: 'x.png', mimeType: 'image/png', buffer: png });
		await expect(page.locator('#f_body img')).toHaveCount(1);

		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText(`RTE Docs ${id}`)).toBeVisible();

		const row = page.locator('tr', { hasText: `RTE Docs ${id}` });
		await row.getByRole('button', { name: 'Edit' }).click();
		await expect(page.locator('#editor')).toHaveAttribute('open', '');

		const html = await getRteHtml(page, '#f_body');
		expect(html).toContain('<h1');
		expect(html).toContain('Heading One');
		expect(html).toContain('<strong');
		expect(html).toContain('Bold Text');
		expect(html).toContain('<a');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('Link Text');
		expect(html).toContain('<ul');
		expect(html).toContain('<li');
		expect(html).toContain('Item 1');
		expect(html).toContain('Item 2');
		expect(html).toContain('<img');
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('decoding="async"');
	});
});
