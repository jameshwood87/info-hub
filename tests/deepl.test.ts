import { describe, expect, it, vi } from 'vitest';
import { canTranslateWithDeepL, deeplTranslateHtml } from '../src/lib/deepl';

describe('deepl', () => {
	it('detects configured key', () => {
		delete process.env.DEEPL_API_KEY;
		expect(canTranslateWithDeepL()).toBe(false);
		process.env.DEEPL_API_KEY = 'test:fx';
		expect(canTranslateWithDeepL()).toBe(true);
	});

	it('chunks html and translates multiple parts', async () => {
		process.env.DEEPL_API_KEY = 'test:fx';
		const calls: string[] = [];
		const fetchSpy = vi.fn(async (_url: any, init: any) => {
			calls.push(String(init?.body || ''));
			const i = calls.length;
			return new Response(JSON.stringify({ translations: [{ text: `T${i}` }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		vi.stubGlobal('fetch', fetchSpy);

		const p1 = `<p>${'a'.repeat(18000)}</p>`;
		const p2 = `<p>${'b'.repeat(18000)}</p>`;
		const p3 = `<p>${'c'.repeat(18000)}</p>`;
		const html = `${p1}${p2}${p3}`;
		const out = await deeplTranslateHtml(html, { maxChunkLen: 20000 });
		expect(out).toBe('T1T2T3');
		expect(fetchSpy).toHaveBeenCalledTimes(3);

		vi.unstubAllGlobals();
	});
});
