import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { assertAdmin } from '../../../../lib/adminAuth';
import { adminListKbPagesByPrefix } from '../../../../lib/directus';
import { canonicalAreaPath } from '../../../../lib/areaProvince';
import { getRecentViewCounts, getTotalViewCounts } from '../../../../lib/weeklyViews';
import { getEventTotals, getKindTotals } from '../../../../lib/eventStats';
import { gscPageMetrics, gscTopQueries, gscStriking } from '../../../../lib/gscClient';
import { ga4Summary, ga4PortalSummary } from '../../../../lib/ga4Client';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const BLOG_PREFIXES = ['/blog/', '/general-information/', '/estate-agents/', '/lifestyle/', '/food/', '/nightlife/'];
const AREA_PREFIXES = ['/neighbourhood/'];
const DOCS_PREFIXES = ['/docs/'];

const collect = async (prefixes: string[]) => {
	const items: Array<{ id: string; path: string; title: string }> = [];
	for (const prefix of prefixes) {
		let offset = 0;
		for (;;) {
			const batch: any[] = await adminListKbPagesByPrefix({ prefix, lang: 'en', status: 'published', limit: 200, offset }).catch(() => []);
			for (const it of batch) {
				const path = String(it?.path || '');
				if (!path || path === prefix) continue;
				items.push({ id: String(it?.id || ''), path, title: String(it?.title || '') });
			}
			if (batch.length < 200) break;
			offset += 200;
		}
	}
	return items;
};

const readJson = async (p: string) => {
	try {
		return JSON.parse(await fs.readFile(p, 'utf8'));
	} catch {
		return null;
	}
};

export const GET: APIRoute = async ({ request }) => {
	assertAdmin(request);
	const [blogPages, areaPages, docsPages] = await Promise.all([collect(BLOG_PREFIXES), collect(AREA_PREFIXES), collect(DOCS_PREFIXES)]);
	// Area kb_pages still hold legacy paths (/neighbourhood/{slug}/) while views, CTA and
	// Google data record under the canonical URL (/neighbourhood/spain/{province}/{slug}/),
	// and pre-migration history sits under /neighbourhood/andalucia/... - join across all three.
	const areaPagesCanon = areaPages.map((p) => {
		const parts = p.path.split('/').filter(Boolean);
		const slug = parts[parts.length - 1] || '';
		if (!slug || parts.length < 2) return { ...p, aliases: [p.path] };
		const canonical = canonicalAreaPath(slug);
		const aliases = Array.from(new Set([canonical, p.path, canonical.replace('/spain/', '/andalucia/')]));
		return { ...p, path: canonical, aliases };
	});
	const allPaths = [...blogPages, ...docsPages].map((p) => p.path).concat(areaPagesCanon.flatMap((p) => p.aliases));
	const [views, views7, gsc, topQueries, striking, ctaByPath, kindTotals, experiments, indexation, ga4, portal] = await Promise.all([
		getTotalViewCounts(allPaths).catch(() => ({} as Record<string, number>)),
		getRecentViewCounts(allPaths).catch(() => ({} as Record<string, number>)),
		gscPageMetrics(28),
		gscTopQueries(28, 25),
		gscStriking(28, 25),
		getEventTotals(28, 'cta:').catch(() => ({} as Record<string, Record<string, number>>)),
		getKindTotals(28).catch(() => ({} as Record<string, number>)),
		readJson('/opt/info-hub/var/admin/ctr-experiments.json'),
		readJson('/opt/info-hub/var/admin/indexation-report.json'),
		ga4Summary(28),
		ga4PortalSummary(28),
	]);

	const enrich = (pages: Array<{ id: string; path: string; title: string; aliases?: string[] }>) =>
		pages
			.map((p) => {
				const paths = p.aliases && p.aliases.length ? p.aliases : [p.path];
				let clicks = 0;
				let impressions = 0;
				let posNum = 0;
				let posDen = 0;
				for (const a of paths) {
					const g = gsc ? gsc[a] || gsc[a.replace(/\/$/, '')] || null : null;
					if (!g) continue;
					clicks += g.clicks || 0;
					impressions += g.impressions || 0;
					if (g.position) {
						posNum += g.position * Math.max(1, g.impressions || 0);
						posDen += Math.max(1, g.impressions || 0);
					}
				}
				const ctr = impressions ? clicks / impressions : 0;
				const position = posDen ? posNum / posDen : 0;
				const cta = paths.reduce((a, x) => a + Object.values(ctaByPath[x] || {}).reduce((s, n) => s + n, 0), 0);
				const pViews = paths.reduce((a, x) => a + (views[x] || 0), 0);
				const pViews7 = paths.reduce((a, x) => a + (views7[x] || 0), 0);
				const flags: string[] = [];
				if (impressions >= 20 && ctr < 0.015) flags.push('rewrite-title');
				if (position >= 8 && position <= 30 && impressions >= 5) flags.push('striking-distance');
				if (!impressions && !pViews7) flags.push('dormant');
				return {
					...p,
					views: pViews,
					views7: pViews7,
					cta,
					clicks,
					impressions,
					ctr: Math.round(ctr * 1000) / 10,
					position: Math.round(position * 10) / 10,
					flags,
				};
			})
			.sort((a, b) => b.impressions - a.impressions || b.views - a.views);

	const bots: Record<string, number> = {};
	for (const [k, n] of Object.entries(kindTotals)) if (k.startsWith('bot:')) bots[k.slice(4)] = n;

	return json(200, {
		ok: true,
		gscAvailable: Boolean(gsc),
		blogs: enrich(blogPages),
		areas: enrich(areaPagesCanon),
		docs: enrich(docsPages).slice(0, 100),
		topQueries: topQueries || [],
		striking: striking || [],
		bots,
		experiments: Array.isArray(experiments) ? experiments.slice(-20).reverse() : [],
		indexation: indexation || null,
		ga4: ga4 || null,
		portal: portal || null,
	});
};
