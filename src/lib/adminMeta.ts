import fs from 'node:fs/promises';
import path from 'node:path';

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const ADMIN_DIR = path.join(VAR_DIR, 'admin');
const META_PATH = path.join(ADMIN_DIR, 'kb-meta.json');

export type AreaStats = {
	avgPrice?: number | null;
	priceTrend?: string | null;
	rentalYield?: number | null;
	airportDistance?: number | null;
	beachDistance?: number | null;
	population?: number | null;
	expatPercent?: number | null;
	daysOnMarket?: number | null;
	listingCount?: number | null;
};

export type AreaFaqItem = { q: string; a: string };

export type AreaHeroImage = {
	url?: string | null;
	alt?: string | null;
	source?: string | null;
	pageUrl?: string | null;
	creditName?: string | null;
	creditUrl?: string | null;
	licenseName?: string | null;
	licenseUrl?: string | null;
};

export type NeighbourhoodStats = {
	avgPriceEur?: number | null;
	priceTrend?: string | null;
	rentalYieldPct?: number | null;
	airportDistanceKm?: number | null;
	beachDistanceKm?: number | null;
	driveToMalagaAirportMin?: number | null;
	driveToMarbellaMin?: number | null;
	driveToPuertoBanusMin?: number | null;
	nearestBeachName?: string | null;
	driveToBeachMin?: number | null;
	pricePerM2Eur?: number | null;
	sampleSize?: number | null;
	priceMinEur?: number | null;
	priceMaxEur?: number | null;
	municipality?: string | null;
	topSubareas?: string[] | null;
	propertyTypeBreakdown?: Record<string, number> | null;
	population?: number | null;
	expatPercent?: number | null;
	daysOnMarket?: number | null;
	listingCount?: number | null;
	recentAvgMaxC?: number | null;
	recentAvgMinC?: number | null;
	annualRainMm?: number | null;
};

export type NeighbourhoodListing = {
	url: string;
	title: string;
	imageUrl?: string | null;
	priceEur?: number | null;
	bedrooms?: number | null;
	bathrooms?: number | null;
	buildM2?: number | null;
};

export type NeighbourhoodGeo = {
	lat?: number | null;
	lon?: number | null;
	placeName?: string | null;
	municipality?: string | null;
	region?: string | null;
	country?: string | null;
};

export type KbMeta = {
	version: 1;
	items: Record<
		string,
		{
			tags?: string[];
			featuredImageUrl?: string;
			featuredImageAlt?: string;
			featuredImageTitle?: string;
			featuredImageCaption?: string;
			featuredImageCredit?: string;
			scheduledAt?: string;
			docCategory?: 'estate-agent' | 'developer' | 'property-service' | 'public';
			docCategories?: Array<'estate-agent' | 'developer' | 'property-service' | 'public'>;
			areaStats?: AreaStats;
			areaStatsUpdatedAt?: string;
			areaStatsDueAt?: string;
			areaFaq?: AreaFaqItem[];
			areaHeroImage?: AreaHeroImage;
			neighbourhoodStats?: NeighbourhoodStats;
			neighbourhoodStatsVersion?: number;
			neighbourhoodStatsUpdatedAt?: string;
			neighbourhoodStatsDueAt?: string;
			neighbourhoodFaq?: AreaFaqItem[];
			neighbourhoodListings?: NeighbourhoodListing[];
			neighbourhoodGeo?: NeighbourhoodGeo;
		}
	>;
};

let loaded = false;
let store: KbMeta = { version: 1, items: {} };
let flushing: Promise<void> | null = null;

const ensureLoaded = async () => {
	if (loaded) return;
	loaded = true;
	try {
		const raw = await fs.readFile(META_PATH, 'utf8');
		const json = JSON.parse(raw) as KbMeta;
		if (json && json.version === 1 && json.items && typeof json.items === 'object') store = json;
	} catch {
		store = { version: 1, items: {} };
	}
};

