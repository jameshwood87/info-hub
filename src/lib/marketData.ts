// First-party PropertyList market data via the public MCP (mcp.propertylist.es).
// Server-side only. Covers Spain + Portugal, for-sale / for-rent / holiday-rentals.
// Returns clean typed data (listing counts, prices, EUR/m2, bedroom bands, Oracle
// notary-verified prices, and real listing cards). Graceful null/[] on any failure.

const MCP_URL = 'https://mcp.propertylist.es/mcp';
const PORTAL_ORIGIN = 'https://www.propertylist.es';

export type SearchType = 'for-sale' | 'for-rent' | 'holiday-rentals';

export type OracleInfo = {
	verified: boolean;
	verifiedPricePerSqm: number | null;
	sampleSize: number | null;
	periodEnd: string | null;
	source: string | null;
	attestationUrl: string | null;
	note: string | null;
};

export type AreaMarketSummary = {
	location: string;
	searchType: SearchType;
	totalListings: number;
	medianPrice: number | null;
	meanPrice: number | null;
	minPrice: number | null;
	maxPrice: number | null;
	medianPricePerSqm: number | null;
	byBedroomBand: Record<string, number>;
	oracle: OracleInfo;
};

export type MarketListing = {
	id: number | null;
	reference: string | null;
	title: string | null;
	price: number | null;
	searchType: SearchType;
	bedrooms: number | null;
	bathrooms: number | null;
	buildSqm: number | null;
	plotSqm: number | null;
	energyRating: string | null;
	suburb: string | null;
	city: string | null;
	province: string | null;
	lat: number | null;
	lon: number | null;
	excerpt: string | null;
	photoUrl: string | null;
	url: string | null;
	oracleVerified: boolean;
	oracleAttestationUrl: string | null;
};

export type LocationMatch = { id: number | null; name: string; kind: number | null; province: string | null };

type CacheEntry = { at: number; value: any };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1h in-process cache (public MCP is rate-limited)

const num = (v: any): number | null => {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

const callMcp = async (name: string, args: Record<string, any>): Promise<any | null> => {
	const key = `${name}:${JSON.stringify(args)}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	try {
		const res = await fetch(MCP_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
		});
		if (!res.ok) return null;
		const data = await res.json().catch(() => null);
		const sc = (data as any)?.result?.structuredContent ?? null;
		if (sc) cache.set(key, { at: Date.now(), value: sc });
		return sc;
	} catch {
		return null;
	}
};

export const areaMarketSummary = async (
	location: string,
	searchType: SearchType = 'for-sale',
): Promise<AreaMarketSummary | null> => {
	const loc = String(location || '').trim();
	if (!loc) return null;
	const sc = await callMcp('area_market_summary', { location: loc, search_type: searchType });
	if (!sc || typeof sc.total_listings === 'undefined') return null;
	const o = sc.oracle && typeof sc.oracle === 'object' ? sc.oracle : {};
	return {
		location: String(sc.location || loc),
		searchType,
		totalListings: num(sc.total_listings) ?? 0,
		medianPrice: num(sc.median_price),
		meanPrice: num(sc.mean_price),
		minPrice: num(sc.min_price),
		maxPrice: num(sc.max_price),
		medianPricePerSqm: num(sc.median_price_per_sqm),
		byBedroomBand: sc.by_bedroom_band && typeof sc.by_bedroom_band === 'object' ? sc.by_bedroom_band : {},
		oracle: {
			verified: Boolean(o.verified),
			verifiedPricePerSqm: num(o.verified_price_per_sqm),
			sampleSize: num(o.sample_size),
			periodEnd: o.period_end ? String(o.period_end) : null,
			source: o.source ? String(o.source) : null,
			attestationUrl: o.attestation_url ? String(o.attestation_url) : null,
			note: o.note ? String(o.note) : null,
		},
	};
};

export const searchProperties = async (
	location: string,
	searchType: SearchType = 'for-sale',
	limit = 6,
): Promise<MarketListing[]> => {
	const loc = String(location || '').trim();
	if (!loc) return [];
	const sc = await callMcp('search_properties', {
		location: loc,
		search_type: searchType,
		limit: Math.max(1, Math.min(24, limit)),
	});
	const props = Array.isArray(sc?.properties) ? sc.properties : [];
	return props.map((p: any): MarketListing => {
		const photo = String(p?.photo || '').trim();
		const photoUrl = photo ? (/^https?:\/\//i.test(photo) ? photo : `${PORTAL_ORIGIN}${photo}`) : null;
		const locObj = p?.location && typeof p.location === 'object' ? p.location : {};
		const id = num(p?.id);
		return {
			id,
			reference: p?.reference ? String(p.reference) : null,
			title: p?.title ? String(p.title) : null,
			price: num(p?.price),
			searchType,
			bedrooms: num(p?.bedrooms),
			bathrooms: num(p?.bathrooms),
			buildSqm: num(p?.build_sqm),
			plotSqm: num(p?.plot_sqm),
			energyRating: p?.energy_rating ? String(p.energy_rating) : null,
			suburb: locObj?.suburb ? String(locObj.suburb) : null,
			city: locObj?.city ? String(locObj.city) : null,
			province: locObj?.province ? String(locObj.province) : null,
			lat: num(locObj?.latitude),
			lon: num(locObj?.longitude),
			excerpt: p?.description_excerpt ? String(p.description_excerpt) : null,
			photoUrl,
			url: p?.url ? String(p.url) : id ? `${PORTAL_ORIGIN}/p/${id}` : null,
			oracleVerified: Boolean(p?.oracle_verified),
			oracleAttestationUrl: p?.oracle_attestation_url ? String(p.oracle_attestation_url) : null,
		};
	});
};

export const autocompleteLocation = async (query: string): Promise<LocationMatch[]> => {
	const q = String(query || '').trim();
	if (!q) return [];
	const sc = await callMcp('autocomplete_location', { query: q });
	const matches = Array.isArray(sc?.matches) ? sc.matches : [];
	return matches.map((m: any): LocationMatch => ({
		id: num(m?.id),
		name: String(m?.name || ''),
		kind: num(m?.kind),
		province: m?.province ? String(m.province) : null,
	}));
};

export const marketsForArea = async (
	location: string,
): Promise<{ sale: AreaMarketSummary | null; rent: AreaMarketSummary | null; holiday: AreaMarketSummary | null }> => {
	const [sale, rent, holiday] = await Promise.all([
		areaMarketSummary(location, 'for-sale'),
		areaMarketSummary(location, 'for-rent'),
		areaMarketSummary(location, 'holiday-rentals'),
	]);
	return { sale, rent, holiday };
};
