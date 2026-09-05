import { defineMiddleware } from 'astro/middleware';
import crypto from 'node:crypto';
import { canonicalAreaPath } from './lib/areaProvince';
import { recordWeeklyView } from './lib/weeklyViews';
import { recordEvent } from './lib/eventStats';
import { getAdminSessionFromRequest } from './lib/adminAuth';
import { runAreaStatsScheduler, runNeighbourhoodStatsScheduler, runPublishScheduler } from './lib/adminScheduler';
import { resolveRedirect } from './lib/kbRedirects';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;
const directusUrl = () => (readEnv('DIRECTUS_URL') || 'http://127.0.0.1:8055').replace(/\/+$/g, '');

// View de-dup + bot filter so a page view counts once per visitor per window,
// and link-preview / crawler fetches do not inflate the public "X views" badge.
const VIEW_DEDUP_TTL = 6 * 60 * 60 * 1000; // 6h; a genuine return visit later still counts
const viewSeen = new Map<string, number>();
const VIEW_BOT_RE = /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discordbot|skypeuripreview|embedly|quora link preview|pinterest|redditbot|twitterbot|linkedinbot|headless|preview|python-requests|curl\/|wget|axios|node-fetch|go-http|GPTBot|ClaudeBot|anthropic|PerplexityBot|CCBot|Bytespider|meta-externalagent|Applebot|Google-Extended/i;
const clientIp = (context: { clientAddress?: string; request: Request }) => {
	const h = context.request.headers;
	const cf = h.get('cf-connecting-ip');
	if (cf) return cf.trim();
	const xff = h.get('x-forwarded-for');
	if (xff) return xff.split(',')[0]!.trim();
	const xr = h.get('x-real-ip');
	if (xr) return xr.trim();
	try { return String(context.clientAddress || 'unknown'); } catch { return 'unknown'; }
};
const shouldCountView = (ip: string, ua: string, p: string) => {
	if (!ua || VIEW_BOT_RE.test(ua)) return false;
	const now = Date.now();
	const key = ip + '|' + p;
	const last = viewSeen.get(key);
	if (last && now - last < VIEW_DEDUP_TTL) return false;
	viewSeen.set(key, now);
	if (viewSeen.size > 50000) { for (const [k, t] of viewSeen) { if (now - t > VIEW_DEDUP_TTL) viewSeen.delete(k); } }
	return true;
};

