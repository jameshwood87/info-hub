import { chromium } from '@playwright/test';

const url = process.argv[2] || '';
if (!url) {
	process.stdout.write('usage: node scripts/check-doc-nav-scroll.mjs <url>\n');
	process.exit(2);
}

const checkOnce = async (page, label) => {
	await page.goto(url, { waitUntil: 'load' });
	await page.waitForTimeout(1500);
	const out = await page.evaluate(() => {
		const container = document.querySelector('.docNav');
		if (!(container instanceof HTMLElement)) return { ok: false, reason: 'no_docNav' };
		const hits = Array.from(container.querySelectorAll('.docNavLink.active, .docNavSummary.active, .docNavSummaryLink.active')).filter(
			(x) => x instanceof HTMLElement,
		);
		if (!hits.length) return { ok: false, reason: 'no_active' };
		const active = hits[hits.length - 1];
		const parentGroup = active.closest('details.docNavGroup');
		const parentOpen = parentGroup instanceof HTMLDetailsElement ? parentGroup.open : null;
		const activeHidden = active instanceof HTMLElement ? (active.offsetParent === null) : null;
		const c = container.getBoundingClientRect();
		const a = active.getBoundingClientRect();
		const header = container.querySelector('.docNavHeader');
		const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
		const visibleTop = c.top + headerHeight + 10;
		const visibleBottom = c.bottom - 10;
		const canSet = (() => {
			const prev = container.scrollTop;
			container.scrollTop = 200;
			const after = container.scrollTop;
			container.scrollTop = prev;
			return after === 200;
		})();
		return {
			ok: a.top >= visibleTop && a.bottom <= visibleBottom,
			scrollTop: container.scrollTop,
			scrollHeight: container.scrollHeight,
			clientHeight: container.clientHeight,
			parentOpen,
			activeHidden,
			aTop: a.top,
			aBottom: a.bottom,
			visibleTop,
			visibleBottom,
			canSet,
			activeText: (active.textContent || '').trim().slice(0, 60),
		};
	});
	process.stdout.write(`${label}\t${JSON.stringify(out)}\n`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => {
	process.stdout.write(`pageerror\t${String(e?.message || e)}\n`);
});
page.on('console', (m) => {
	if (m.type() === 'error') process.stdout.write(`console_error\t${m.text()}\n`);
});

await checkOnce(page, 'load');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(250);
await checkOnce(page, 'reload');

await browser.close();
