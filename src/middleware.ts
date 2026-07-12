import { defineMiddleware } from 'astro/middleware';
import { canonicalAreaPath } from './lib/areaProvince';
import { recordWeeklyView } from './lib/weeklyViews';
import { recordEvent } from './lib/eventStats';
import { getAdminSessionFromRequest } from './lib/adminAuth';
import { runAreaStatsScheduler, runNeighbourhoodStatsScheduler, runPublishScheduler } from './lib/adminScheduler';
import { resolveRedirect } from './lib/kbRedirects';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;
const directusUrl = () => (readEnv('DIRECTUS_URL') || 'http://127.0.0.1:8055').replace(/\/+$/g, '');

export const onRequest = defineMiddleware(async (context, next) => {
	try {
		const ua = context.request.headers.get('user-agent') || '';
		const bot = /GPTBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Bytespider|meta-externalagent|Applebot-Extended/i.exec(ua);
		if (bot) recordEvent(`bot:${bot[0]}`, context.url.pathname).catch(() => undefined);
	} catch {}

	const url = new URL(context.request.url);
	const pathname = url.pathname;
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

		// Blog redirects — duplicate/filler posts → canonical versions
		const blogRedirects: Array<{ from: string; to: string }> = [
			{ from: '/blog/rdl-8-2026-rent-cap-extension-explained/', to: '/blog/spain-rent-cap-law-rdl-8-2026-landlord-guide/' },
		];
		for (const r of blogRedirects) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
			}
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
			{ from: '/es/mobile-app/', to: '/es/app-movil/' },
		];
		for (const r of esAliasRedirects) {
			if (pathname === r.from || pathname === r.from.slice(0, -1)) {
				return new Response(null, { status: 301, headers: { Location: `${r.to}${url.search}` } });
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
				headers: { Location: `/docs/propertylist-mls-user-manual/integrations/export-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/integrations/export-listings/' || pathname === '/docs/propertylist-mls-user-manual/integrations/export-listings') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/integrations/export-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/docs/propertylist-mls-user-manual/listings/export-listings-xml/' || pathname === '/docs/propertylist-mls-user-manual/listings/export-listings-xml') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/docs/propertylist-mls-user-manual/integrations/export-listings/export-listings-xml/${url.search}` },
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
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/listings/export-listings-xml/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/listings/export-listings-xml') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/export-listings-xml/${url.search}` },
			});
		}
		if (pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/wp-plugin-customisable/' || pathname === '/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/wp-plugin-customisable') {
			return new Response(null, {
				status: 301,
				headers: { Location: `/es/docs/propertylist-mls-manual-de-usuario/integrations/export-listings/export-listings-xml/${url.search}` },
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
		if (html.includes('class="badge">404<')) {
			return new Response(html, { status: 404, statusText: 'Not Found', headers });
		}
		try {
			if (pathname.startsWith('/es/docs/') && pathname !== '/es/docs/') await recordWeeklyView(pathname);
			if (pathname.startsWith('/es/barrios/')) {
				const parts = pathname.split('/').filter(Boolean);
				if (parts.length === 3) await recordWeeklyView(pathname);
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
			await recordWeeklyView(pathname);
		}
		if (pathname !== '/blog/' && pathname.startsWith('/blog/')) {
			await recordWeeklyView(pathname);
		}
		if (pathname !== '/general-information/' && pathname.startsWith('/general-information/')) {
			await recordWeeklyView(pathname);
		}
		if (pathname === '/whats-on/' || pathname.startsWith('/whats-on/')) {
			await recordWeeklyView(pathname);
		}
		if (pathname === '/es/que-hacer/' || pathname.startsWith('/es/que-hacer/')) {
			await recordWeeklyView(pathname);
		}
		if (pathname !== '/es/informacion-general/' && pathname.startsWith('/es/informacion-general/')) {
			await recordWeeklyView(pathname);
		}
		if (pathname.startsWith('/neighbourhood/')) {
			const parts = pathname.split('/').filter(Boolean);
			const isLegacyGuide = parts.length === 2 && parts[0] === 'neighbourhood' && parts[1] !== 'andalucia' && parts[1] !== 'spain';
			const isCanonicalGuide = parts.length === 4 && parts[0] === 'neighbourhood' && (parts[1] === 'andalucia' || parts[1] === 'spain');
			if (isLegacyGuide || isCanonicalGuide) await recordWeeklyView(pathname);
		}
		if (pathname.startsWith('/es/barrios/')) {
			const parts = pathname.split('/').filter(Boolean);
			if (parts.length === 3) await recordWeeklyView(pathname);
		}
	} catch {
		return response;
	}
	return response;
});