export const onRequest = defineMiddleware(async (context, next) => {
	try {
		const ua = context.request.headers.get('user-agent') || '';
		const bot = /GPTBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Bytespider|meta-externalagent|Applebot-Extended/i.exec(ua);
		if (bot) recordEvent(`bot:${bot[0]}`, context.url.pathname).catch(() => undefined);
	} catch {}

	// --- Temporary password gate for pages still being finished ---
	const VIDEO_GATE_PATHS: string[] = [
		// /video-guides made public 2026-07-20 (EN); the Property Intelligence
		// Report pages made public 2026-08-09; /es/video-guias made public
		// 2026-08-17 (James: they should be ungated live). Nothing is gated
		// right now - add a path here to gate an unfinished page again.
	];
	{
		const gp = new URL(context.request.url).pathname.replace(/\/+$/, '') || '/';
		if (VIDEO_GATE_PATHS.some((p) => gp === p || gp.startsWith(p + '/'))) {
			const pass = (process.env.VIDEO_GATE_PASS as string | undefined) || (import.meta as any).env?.VIDEO_GATE_PASS || '';
			const cookie = context.request.headers.get('cookie') || '';
			const expect = pass ? crypto.createHash('sha256').update('plvg:' + pass).digest('hex').slice(0, 32) : '';
			const has = expect && cookie.split(/;\s*/).some((c) => c === 'pl_vg=' + expect);
			const es = gp.startsWith('/es/');
			if (pass && !has) {
				if (context.request.method === 'POST') {
					const form = await context.request.formData().catch(() => null);
					const given = String(form?.get('pw') || '');
					if (given === pass) {
						return new Response(null, {
							status: 303,
							headers: {
								Location: gp + '/',
								'Set-Cookie': `pl_vg=${expect}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
							},
						});
					}
					return new Response(videoGateHtml(es, true, gp), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } });
				}
				return new Response(videoGateHtml(es, false, gp), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
			}
		}
	}

	const url = new URL(context.request.url);
	const pathname = url.pathname;
	const _viewUa = context.request.headers.get('user-agent') || '';
	const _viewIp = clientIp(context);
	const rec = async (p: string) => { if (shouldCountView(_viewIp, _viewUa, p)) await recordWeeklyView(p); };
	if (context.request.method === 'GET' || context.request.method === 'HEAD') {
		const docsCanonNoRedirect: string[] = [
			'/docs/propertylist-mls-user-manual/managing-your-leads/portal-leads/',
			'/docs/propertylist-mls-user-manual/managing-your-leads/mls-leads/',
		];
		for (const p of docsCanonNoRedirect) {
			if (pathname === p || pathname === p.slice(0, -1)) return next();
		}
		const leadAliases: Array<{ from: string; to: string }> = [
			{
				from: '/docs/propertylist-mls-user-manual/managing-your-leads/new-page/portal-leads/',
				to: '/docs/propertylist-mls-user-manual/managing-your-leads/portal-leads/',
			},
			{
				from: '/docs/propertylist-mls-user-manual/managing-your-leads/new-page/mls-leads/',
				to: '/docs/propertylist-mls-user-manual/managing-your-leads/mls-leads/',
			},
			{
				from: '/docs/propertylist-mls-user-manual/managing-your-leads/portal-leads/mls-leads/',
				to: '/docs/propertylist-mls-user-manual/managing-your-leads/mls-leads/',
			},
		];
		for (const r of leadAliases) {
			if (pathname.startsWith(r.from)) {
				const rest = pathname.slice(r.from.length);
				return new Response(null, { status: 301, headers: { Location: `${r.to}${rest}${url.search}` } });
			}
			if (pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}
		const micrositeCanonical = '/docs/propertylist-mls-user-manual/microsite-share/';
		if (pathname === micrositeCanonical || pathname === micrositeCanonical.slice(0, -1)) {
			return next();
		}
		const techDocCanonical = '/docs/propertylist-mls-user-manual/technical-documentation/';
		if (pathname === techDocCanonical || pathname === techDocCanonical.slice(0, -1)) {
			return next();
		}
		const techDocAliases: Array<{ from: string; to: string }> = [
			{ from: '/docs/propertylist-mls-user-manual/integrations/technical-documentation/', to: techDocCanonical },
			{ from: '/docs/propertylist-mls-user-manual/additional-resources/technical-documentation/', to: techDocCanonical },
		];
		for (const r of techDocAliases) {
			if (pathname.startsWith(r.from)) {
				const rest = pathname.slice(r.from.length);
				return new Response(null, { status: 301, headers: { Location: `${r.to}${rest}${url.search}` } });
			}
			if (pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}
		const micrositeAliases: Array<{ from: string; to: string }> = [
			{ from: '/docs/propertylist-mls-user-manual/microsite-share-properties-listings/', to: micrositeCanonical },
			{ from: '/docs/propertylist-mls-user-manual/marketing/microsite-share/', to: micrositeCanonical },
			{ from: '/docs/propertylist-mls-user-manual/managing-your-leads/microsite-share/', to: micrositeCanonical },
		];
		for (const r of micrositeAliases) {
			if (pathname.startsWith(r.from)) {
				const rest = pathname.slice(r.from.length);
				return new Response(null, { status: 301, headers: { Location: `${r.to}${rest}${url.search}` } });
			}
			if (pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		const marketingEsAliases: Array<{ from: string; to: string }> = [
			{ from: '/es/features/', to: '/es/funciones/' },
			{ from: '/es/pricing/', to: '/es/precios/' },
			{ from: '/es/website-builder/', to: '/es/constructor-de-webs/' },
			{ from: '/es/rentals/', to: '/es/alquileres/' },
			{ from: '/es/developers/', to: '/es/promotores/' },
			{ from: '/es/faq/', to: '/es/preguntas-frecuentes/' },
			{ from: '/es/verify-your-agency/', to: '/es/verifica-tu-agencia/' },
		];
		for (const r of marketingEsAliases) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		if (pathname.startsWith('/neighbourhood/')) {
			const parts = pathname.split('/').filter(Boolean);
			const areaSlug =
				parts.length === 2 && parts[1] && parts[1] !== 'andalucia' && parts[1] !== 'spain'
					? parts[1]
					: parts.length === 4
						? parts[3] || ''
						: '';
			if (areaSlug) {
				const canon = canonicalAreaPath(areaSlug);
				if (`/${parts.join('/')}/` !== canon) {
					return new Response(null, { status: 301, headers: { Location: `${canon}${url.search}` } });
				}
			}
			if (!pathname.endsWith('/') && parts.length >= 2) {
				return new Response(null, { status: 301, headers: { Location: `/${parts.join('/')}/${url.search}` } });
			}
		}

		const dynamicRedirect = await resolveRedirect(pathname).catch(() => '');
		if (dynamicRedirect) {
			return new Response(null, { status: 301, headers: { Location: `${dynamicRedirect}${url.search}` } });
		}

		// The German pilot's seven pages, deleted 05-08-26. They answered 404,
		// which reads to a crawler as "maybe it comes back" and keeps them in the
		// recrawl queue; 410 is the honest answer and retires them. Listed one by
		// one rather than as a /de/ prefix, because German is a live site language
		// again and a prefix rule would take the new pages down with them.
		const DE_PILOT_GONE = new Set([
			'/de/',
			'/de/immobilie-in-spanien-kaufen/',
			'/de/immobilienbetrug-in-spanien-vermeiden/',
			'/de/gebiete/elviria/',
			'/de/gebiete/golden-mile/',
			'/de/gebiete/la-cala-de-mijas/',
			'/de/gebiete/los-monteros/',
			'/de/gebiete/puerto-banus/',
		]);
		{
			const p = pathname.endsWith('/') ? pathname : pathname + '/';
			if (DE_PILOT_GONE.has(p)) {
				return new Response('Gone', { status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' } });
			}
		}

		// Blog redirects - duplicate/filler posts → canonical versions
		const blogRedirects: Array<{ from: string; to: string }> = [
			{ from: '/blog/rdl-8-2026-rent-cap-extension-explained/', to: '/blog/spain-rent-cap-law-rdl-8-2026-landlord-guide/' },
		];
		for (const r of blogRedirects) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		// Legacy WordPress video page -> the real video guides (it still said COMING SOON)
		if (pathname === '/propertylist-video-tutorials/' || pathname === '/propertylist-video-tutorials') {
			return new Response(null, { status: 301, headers: { Location: `/video-guides/${url.search}` } });
		}

		// Removed page /mls/ -> moved to the agents app (property sharing)
		const externalRedirects: Array<{ from: string; to: string }> = [
			{ from: '/mls/', to: 'https://agents.propertylist.es/' },
			{ from: '/es/mls/', to: 'https://agents.propertylist.es/' },
		];
		for (const r of externalRedirects) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: r.to } });
			}
		}

		// Legacy/fallback ES aliases: an EN slug under /es/ -> its canonical localized ES page.
		// Defensive net so a stale or proxied EN page whose language switcher still builds
		// `/es`+path (e.g. /es/instant-listing/) lands on the real Spanish page, not a 404.
		const esAliasRedirects: Array<{ from: string; to: string }> = [
			{ from: '/es/instant-listing/', to: '/es/listado-instantaneo/' },
			{ from: '/es/instant-renovation/', to: '/es/renovacion-instantanea/' },
			{ from: '/es/instant-content/', to: '/es/contenido-instantaneo/' },
			{ from: '/es/instant-brochure/', to: '/es/folleto-instantaneo/' },
			{ from: '/es/instant-video/', to: '/es/video-instantaneo/' },
			{ from: '/es/instant-images/', to: '/es/imagenes-instantaneas/' },
			{ from: '/es/mobile-app/', to: '/es/app-movil/' },
		];
		for (const r of esAliasRedirects) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		// WordPress-era archive URLs. None of these routes were rebuilt on Astro, so
		// every one was a 404 that still carried inbound links and internal links from
		// the imported article bodies. Category archives go to the blog index in their
		// own language, date archives to the blog index, and nightlife to the events
		// hub that replaced it. Handled here rather than in the trailing-slash block
		// below so the slashless form redirects once instead of chaining.
		// /nightlife/ is matched exactly: /nightlife/best-nightlife-in-marbella/ is a
		// real published post and must keep working.
		{
			const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
			const legacyArchiveTarget =
				p === '/nightlife/' || p === '/category/nightlife/'
					? '/whats-on/'
					: p.startsWith('/es/categoria/') || p.startsWith('/categoria/')
						? '/es/blog/'
						: p.startsWith('/category/')
							? '/blog/'
							: /^\/es\/20\d\d\/\d{2}\/\d{2}\//.test(p)
								? '/es/blog/'
								: /^\/20\d\d\/\d{2}\/\d{2}\//.test(p)
									? '/blog/'
									: '';
			if (legacyArchiveTarget) {
				return new Response(null, { status: 301, headers: { Location: `${legacyArchiveTarget}${url.search}` } });
			}
		}

		const prefixRedirects: Array<{ from: string; to: string }> = [
			{ from: '/docs/propertylist-mls-user-manual/mls-user-manual/', to: '/docs/propertylist-mls-user-manual/your-account/' },
			{ from: '/docs/propertylist-mls-user-manual/how-to-use-contacts/', to: '/docs/propertylist-mls-user-manual/contacts/' },
			{ from: '/docs/propertylist-mls-user-manual/additional-resources/', to: '/docs/propertylist-mls-user-manual/support/' },
			{ from: '/docs/propertylist-mls-user-manual/export-listings/', to: '/docs/propertylist-mls-user-manual/integrations/export-listings/' },
			{ from: '/docs/propertylist-mls-user-manual/integrations/listings/', to: '/docs/propertylist-mls-user-manual/integrations/export-listings/' },
			{ from: '/docs/propertylist-mls-user-manual/integrations/technical-documentation/', to: '/docs/propertylist-mls-user-manual/technical-documentation/' },
			{ from: '/docs/propertylist-mls-user-manual/ai-ezd_ampersand-automation/', to: '/docs/propertylist-mls-user-manual/ai-automation/' },
			{
				from: '/docs/propertylist-mls-user-manual/core-workflow/creating-a-new-listing/',
				to: '/docs/propertylist-mls-user-manual/core-workflow/listing-a-property/',
			},
			{
				from: '/docs/propertylist-mls-user-manual/reports-and-statistics/',
				to: '/docs/propertylist-mls-user-manual/reports-statistics/',
			},
			{
				from: '/docs/propertylist-mls-user-manual/marketing-and-promotion/feature-your-property-on-the-public-property-portal/',
				to: '/docs/propertylist-mls-user-manual/marketing-and-portals/feature-your-property-on-the-public-property-portal/',
			},
			{
				from: '/docs/propertylist-mls-user-manual/technical-docs/technical-documentation/',
				to: '/docs/propertylist-mls-user-manual/technical-documentation/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/marketing-and-promotion/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/marketing-and-portals/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/ai-ezd_ampersand-automation/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/ai-automation/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/technical-docs/technical-documentation/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/technical-documentation/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/getting-started/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/empezar/',
			},
			{
				from: '/es/docs/leyes-procedimientos/obtaining-permits-and-approvals/',
				to: '/es/docs/leyes-procedimientos/building-a-property/obtaining-permits-and-approvals/',
			},
			{
				from: '/es/docs/leyes-procedimientos/construction-and-completion/',
				to: '/es/docs/leyes-procedimientos/building-a-property/construction-and-completion/',
			},
			{
				from: '/es/docs/leyes-procedimientos/planning-and-design/',
				to: '/es/docs/leyes-procedimientos/building-a-property/planning-and-design/',
			},
			{
				from: '/es/docs/leyes-procedimientos/inheritance-tax-impuesto-sobre-sucesiones-y-donaciones/',
				to: '/es/docs/leyes-procedimientos/inheritance-laws-in-andalucia/inheritance-tax-impuesto-sobre-sucesiones-y-donaciones/',
			},
			{
				from: '/es/docs/leyes-procedimientos/forced-heirship-rules-legitima/',
				to: '/es/docs/leyes-procedimientos/inheritance-laws-in-andalucia/forced-heirship-rules-legitima/',
			},
			{
				from: '/es/docs/leyes-procedimientos/intestate-succession-intestacy/',
				to: '/es/docs/leyes-procedimientos/inheritance-laws-in-andalucia/intestate-succession-intestacy/',
			},
			{
				from: '/es/docs/leyes-procedimientos/wills-and-testaments/',
				to: '/es/docs/leyes-procedimientos/inheritance-laws-in-andalucia/wills-and-testaments/',
			},
			{
				from: '/es/docs/leyes-procedimientos/impuesto-sobre-transmisiones-patrimoniales-itp/',
				to: '/es/docs/leyes-procedimientos/property-taxes-in-andalucia/impuesto-sobre-transmisiones-patrimoniales-itp/',
			},
			{
				from: '/es/docs/leyes-procedimientos/impuesto-sobre-bienes-inmuebles-ibi/',
				to: '/es/docs/leyes-procedimientos/property-taxes-in-andalucia/impuesto-sobre-bienes-inmuebles-ibi/',
			},
			{
				from: '/es/docs/leyes-procedimientos/impuesto-sobre-construcciones-instalaciones-y-obras-icio/',
				to: '/es/docs/leyes-procedimientos/property-taxes-in-andalucia/impuesto-sobre-construcciones-instalaciones-y-obras-icio/',
			},
			{
				from: '/es/docs/leyes-procedimientos/impuesto-sobre-el-valor-anadido-iva/',
				to: '/es/docs/leyes-procedimientos/property-taxes-in-andalucia/impuesto-sobre-el-valor-anadido-iva/',
			},
			{
				from: '/es/docs/leyes-procedimientos/long-term/',
				to: '/es/docs/leyes-procedimientos/renting-a-property/long-term/',
			},
			{
				from: '/es/docs/leyes-procedimientos/short-term-holiday/',
				to: '/es/docs/leyes-procedimientos/renting-a-property/short-term-holiday/',
			},
			{
				from: '/es/docs/leyes-procedimientos/landlords/',
				to: '/es/docs/leyes-procedimientos/renting-a-property/landlords/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/core-workflow/creating-a-new-listing/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/core-workflow/listing-a-property/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/additional-resources/mls-support/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/support/mls-support/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/integrations/technical-documentation/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/technical-documentation/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/new-page/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/marketing-and-portals/sharing-listings-social-media/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/microsite/sharing-listings-social-media/',
			},
			{
				from: '/es/docs/propertylist-mls-manual-de-usuario/sales-pipeline-tracking/how-to-use-pipeline/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/sales-pipeline-tracking/',
			},
		];
		for (const r of prefixRedirects) {
			if (pathname.startsWith(r.from)) {
				const rest = pathname.slice(r.from.length);
				return new Response(null, { status: 301, headers: { Location: `${r.to}${rest}${url.search}` } });
			}
			if (pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		const esPrefixRedirects: Array<{ from: string; to: string }> = [
			{ from: '/es/docs/propertylist-mls-user-manual/mls-user-manual/', to: '/es/docs/propertylist-mls-manual-de-usuario/your-account/' },
			{ from: '/es/docs/propertylist-mls-user-manual/how-to-use-contacts/', to: '/es/docs/propertylist-mls-manual-de-usuario/contacts/' },
			{ from: '/es/docs/propertylist-mls-user-manual/additional-resources/', to: '/es/docs/propertylist-mls-manual-de-usuario/support/' },
			{
				from: '/es/docs/propertylist-mls-user-manual/export-listings/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/',
			},
			{
				from: '/es/docs/propertylist-mls-user-manual/integrations/listings/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/',
			},
			{
				from: '/es/docs/propertylist-mls-user-manual/integrations/technical-documentation/',
				to: '/es/docs/propertylist-mls-manual-de-usuario/technical-documentation/',
			},
			{ from: '/es/docs/propertylist-mls-user-manual/ai-ezd_ampersand-automation/', to: '/es/docs/propertylist-mls-manual-de-usuario/ai-and-automation/' },
		];
		for (const r of esPrefixRedirects) {
			if (pathname.startsWith(r.from)) {
				const rest = pathname.slice(r.from.length);
				return new Response(null, { status: 301, headers: { Location: `${r.to}${rest}${url.search}` } });
			}
			if (pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
		}

		if (pathname === '/docs/propertylist-mls-user-manual/additional-resources/contacting-propertylist-mls-support/' || pathname === '/docs/propertylist-mls-user-manual/additional-resources/contacting-propertylist-mls-support') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/support/mls-support/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/your-account/managing-user-permissions-and-access-levels/' || pathname === '/docs/propertylist-mls-user-manual/your-account/managing-user-permissions-and-access-levels') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/your-account/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/searching-for-properties/save-your-search/' || pathname === '/docs/propertylist-mls-user-manual/searching-for-properties/save-your-search') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/search/filters/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/pipeline-tracking/' || pathname === '/docs/propertylist-mls-user-manual/pipeline-tracking') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/pipeline/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-advanced-user-manual/how-to-use-the-calendar/' || pathname === '/docs/propertylist-advanced-user-manual/how-to-use-the-calendar') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/calendar/${url.search}` },
			});
		}
		if (pathname === '/docs/property-portal-manual/reports-and-statistics/' || pathname === '/docs/property-portal-manual/reports-and-statistics') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/reports/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/search/' || pathname === '/docs/propertylist-mls-user-manual/search') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/search/filters/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/integrations/' || pathname === '/docs/propertylist-mls-user-manual/integrations') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/integrations/export-listings/' || pathname === '/docs/propertylist-mls-user-manual/integrations/export-listings') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/listings/export-listings-xml/' || pathname === '/docs/propertylist-mls-user-manual/listings/export-listings-xml') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/docs/laws-procedures/traspaso-business-transfer/additional-considerations/contractual-obligations/' || pathname === '/docs/laws-procedures/traspaso-business-transfer/additional-considerations/contractual-obligations') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/laws-procedures/traspaso-business-transfer/additional-considerations/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/search/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/search') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/search/filters/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/listings/export-listings-xml/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/listings/export-listings-xml') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/wp-plugin-customisable/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/wp-plugin-customisable') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/managing-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/leyes-procedimientos/traspaso-business-transfer/additional-considerations/contractual-obligations/' || pathname === '/es/docs/leyes-procedimientos/traspaso-business-transfer/additional-considerations/contractual-obligations') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/leyes-procedimientos/traspaso-business-transfer/additional-considerations/${url.search}` },
			});
		}
		if (pathname.startsWith('/es/docs/laws-procedures/')) {
			const rest = pathname.slice('/es/docs/laws-procedures/'.length);
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/leyes-procedimientos/${rest}${url.search}` },
			});
		}
		if (pathname === '/es/docs/laws-procedures' || pathname === '/es/docs/laws-procedures/') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/leyes-procedimientos/${url.search}` },
			});
		}
		if (pathname.startsWith('/es/docs/propertylist-mls-user-manual/')) {
			const rest = pathname.slice('/es/docs/propertylist-mls-user-manual/'.length);
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/${rest}${url.search}` },
			});
		}
		if (pathname.startsWith('/docs/propertylist-mls-manual-de-usuario/')) {
			const rest = pathname.slice('/docs/propertylist-mls-manual-de-usuario/'.length);
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/${rest}${url.search}` },
			});
		}

		// Trailing-slash normalisation. Both /free and /free/ used to return 200, which split
		// the analytics for every page in half and gave search engines a duplicate of each
		// one. The canonical form is with the slash (that is what every canonical tag emits),
		// so send the bare form there once. This sits last so specific redirects win, and the
		// enclosing block is GET/HEAD only so form POSTs are never touched.
		const noSlashNormalise = ['/api/', '/assets/', '/_astro/', '/_image', '/docs-images/', '/area-images/', '/img/'];
		if (
			pathname !== '/' &&
			!pathname.endsWith('/') &&
			!/\.[a-z0-9]{2,6}$/i.test(pathname) &&
			!noSlashNormalise.some((p) => pathname.startsWith(p))
		) {
			return new Response(null, { status: 301, headers: { Location: `${pathname}/${url.search}` } });
		}
	}
	if (pathname.startsWith('/assets/')) {
		const res = await fetch(`${directusUrl()}${pathname}${url.search}`, {
			method: context.request.method,
			headers: (() => {
				const h = new Headers();
				const accept = context.request.headers.get('accept');
				if (accept) h.set('accept', accept);
				const range = context.request.headers.get('range');
				if (range) h.set('range', range);
				const ifNoneMatch = context.request.headers.get('if-none-match');
				if (ifNoneMatch) h.set('if-none-match', ifNoneMatch);
				const ifModifiedSince = context.request.headers.get('if-modified-since');
				if (ifModifiedSince) h.set('if-modified-since', ifModifiedSince);
				return h;
			})(),
		});
		const headers = new Headers(res.headers);
		headers.set('cache-control', headers.get('cache-control') || 'public, max-age=31536000, immutable');
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	}
	if (pathname === '/admin' || pathname.startsWith('/admin/')) {
		if (pathname === '/admin/login' || pathname === '/admin/login/') return next();
		const session = getAdminSessionFromRequest(context.request);
		if (!session) {
			return new Response(null, {
				status: 302,
				headers: { Location: '/admin/login' },
			});
		}
	}

	if (context.request.method === 'GET' && !pathname.startsWith('/api/')) {
		runPublishScheduler().catch(() => undefined);
		runAreaStatsScheduler().catch(() => undefined);
		runNeighbourhoodStatsScheduler({
			keyHint: pathname.startsWith('/neighbourhood/') || pathname.startsWith('/es/barrios/') ? pathname : '',
			minIntervalMs: pathname.startsWith('/neighbourhood/') || pathname.startsWith('/es/barrios/') ? 0 : undefined,
		}).catch(() => undefined);
	}

	const response = await next();
	// HTML documents: force revalidation so content/URL fixes always reach returning
	// visitors instead of being masked by heuristic browser caching (e.g. a stale language
	// switcher link pointing at a now-404 path). SSR HTML otherwise ships with no cache-control.
	if (
		context.request.method === 'GET' &&
		(response.headers.get('content-type') || '').includes('text/html') &&
		!response.headers.get('cache-control')
	) {
		try { response.headers.set('cache-control', 'no-cache'); } catch {}
	}
	if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
		const headers = new Headers(response.headers);
		headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
		headers.set('pragma', 'no-cache');
		headers.set('expires', '0');
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
	if (
		context.request.method === 'GET' &&
		response.status === 200 &&
		(pathname.startsWith('/es/docs/') || pathname.startsWith('/es/barrios/')) &&
		(response.headers.get('content-type') || '').includes('text/html')
	) {
		const html = await response.text();
		const headers = new Headers(response.headers);
		if (/class="badge"[^>]*>\s*404\s*</.test(html)) {
			return new Response(html, { status: 404, statusText: 'Not Found', headers });
		}
		try {
			if (pathname.startsWith('/es/docs/') && pathname !== '/es/docs/') await rec(pathname);
			if (pathname.startsWith('/es/barrios/')) {
				const parts = pathname.split('/').filter(Boolean);
				if (parts.length === 3) await rec(pathname);
			}
		} catch {}
		return new Response(html, { status: 200, headers });
	}
	try {
		if (context.request.method !== 'GET') return response;
		if (response.status < 200 || response.status >= 300) return response;

		const accept = context.request.headers.get('accept') || '';
		if (!accept.includes('text/html')) return response;

		if (pathname === '/docs/' || pathname === '/es/docs/') return response;
		if (pathname.startsWith('/docs/') || pathname.startsWith('/es/docs/')) {
			await rec(pathname);
		}
		if (pathname !== '/blog/' && pathname.startsWith('/blog/')) {
			await rec(pathname);
		}
		if (pathname !== '/general-information/' && pathname.startsWith('/general-information/')) {
			await rec(pathname);
		}
		if (pathname === '/whats-on/' || pathname.startsWith('/whats-on/')) {
			await rec(pathname);
		}
		if (pathname === '/es/que-hacer/' || pathname.startsWith('/es/que-hacer/')) {
			await rec(pathname);
		}
		if (pathname !== '/es/informacion-general/' && pathname.startsWith('/es/informacion-general/')) {
			await rec(pathname);
		}
		if (pathname.startsWith('/neighbourhood/')) {
			const parts = pathname.split('/').filter(Boolean);
			const isLegacyGuide = parts.length === 2 && parts[0] === 'neighbourhood' && parts[1] !== 'andalucia' && parts[1] !== 'spain';
			const isCanonicalGuide = parts.length === 4 && parts[0] === 'neighbourhood' && (parts[1] === 'andalucia' || parts[1] === 'spain');
			if (isLegacyGuide || isCanonicalGuide) await rec(pathname);
		}
		if (pathname.startsWith('/es/barrios/')) {
			const parts = pathname.split('/').filter(Boolean);
			if (parts.length === 3) await rec(pathname);
		}
	} catch {
		return response;
	}
	return response;
});