const flush = async () => {
	await ensureLoaded();
	await fs.mkdir(ADMIN_DIR, { recursive: true });
	const tmp = `${META_PATH}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
	await fs.rename(tmp, META_PATH);
};

const flushSoon = () => {
	if (flushing) return flushing;
	flushing = flush()
		.catch(() => undefined)
		.finally(() => {
			flushing = null;
		});
	return flushing;
};

export const getKbMeta = async (id: string) => {
	await ensureLoaded();
	const v = store.items[String(id || '')] || {};
	return { ...v };
};

export const getKbMetaSnapshot = async () => {
	await ensureLoaded();
	return { ...store.items };
};

export const setKbMeta = async (
	id: string,
	patch: {
		tags?: string[];
		featuredImageUrl?: string | null;
		featuredImageAlt?: string | null;
		featuredImageTitle?: string | null;
		featuredImageCaption?: string | null;
		featuredImageCredit?: string | null;
		scheduledAt?: string | null;
		reviewedAt?: string | null;
		docCategory?: 'estate-agent' | 'developer' | 'property-service' | 'public' | null;
		docCategories?: Array<'estate-agent' | 'developer' | 'property-service' | 'public'> | null;
		areaStats?: AreaStats | null;
		areaStatsUpdatedAt?: string | null;
		areaStatsDueAt?: string | null;
		areaFaq?: AreaFaqItem[] | null;
		areaHeroImage?: AreaHeroImage | null;
		neighbourhoodStats?: NeighbourhoodStats | null;
		neighbourhoodStatsVersion?: number | null;
		neighbourhoodStatsUpdatedAt?: string | null;
		neighbourhoodStatsDueAt?: string | null;
		neighbourhoodFaq?: AreaFaqItem[] | null;
		neighbourhoodListings?: NeighbourhoodListing[] | null;
		neighbourhoodGeo?: NeighbourhoodGeo | null;
	}
) => {
	await ensureLoaded();
	const key = String(id || '');
	if (!key) return;
	const cur = store.items[key] || {};
	const next = { ...cur } as any;
	if (Array.isArray(patch.tags)) next.tags = patch.tags;
	if (patch.featuredImageUrl === null) delete next.featuredImageUrl;
	else if (typeof patch.featuredImageUrl === 'string') next.featuredImageUrl = patch.featuredImageUrl;
	if (patch.featuredImageAlt === null) delete next.featuredImageAlt;
	else if (typeof patch.featuredImageAlt === 'string') next.featuredImageAlt = patch.featuredImageAlt;
	if (patch.featuredImageTitle === null) delete next.featuredImageTitle;
	else if (typeof patch.featuredImageTitle === 'string') next.featuredImageTitle = patch.featuredImageTitle;
	if (patch.featuredImageCaption === null) delete next.featuredImageCaption;
	else if (typeof patch.featuredImageCaption === 'string') next.featuredImageCaption = patch.featuredImageCaption;
	if (patch.featuredImageCredit === null) delete next.featuredImageCredit;
	else if (typeof patch.featuredImageCredit === 'string') next.featuredImageCredit = patch.featuredImageCredit;
	if (patch.scheduledAt === null) delete next.scheduledAt;
	else if (typeof patch.scheduledAt === 'string') next.scheduledAt = patch.scheduledAt;
	if (patch.reviewedAt === null) delete next.reviewedAt;
	else if (typeof patch.reviewedAt === 'string') next.reviewedAt = patch.reviewedAt;
	if (patch.docCategory === null) delete next.docCategory;
	else if (typeof patch.docCategory === 'string') next.docCategory = patch.docCategory;
	if (patch.docCategories === null) delete next.docCategories;
	else if (Array.isArray(patch.docCategories)) {
		const uniq = Array.from(
			new Set(
				patch.docCategories
					.map((v: any) => String(v || '').trim())
					.filter((v) => v === 'estate-agent' || v === 'developer' || v === 'property-service' || v === 'public')
			)
		);
		if (uniq.length) next.docCategories = uniq;
		else delete next.docCategories;

		if (uniq.length === 1) next.docCategory = uniq[0];
		else delete next.docCategory;
	}

	const cleanNum = (v: any) => {
		const n = typeof v === 'number' ? v : Number(v);
		return Number.isFinite(n) ? n : null;
	};
	const cleanStr = (v: any) => {
		const s = String(v ?? '').trim();
		return s ? s : null;
	};
	const cleanStrArr = (v: any, max: number) => {
		if (!Array.isArray(v)) return null;
		const out = v
			.map((x: any) => cleanStr(x))
			.filter((x: any) => typeof x === 'string')
			.slice(0, Math.max(0, max));
		return out.length ? out : null;
	};
	const cleanBreakdown = (v: any, max: number) => {
		if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
		const entries: Array<{ k: string; v: number }> = [];
		for (const [k, val] of Object.entries(v as Record<string, any>)) {
			if (entries.length >= Math.max(0, max)) break;
			const key = String(k || '').trim();
			const num = cleanNum(val);
			if (!key) continue;
			if (typeof num !== 'number' || num <= 0) continue;
			entries.push({ k: key, v: num });
		}
		if (!entries.length) return null;
		const out: Record<string, number> = {};
		for (const e of entries) out[e.k] = Math.round(e.v);
		return Object.keys(out).length ? out : null;
	};

	if (patch.areaStats === null) delete next.areaStats;
	else if (patch.areaStats && typeof patch.areaStats === 'object') {
		const s: any = patch.areaStats as any;
		const out: AreaStats = {
			avgPrice: cleanNum(s.avgPrice),
			priceTrend: cleanStr(s.priceTrend),
			rentalYield: cleanNum(s.rentalYield),
			airportDistance: cleanNum(s.airportDistance),
			beachDistance: cleanNum(s.beachDistance),
			population: cleanNum(s.population),
			expatPercent: cleanNum(s.expatPercent),
			daysOnMarket: cleanNum(s.daysOnMarket),
			listingCount: cleanNum(s.listingCount),
		};
		next.areaStats = out;
	}

	if (patch.areaStatsUpdatedAt === null) delete next.areaStatsUpdatedAt;
	else if (typeof patch.areaStatsUpdatedAt === 'string') next.areaStatsUpdatedAt = patch.areaStatsUpdatedAt;
	if (patch.areaStatsDueAt === null) delete next.areaStatsDueAt;
	else if (typeof patch.areaStatsDueAt === 'string') next.areaStatsDueAt = patch.areaStatsDueAt;

	if (patch.areaFaq === null) delete next.areaFaq;
	else if (Array.isArray(patch.areaFaq)) {
		const items = patch.areaFaq
			.map((x: any) => ({ q: String(x?.q || '').trim(), a: String(x?.a || '').trim() }))
			.filter((x: any) => x.q && x.a)
			.slice(0, 40);
		if (items.length) next.areaFaq = items;
		else delete next.areaFaq;
	}

	if (patch.areaHeroImage === null) delete next.areaHeroImage;
	else if (patch.areaHeroImage && typeof patch.areaHeroImage === 'object') {
		const h: any = patch.areaHeroImage as any;
		const out: AreaHeroImage = {
			url: cleanStr(h.url),
			alt: cleanStr(h.alt),
			source: cleanStr(h.source),
			pageUrl: cleanStr(h.pageUrl),
			creditName: cleanStr(h.creditName),
			creditUrl: cleanStr(h.creditUrl),
			licenseName: cleanStr(h.licenseName),
			licenseUrl: cleanStr(h.licenseUrl),
		};
		next.areaHeroImage = out;
	}

	if (patch.neighbourhoodStats === null) delete next.neighbourhoodStats;
	else if (patch.neighbourhoodStats && typeof patch.neighbourhoodStats === 'object') {
		const s: any = patch.neighbourhoodStats as any;
		const out: NeighbourhoodStats = {
			avgPriceEur: cleanNum(s.avgPriceEur),
			priceTrend: cleanStr(s.priceTrend),
			rentalYieldPct: cleanNum(s.rentalYieldPct),
			airportDistanceKm: cleanNum(s.airportDistanceKm),
			beachDistanceKm: cleanNum(s.beachDistanceKm),
			driveToMalagaAirportMin: cleanNum(s.driveToMalagaAirportMin),
			driveToMarbellaMin: cleanNum(s.driveToMarbellaMin),
			driveToPuertoBanusMin: cleanNum(s.driveToPuertoBanusMin),
			nearestBeachName: cleanStr(s.nearestBeachName),
			driveToBeachMin: cleanNum(s.driveToBeachMin),
			pricePerM2Eur: cleanNum(s.pricePerM2Eur),
			sampleSize: cleanNum(s.sampleSize),
			priceMinEur: cleanNum(s.priceMinEur),
			priceMaxEur: cleanNum(s.priceMaxEur),
			municipality: cleanStr(s.municipality),
			topSubareas: cleanStrArr(s.topSubareas, 12),
			propertyTypeBreakdown: cleanBreakdown(s.propertyTypeBreakdown, 12),
			population: cleanNum(s.population),
			expatPercent: cleanNum(s.expatPercent),
			daysOnMarket: cleanNum(s.daysOnMarket),
			listingCount: cleanNum(s.listingCount),
			recentAvgMaxC: cleanNum(s.recentAvgMaxC),
			recentAvgMinC: cleanNum(s.recentAvgMinC),
			annualRainMm: cleanNum(s.annualRainMm),
		};
		next.neighbourhoodStats = out;
	}

	if (patch.neighbourhoodStatsVersion === null) delete next.neighbourhoodStatsVersion;
	else if (typeof patch.neighbourhoodStatsVersion === 'number' || typeof patch.neighbourhoodStatsVersion === 'string') {
		const n = Math.floor(Number(patch.neighbourhoodStatsVersion));
		if (Number.isFinite(n) && n > 0) next.neighbourhoodStatsVersion = n;
		else delete next.neighbourhoodStatsVersion;
	}

	if (patch.neighbourhoodStatsUpdatedAt === null) delete next.neighbourhoodStatsUpdatedAt;
	else if (typeof patch.neighbourhoodStatsUpdatedAt === 'string') next.neighbourhoodStatsUpdatedAt = patch.neighbourhoodStatsUpdatedAt;
	if (patch.neighbourhoodStatsDueAt === null) delete next.neighbourhoodStatsDueAt;
	else if (typeof patch.neighbourhoodStatsDueAt === 'string') next.neighbourhoodStatsDueAt = patch.neighbourhoodStatsDueAt;

	if (patch.neighbourhoodFaq === null) delete next.neighbourhoodFaq;
	else if (Array.isArray(patch.neighbourhoodFaq)) {
		const items = patch.neighbourhoodFaq
			.map((x: any) => ({ q: String(x?.q || '').trim(), a: String(x?.a || '').trim() }))
			.filter((x: any) => x.q && x.a)
			.slice(0, 40);
		if (items.length) next.neighbourhoodFaq = items;
		else delete next.neighbourhoodFaq;
	}

	if (patch.neighbourhoodListings === null) delete next.neighbourhoodListings;
	else if (Array.isArray(patch.neighbourhoodListings)) {
		const items = patch.neighbourhoodListings
			.map((l: any) => ({
				url: String(l?.url || '').trim(),
				title: String(l?.title || '').trim(),
				imageUrl: cleanStr(l?.imageUrl),
				priceEur: cleanNum(l?.priceEur),
				bedrooms: cleanNum(l?.bedrooms),
				bathrooms: cleanNum(l?.bathrooms),
				buildM2: cleanNum(l?.buildM2),
			}))
			.filter((l: any) => l.url && l.title)
			.slice(0, 12);
		if (items.length) next.neighbourhoodListings = items;
		else delete next.neighbourhoodListings;
	}

	if (patch.neighbourhoodGeo === null) delete next.neighbourhoodGeo;
	else if (patch.neighbourhoodGeo && typeof patch.neighbourhoodGeo === 'object') {
		const g: any = patch.neighbourhoodGeo as any;
		const out: NeighbourhoodGeo = {
			lat: cleanNum(g.lat),
			lon: cleanNum(g.lon),
			placeName: cleanStr(g.placeName),
			municipality: cleanStr(g.municipality),
			region: cleanStr(g.region),
			country: cleanStr(g.country),
		};
		next.neighbourhoodGeo = out;
	}

	store.items[key] = next;
	await flushSoon();
	return { ...next };
};

export const listDueScheduled = async (nowMs: number) => {
	await ensureLoaded();
	const out: Array<{ id: string; scheduledAt: string }> = [];
	for (const [id, v] of Object.entries(store.items)) {
		const s = String(v?.scheduledAt || '');
		if (!s) continue;
		const t = Date.parse(s);
		if (!Number.isFinite(t)) continue;
		if (t <= nowMs) out.push({ id, scheduledAt: s });
	}
	out.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
	return out;
};
