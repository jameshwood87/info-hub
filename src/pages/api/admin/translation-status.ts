import type { APIRoute } from 'astro';
import { assertAdmin, assertRole } from '../../../lib/adminAuth';
import { canTranslateWithDeepL } from '../../../lib/deepl';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ request }) => {
	const session = assertAdmin(request);
	assertRole(session, ['admin', 'editor']);

	const autoTranslateEnabled = String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES') || '').trim() !== '0';
	const autoPublishTranslation = String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES_PUBLISH') || '').trim() === '1';

	return json(200, {
		ok: true,
		autoTranslateEnabled,
		autoPublishTranslation,
		canTranslateWithDeepL: canTranslateWithDeepL(),
	});
};

