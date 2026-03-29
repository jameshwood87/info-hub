import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf } from '../../../../lib/adminAuth';
import { getKbMeta, setKbMeta } from '../../../../lib/adminMeta';
import { writeAudit } from '../../../../lib/adminContent';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ request, params, clientAddress }) => {
	const session = assertAdmin(request);
	const id = String(params.id || '');
	const meta = await getKbMeta(id);
	await writeAudit({
		action: 'kb_meta.get',
		userId: session.userId,
		kbPageId: id,
		ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
	}).catch(() => undefined);
	return json(200, { ok: true, meta });
};

export const PATCH: APIRoute = async ({ request, params, clientAddress }) => {
	const session = assertAdmin(request);
	assertCsrf(request, session);
	const id = String(params.id || '');

	let body: any = null;
	try {
		body = await request.json();
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	const tagsRaw = body?.tags;
	const tags =
		Array.isArray(tagsRaw) && tagsRaw.length
			? tagsRaw
					.map((t: any) => String(t || '').trim())
					.filter(Boolean)
					.slice(0, 40)
			: Array.isArray(tagsRaw)
				? []
				: undefined;

	const featuredImageUrl =
		body?.featuredImageUrl === null ? null : typeof body?.featuredImageUrl === 'string' ? String(body.featuredImageUrl).trim() : undefined;

	const featuredImageAlt =
		body?.featuredImageAlt === null ? null : typeof body?.featuredImageAlt === 'string' ? String(body.featuredImageAlt).trim() : undefined;

	const featuredImageTitle =
		body?.featuredImageTitle === null ? null : typeof body?.featuredImageTitle === 'string' ? String(body.featuredImageTitle).trim() : undefined;

	const featuredImageCaption =
		body?.featuredImageCaption === null
			? null
			: typeof body?.featuredImageCaption === 'string'
				? String(body.featuredImageCaption).trim()
				: undefined;

	const featuredImageCredit =
		body?.featuredImageCredit === null ? null : typeof body?.featuredImageCredit === 'string' ? String(body.featuredImageCredit).trim() : undefined;

	const scheduledAt = body?.scheduledAt === null ? null : typeof body?.scheduledAt === 'string' ? String(body.scheduledAt).trim() : undefined;
	if (typeof scheduledAt === 'string' && scheduledAt) {
		const ms = Date.parse(scheduledAt);
		if (!Number.isFinite(ms)) return json(400, { ok: false, error: 'invalid_scheduledAt' });
	}

	const docCategoryRaw = body?.docCategory;
	let docCategory =
		docCategoryRaw === null ? null : typeof docCategoryRaw === 'string' ? String(docCategoryRaw).trim() : undefined;
	if (typeof docCategory === 'string') {
		if (!docCategory) docCategory = null;
		else if (!['estate-agent', 'developer', 'property-service', 'public'].includes(docCategory)) {
			return json(400, { ok: false, error: 'invalid_docCategory' });
		}
	}

	const docCategoriesRaw = body?.docCategories;
	const docCategories =
		docCategoriesRaw === null
			? null
			: Array.isArray(docCategoriesRaw)
				? Array.from(
						new Set(
							docCategoriesRaw
								.map((v: any) => String(v || '').trim())
								.filter((v: string) => ['estate-agent', 'developer', 'property-service', 'public'].includes(v))
						)
					)
				: undefined;

	const areaStatsRaw = body?.areaStats ?? body?.area_stats;
	const areaStats =
		areaStatsRaw === null
			? null
			: areaStatsRaw && typeof areaStatsRaw === 'object'
				? {
						avgPrice: typeof (areaStatsRaw as any).avgPrice === 'number' ? (areaStatsRaw as any).avgPrice : undefined,
						rentalYield: typeof (areaStatsRaw as any).rentalYield === 'number' ? (areaStatsRaw as any).rentalYield : undefined,
						airportDistance: typeof (areaStatsRaw as any).airportDistance === 'number' ? (areaStatsRaw as any).airportDistance : undefined,
						beachDistance: typeof (areaStatsRaw as any).beachDistance === 'number' ? (areaStatsRaw as any).beachDistance : undefined,
						priceTrend: typeof (areaStatsRaw as any).priceTrend === 'string' ? String((areaStatsRaw as any).priceTrend).trim() || undefined : undefined,
						population: typeof (areaStatsRaw as any).population === 'number' ? (areaStatsRaw as any).population : undefined,
						expatPercent: typeof (areaStatsRaw as any).expatPercent === 'number' ? (areaStatsRaw as any).expatPercent : undefined,
						daysOnMarket: typeof (areaStatsRaw as any).daysOnMarket === 'number' ? (areaStatsRaw as any).daysOnMarket : undefined,
						listingCount: typeof (areaStatsRaw as any).listingCount === 'number' ? (areaStatsRaw as any).listingCount : undefined,
				  }
				: undefined;

	const areaStatsUpdatedAt =
		body?.areaStatsUpdatedAt === null
			? null
			: typeof body?.areaStatsUpdatedAt === 'string'
				? String(body.areaStatsUpdatedAt).trim()
				: undefined;
	if (typeof areaStatsUpdatedAt === 'string' && areaStatsUpdatedAt) {
		const ms = Date.parse(areaStatsUpdatedAt);
		if (!Number.isFinite(ms)) return json(400, { ok: false, error: 'invalid_areaStatsUpdatedAt' });
	}

	const areaStatsDueAt =
		body?.areaStatsDueAt === null ? null : typeof body?.areaStatsDueAt === 'string' ? String(body.areaStatsDueAt).trim() : undefined;
	if (typeof areaStatsDueAt === 'string' && areaStatsDueAt) {
		const ms = Date.parse(areaStatsDueAt);
		if (!Number.isFinite(ms)) return json(400, { ok: false, error: 'invalid_areaStatsDueAt' });
	}

	const areaFaqRaw = body?.areaFaq;
	const areaFaq =
		areaFaqRaw === null
			? null
			: Array.isArray(areaFaqRaw)
				? areaFaqRaw
						.map((f: any) => ({ q: String(f?.q || '').trim(), a: String(f?.a || '').trim() }))
						.filter((f: any) => f.q && f.a)
						.slice(0, 30)
				: undefined;

	const areaHeroRaw = body?.areaHeroImage;
	const areaHeroImage =
		areaHeroRaw === null
			? null
			: areaHeroRaw && typeof areaHeroRaw === 'object'
				? {
						url: typeof (areaHeroRaw as any).url === 'string' ? String((areaHeroRaw as any).url).trim() || null : undefined,
						alt: typeof (areaHeroRaw as any).alt === 'string' ? String((areaHeroRaw as any).alt).trim() || null : undefined,
						source: typeof (areaHeroRaw as any).source === 'string' ? String((areaHeroRaw as any).source).trim() || null : undefined,
						pageUrl: typeof (areaHeroRaw as any).pageUrl === 'string' ? String((areaHeroRaw as any).pageUrl).trim() || null : undefined,
						creditName: typeof (areaHeroRaw as any).creditName === 'string' ? String((areaHeroRaw as any).creditName).trim() || null : undefined,
						creditUrl: typeof (areaHeroRaw as any).creditUrl === 'string' ? String((areaHeroRaw as any).creditUrl).trim() || null : undefined,
						licenseName: typeof (areaHeroRaw as any).licenseName === 'string' ? String((areaHeroRaw as any).licenseName).trim() || null : undefined,
						licenseUrl: typeof (areaHeroRaw as any).licenseUrl === 'string' ? String((areaHeroRaw as any).licenseUrl).trim() || null : undefined,
				  }
				: undefined;

	const neighbourhoodStatsRaw = body?.neighbourhoodStats ?? body?.neighbourhood_stats;
	const neighbourhoodStats =
		neighbourhoodStatsRaw === null
			? null
			: neighbourhoodStatsRaw && typeof neighbourhoodStatsRaw === 'object'
				? {
						avgPriceEur: typeof (neighbourhoodStatsRaw as any).avgPriceEur === 'number' ? (neighbourhoodStatsRaw as any).avgPriceEur : undefined,
						rentalYieldPct:
							typeof (neighbourhoodStatsRaw as any).rentalYieldPct === 'number' ? (neighbourhoodStatsRaw as any).rentalYieldPct : undefined,
						airportDistanceKm:
							typeof (neighbourhoodStatsRaw as any).airportDistanceKm === 'number' ? (neighbourhoodStatsRaw as any).airportDistanceKm : undefined,
						beachDistanceKm:
							typeof (neighbourhoodStatsRaw as any).beachDistanceKm === 'number' ? (neighbourhoodStatsRaw as any).beachDistanceKm : undefined,
						priceTrend:
							typeof (neighbourhoodStatsRaw as any).priceTrend === 'string'
								? String((neighbourhoodStatsRaw as any).priceTrend).trim() || undefined
								: undefined,
						population: typeof (neighbourhoodStatsRaw as any).population === 'number' ? (neighbourhoodStatsRaw as any).population : undefined,
						expatPercent: typeof (neighbourhoodStatsRaw as any).expatPercent === 'number' ? (neighbourhoodStatsRaw as any).expatPercent : undefined,
						daysOnMarket: typeof (neighbourhoodStatsRaw as any).daysOnMarket === 'number' ? (neighbourhoodStatsRaw as any).daysOnMarket : undefined,
						listingCount: typeof (neighbourhoodStatsRaw as any).listingCount === 'number' ? (neighbourhoodStatsRaw as any).listingCount : undefined,
						recentAvgMaxC: typeof (neighbourhoodStatsRaw as any).recentAvgMaxC === 'number' ? (neighbourhoodStatsRaw as any).recentAvgMaxC : undefined,
						recentAvgMinC: typeof (neighbourhoodStatsRaw as any).recentAvgMinC === 'number' ? (neighbourhoodStatsRaw as any).recentAvgMinC : undefined,
						annualRainMm: typeof (neighbourhoodStatsRaw as any).annualRainMm === 'number' ? (neighbourhoodStatsRaw as any).annualRainMm : undefined,
				  }
				: undefined;

	const neighbourhoodStatsUpdatedAt =
		body?.neighbourhoodStatsUpdatedAt === null
			? null
			: typeof body?.neighbourhoodStatsUpdatedAt === 'string'
				? String(body.neighbourhoodStatsUpdatedAt).trim()
				: undefined;
	if (typeof neighbourhoodStatsUpdatedAt === 'string' && neighbourhoodStatsUpdatedAt) {
		const ms = Date.parse(neighbourhoodStatsUpdatedAt);
		if (!Number.isFinite(ms)) return json(400, { ok: false, error: 'invalid_neighbourhoodStatsUpdatedAt' });
	}

	const neighbourhoodStatsDueAt =
		body?.neighbourhoodStatsDueAt === null
			? null
			: typeof body?.neighbourhoodStatsDueAt === 'string'
				? String(body.neighbourhoodStatsDueAt).trim()
				: undefined;
	if (typeof neighbourhoodStatsDueAt === 'string' && neighbourhoodStatsDueAt) {
		const ms = Date.parse(neighbourhoodStatsDueAt);
		if (!Number.isFinite(ms)) return json(400, { ok: false, error: 'invalid_neighbourhoodStatsDueAt' });
	}

	const neighbourhoodFaqRaw = body?.neighbourhoodFaq;
	const neighbourhoodFaq =
		neighbourhoodFaqRaw === null
			? null
			: Array.isArray(neighbourhoodFaqRaw)
				? neighbourhoodFaqRaw
						.map((f: any) => ({ q: String(f?.q || '').trim(), a: String(f?.a || '').trim() }))
						.filter((f: any) => f.q && f.a)
						.slice(0, 40)
				: undefined;

	const neighbourhoodGeoRaw = body?.neighbourhoodGeo;
	const neighbourhoodGeo =
		neighbourhoodGeoRaw === null
			? null
			: neighbourhoodGeoRaw && typeof neighbourhoodGeoRaw === 'object'
				? {
						lat: typeof (neighbourhoodGeoRaw as any).lat === 'number' ? (neighbourhoodGeoRaw as any).lat : undefined,
						lon: typeof (neighbourhoodGeoRaw as any).lon === 'number' ? (neighbourhoodGeoRaw as any).lon : undefined,
						placeName:
							typeof (neighbourhoodGeoRaw as any).placeName === 'string' ? String((neighbourhoodGeoRaw as any).placeName).trim() || undefined : undefined,
						region: typeof (neighbourhoodGeoRaw as any).region === 'string' ? String((neighbourhoodGeoRaw as any).region).trim() || undefined : undefined,
						country: typeof (neighbourhoodGeoRaw as any).country === 'string' ? String((neighbourhoodGeoRaw as any).country).trim() || undefined : undefined,
				  }
				: undefined;

	const next = await setKbMeta(id, {
		tags,
		featuredImageUrl,
		featuredImageAlt,
		featuredImageTitle,
		featuredImageCaption,
		featuredImageCredit,
		scheduledAt,
		docCategory: docCategory as any,
		docCategories: docCategories ? (docCategories as any) : docCategories === null ? null : undefined,
		areaStats: areaStats as any,
		areaStatsUpdatedAt: areaStatsUpdatedAt as any,
		areaStatsDueAt: areaStatsDueAt as any,
		areaFaq: areaFaq as any,
		areaHeroImage: areaHeroImage as any,
		neighbourhoodStats: neighbourhoodStats as any,
		neighbourhoodStatsUpdatedAt: neighbourhoodStatsUpdatedAt as any,
		neighbourhoodStatsDueAt: neighbourhoodStatsDueAt as any,
		neighbourhoodFaq: neighbourhoodFaq as any,
		neighbourhoodGeo: neighbourhoodGeo as any,
	});
	await writeAudit({
		action: 'kb_meta.update',
		userId: session.userId,
		kbPageId: id,
		ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
		details: {
			tags,
			featuredImageUrl,
			featuredImageAlt,
			featuredImageTitle,
			featuredImageCaption,
			featuredImageCredit,
			scheduledAt,
			docCategory,
			docCategories,
			areaStats,
			areaStatsUpdatedAt,
			areaStatsDueAt,
			areaFaq,
			areaHeroImage,
			neighbourhoodStats,
			neighbourhoodStatsUpdatedAt,
			neighbourhoodStatsDueAt,
			neighbourhoodFaq,
			neighbourhoodGeo,
		},
	}).catch(() => undefined);
	return json(200, { ok: true, meta: next || {} });
};
