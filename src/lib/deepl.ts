type TranslateOpts = { html?: boolean; timeoutMs?: number; maxAttempts?: number };

import { getServerEnv } from './serverEnv';

const key = () => getServerEnv('DEEPL_API_KEY') || getServerEnv('DEEPL_AUTH_KEY') || getServerEnv('DEEPL_KEY') || '';

const endpointForKey = (k: string) => (k.trim().endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chunkHtml = (html: string, maxLen: number) => {
	const src = String(html || '');
	if (!src) return [];
	if (src.length <= maxLen) return [src];
	const splitRe = /(<\/p>|<\/li>|<\/h[1-6]>|<br\s*\/?>|\n)/gi;
	const parts = src.split(splitRe).filter((p) => p !== undefined && p !== null);
	const chunks: string[] = [];
	let cur = '';
	for (const part of parts) {
		const next = `${cur}${part}`;
		if (next.length > maxLen && cur) {
			chunks.push(cur);
			cur = part;
			continue;
		}
		cur = next;
	}
	if (cur) chunks.push(cur);
	return chunks.length ? chunks : [src];
};

export const canTranslateWithDeepL = () => Boolean(key().trim());

export const deeplTranslate = async (text: string, opts?: TranslateOpts): Promise<string> => {
	const src = String(text || '').trim();
	if (!src) return '';
	const k = key().trim();
	if (!k) throw new Error('missing_DEEPL_API_KEY');

	const endpoint = endpointForKey(k);
	const params = new URLSearchParams();
	params.set('text', src);
	params.set('source_lang', 'EN');
	params.set('target_lang', 'ES');
	params.set('preserve_formatting', '1');
	params.set('split_sentences', 'nonewlines');
	if (opts?.html) params.set('tag_handling', 'html');

	const maxAttempts = Math.max(1, Math.min(3, Math.floor(Number(opts?.maxAttempts || 3))));
	const timeoutMs = Math.max(2000, Math.min(45000, Math.floor(Number(opts?.timeoutMs || 20000))));

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `DeepL-Auth-Key ${k}` },
			body: params.toString(),
			signal: (AbortSignal as any)?.timeout ? (AbortSignal as any).timeout(timeoutMs) : undefined,
		});
		if (res.ok) {
			const json = await res.json().catch(() => null);
			const hit = json && Array.isArray((json as any).translations) ? (json as any).translations[0] : null;
			return String(hit?.text || '').trim();
		}
		if (res.status === 429 || res.status >= 500) {
			await sleep(300 * Math.pow(2, attempt));
			continue;
		}
		const msg = await res.text().catch(() => '');
		if (res.status === 456 && msg.toLowerCase().includes('quota exceeded')) {
			throw new Error('deepl_quota_exceeded');
		}
		throw new Error(`deepl_failed ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ''}`);
	}
	throw new Error('deepl_failed_retry');
};

export const deeplTranslateHtml = async (html: string, opts?: { maxChunkLen?: number; timeoutMs?: number; maxAttempts?: number }) => {
	const src = String(html || '').trim();
	if (!src) return '';
	const max = Math.max(20000, Math.min(120000, Number(opts?.maxChunkLen || 110000)));
	const chunks = chunkHtml(src, max);
	if (chunks.length === 1) return await deeplTranslate(src, { html: true, timeoutMs: opts?.timeoutMs, maxAttempts: opts?.maxAttempts });
	const out: string[] = [];
	for (const c of chunks) {
		const t = await deeplTranslate(c, { html: true, timeoutMs: opts?.timeoutMs, maxAttempts: opts?.maxAttempts });
		out.push(t);
	}
	return out.join('');
};
