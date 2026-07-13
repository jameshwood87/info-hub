import type { APIRoute } from 'astro';
import { recordEvent } from '../../lib/eventStats';

// Public, cookieless CTA-click counter. Accepts only whitelisted event kinds.
const CTA = /^(signup|portal|oracle):(band|sidebar|featured|body|nav)$/;

export const POST: APIRoute = async ({ request }) => {
	try {
		const ua = request.headers.get('user-agent') || '';
		if (/bot|crawler|spider|curl|python|wget/i.test(ua)) return new Response(null, { status: 204 });
		const body = await request.json().catch(() => null);
		const cta = String(body?.cta || '');
		const path = String(body?.path || '');
		if (!CTA.test(cta) || !path.startsWith('/')) return new Response(null, { status: 204 });
		await recordEvent(`cta:${cta}`, path);
	} catch {
		/* never fail the client */
	}
	return new Response(null, { status: 204 });
};
