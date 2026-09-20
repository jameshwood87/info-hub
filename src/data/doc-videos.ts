// Manual pages that have a video guide covering the same ground, so the page can offer
// "prefer to watch?" above the text (James, 20-09-26).
//
// The two video pages are NOT twins: /video-guides/ has 15 English videos, /es/video-guias/
// has 7 Spanish ones with their own slugs. A Spanish page therefore only gets the bar when a
// SPANISH video exists; it never links a Spanish reader to an English video.
//
// Anchors come from the video pages themselves (id={`guide-${slug}`}), and titles and
// durations are copied from their guide lists. scripts/doc-videos-check.mjs fails if a
// mapped doc path or an anchor stops existing, so a rename cannot leave a dead link.

type Guide = { title: string; dur: string };

const EN_GUIDES: Record<string, Guide> = {
	dashboard: { title: 'Your dashboard', dur: '0:43' },
	'mls-search': { title: 'Search the MLS', dur: '0:46' },
	list: { title: 'List a property in minutes', dur: '0:32' },
	share: { title: 'Share a property', dur: '0:47' },
	feature: { title: 'Feature a listing', dur: '0:38' },
	refs: { title: 'Reference numbers', dur: '0:50' },
	intelligence: { title: 'Property Intelligence', dur: '1:23' },
	website: { title: 'Publish your website', dur: '0:54' },
	export: { title: 'Export your listings', dur: '0:41' },
	api: { title: 'The Website API', dur: '0:48' },
	'ai-match': { title: 'AI Property Match', dur: '0:29' },
	credits: { title: 'Earn credits with referrals', dur: '0:23' },
};

const ES_GUIDES: Record<string, Guide> = {
	overview: { title: 'Primeros pasos', dur: '0:29' },
	search: { title: 'Encuentra cualquier propiedad', dur: '0:26' },
	list: { title: 'Publica una propiedad en minutos', dur: '0:33' },
	'ai-match': { title: 'Búsqueda con IA', dur: '0:31' },
	credits: { title: 'Gana créditos con referidos', dur: '0:25' },
	feature: { title: 'Destaca un anuncio', dur: '0:39' },
	refs: { title: 'Números de referencia', dur: '0:51' },
};

const EN_MANUAL = '/docs/propertylist-mls-user-manual';
const ES_MANUAL = '/es/docs/propertylist-mls-manual-de-usuario';

const EN_PAGES: Record<string, string> = {
	[`${EN_MANUAL}/your-account/navigate-the-mls-dashboard-and-interface/`]: 'dashboard',
	[`${EN_MANUAL}/searching-and-alerts/`]: 'mls-search',
	[`${EN_MANUAL}/searching-and-alerts/filters/`]: 'mls-search',
	[`${EN_MANUAL}/core-workflow/listing-a-property/`]: 'list',
	[`${EN_MANUAL}/microsite/microsite-share/`]: 'share',
	[`${EN_MANUAL}/marketing-and-portals/feature-your-properties-on-the-mls/`]: 'feature',
	[`${EN_MANUAL}/managing-listings/reference-numbers/`]: 'refs',
	[`${EN_MANUAL}/reports-statistics/generating-property-reports/`]: 'intelligence',
	[`${EN_MANUAL}/website-builder/`]: 'website',
	[`${EN_MANUAL}/managing-listings/export-listings-xml/`]: 'export',
	[`${EN_MANUAL}/marketing-and-portals/sync-all-mls-properties-to-your-website/`]: 'api',
	[`${EN_MANUAL}/searching-and-alerts/ai-property-match/`]: 'ai-match',
	[`${EN_MANUAL}/credits/how-referrals-work/`]: 'credits',
	[`${EN_MANUAL}/credits/how-to-use-and-earn-credits/`]: 'credits',
};

const ES_PAGES: Record<string, string> = {
	[`${ES_MANUAL}/your-account/navigate-the-mls-dashboard-and-interface/`]: 'overview',
	[`${ES_MANUAL}/searching-and-alerts/`]: 'search',
	[`${ES_MANUAL}/searching-and-alerts/filters/`]: 'search',
	[`${ES_MANUAL}/core-workflow/listing-a-property/`]: 'list',
	[`${ES_MANUAL}/searching-and-alerts/ai-property-match/`]: 'ai-match',
	[`${ES_MANUAL}/credits/how-referrals-work/`]: 'credits',
	[`${ES_MANUAL}/credits/how-to-use-and-earn-credits/`]: 'credits',
	[`${ES_MANUAL}/marketing-and-portals/feature-your-properties-on-the-mls/`]: 'feature',
	[`${ES_MANUAL}/managing-listings/reference-numbers/`]: 'refs',
};

export type DocVideo = { href: string; lead: string; title: string; dur: string; label: string };

/** The video guide for a manual page, or null when there is none in that language. */
export function docVideoFor(path: string): DocVideo | null {
	const clean = (path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') + '/';
	const es = clean.startsWith('/es/');
	const slug = (es ? ES_PAGES : EN_PAGES)[clean];
	if (!slug) return null;
	const guide = (es ? ES_GUIDES : EN_GUIDES)[slug];
	if (!guide) return null;
	return {
		href: `${es ? '/es/video-guias/' : '/video-guides/'}#guide-${slug}`,
		lead: es ? '¿Prefieres verlo?' : 'Prefer to watch?',
		title: guide.title,
		dur: guide.dur,
		label: es ? `Ver el vídeo: ${guide.title}, ${guide.dur}` : `Watch the video: ${guide.title}, ${guide.dur}`,
	};
}

/** Every mapping, for scripts/doc-videos-check.mjs. */
export const DOC_VIDEO_PAGES = { en: EN_PAGES, es: ES_PAGES, enGuides: EN_GUIDES, esGuides: ES_GUIDES };