function videoGateHtml(es: boolean, wrong: boolean, action: string): string {
	const t = (en: string, esx: string) => (es ? esx : en);
	return `<!doctype html>
<html lang="${es ? 'es' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${t('Private preview', 'Vista previa privada')} | PropertyList</title>
<style>
:root { color-scheme: light }
* { box-sizing: border-box }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:#f6f8fc; color:#0b1220; font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif }
.card { width:100%; max-width:420px; background:#fff; border:1px solid rgba(11,18,32,.1); border-radius:18px; padding:28px 26px; box-shadow:0 18px 44px -20px rgba(11,18,32,.35); text-align:center }
img { height:34px; margin-bottom:18px }
h1 { font-size:20px; margin:0 0 8px; letter-spacing:-.02em }
p { margin:0 0 18px; font-size:14.5px; line-height:1.5; color:rgba(16,24,40,.65) }
form { display:flex; gap:8px }
input { flex:1; min-width:0; padding:12px 14px; font-size:15px; border:1px solid rgba(11,18,32,.16); border-radius:12px; font-family:inherit }
input:focus { outline:2px solid rgba(0,174,154,.4); outline-offset:1px; border-color:#00ae9a }
button { flex:none; padding:12px 18px; font-size:15px; font-weight:800; color:#fff; background:#0a6d61; border:0; border-radius:12px; cursor:pointer; font-family:inherit }
button:hover { background:#086055 }
.err { margin:14px 0 0; font-size:13.5px; color:#b42318; font-weight:600 }
.back { display:inline-block; margin-top:20px; font-size:13px; color:rgba(16,24,40,.55); text-decoration:none }
.back:hover { text-decoration:underline }
</style>
</head>
<body>
<main class="card">
<img src="https://info.propertylist.es/email-images/originals/email-logo-main-for-light-bk.png" alt="PropertyList" />
<h1>${t('Private preview', 'Vista previa privada')}</h1>
<p>${t('This page is still being finished. Enter the password to take a look.', 'Esta página aún se está terminando. Introduce la contraseña para verla.')}</p>
<form method="post" action="${action}/">
<input type="password" name="pw" autocomplete="current-password" autofocus placeholder="${t('Password', 'Contraseña')}" aria-label="${t('Password', 'Contraseña')}" />
<button type="submit">${t('Enter', 'Entrar')}</button>
</form>
${wrong ? `<p class="err">${t('That password did not work. Try again.', 'Esa contraseña no funciona. Inténtalo de nuevo.')}</p>` : ''}
<a class="back" href="${es ? '/es/' : '/'}">${t('Back to PropertyList', 'Volver a PropertyList')}</a>
</main>
</body>
</html>`;
}
