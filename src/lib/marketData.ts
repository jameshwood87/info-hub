// First-party PropertyList market data via the public MCP (mcp.propertylist.es).
// Server-side only. Covers Spain + Portugal, for-sale / for-rent / holiday-rentals.
// Returns clean typed data (listing counts, prices, EUR/m2, bedroom bands, Oracle
// notary-verified prices, and real listing cards). Graceful null/[] on any failure.

const MCP_URL = 'https://mcp.propertylist.es/mcp';
const MCP_KEY = (process.env.PROPERTYLIST_MCP_KEY || '').trim(); // server-side only

// Silence here cost us two months. PROPERTYLIST_MCP_KEY was absent (the .env
// defined MCP_AGENT_KEY instead), so the conditional authorization header below
// was never added and every call went out anonymous: onto the public tier's
// shared per-IP rate limit, unattributed, and showing up on PropertyList's side
// as two thirds of all 'external' MCP traffic. Degrade to anonymous if we must,
// but never do it quietly.
if (!MCP_KEY) {
	console.warn(
		'[marketData] PROPERTYLIST_MCP_KEY is not set. MCP calls will run ANONYMOUSLY on the public tier ' +
			'(shared per-IP rate limit, no attribution). Set it in /opt/info-hub/.env and restart info-hub.service.',
	);
}

// A key that is set but rejected is the other half of the same trap: it fails
// every call while looking configured. Warn once rather than on every render.
let warnedAuth = false;
const PORTAL_ORIGIN = 'https://propertylist.es';

// The MCP hands back absolute URLs on the www host, which 301s to the bare
// host, and the house rule is never to publish a www link. Normalise what
// comes in from the API rather than trusting it: same defensive class as the
// host-less photo paths in bug #197.
const canonicalPortalUrl = (u: string | null | undefined): string | null => {
	const v = String(u || '').trim();
	if (!v) return null;
	return v.replace(/^https?:\/\/www\.propertylist\.es/i, PORTAL_ORIGIN);
};

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
	priceUnit: 'total' | 'per_month' | 'per_week' | null;
	priceBasis: string | null;
	matchExact: boolean;
	matchedLocation: string | null;
	note: string | null;
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
	provinceCode: string | null;
	municipality: string | null;
	municipalityCode: string | null;
	pricePeriod: string | null;
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

// A failed fetch and a genuinely empty area must never look alike: the area
// guides make a public claim ("no agency has claimed X") on the empty case.
// callMcp returns undefined for transport/HTTP/rate-limit failure and an
// object for a definitive answer, and retries once because the public MCP
// rate limit makes 429s bursty. A global reachability counter was tried first
// and failed: one page's success made every other page trust its own 429s.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const callMcp = async (name: string, args: Record<string, any>): Promise<any | undefined> => {
	const key = `${name}:${JSON.stringify(args)}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const res = await fetch(MCP_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0 (compatible; info-hub)', ...(MCP_KEY ? { authorization: `Bearer ${MCP_KEY}` } : {}) },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
			});
			if (res.status === 401 || res.status === 403) {
				if (!warnedAuth) {
					warnedAuth = true;
					console.warn(
						`[marketData] MCP rejected our credential (HTTP ${res.status}). PROPERTYLIST_MCP_KEY is set but ` +
							'invalid or revoked, so market data is failing. Check the key in /opt/info-hub/.env.',
					);
				}
				break; // retrying a rejected credential just burns a second request
			}
			if (res.ok) {
				const data = await res.json().catch(() => null);
				if (data && !(data as any).error) {
					const sc = (data as any)?.result?.structuredContent ?? null;
					if (sc) {
						cache.set(key, { at: Date.now(), value: sc });
						return sc;
					}
				}
			}
		} catch {
			/* fall through to retry */
		}
		if (attempt === 0) await sleep(900);
	}
	return undefined;
};

// Unmatched place names now come back from the MCP as { total_listings: 0,
// error: 'location_not_found', location_match: { matched: false } } (Lucy, 2026-07-29),
// so we read that field directly instead of the old sentinel calibration.

export type AreaFetch = { status: 'ok'; data: AreaMarketSummary } | { status: 'unmatched' } | { status: 'failed' };

export const areaMarketSummaryChecked = async (
	location: string,
	searchType: SearchType = 'for-sale',
): Promise<AreaFetch> => {
	// Parentheticals break MCP matching: "Pedregalejo (Málaga)" never matches
	// while "Pedregalejo" does. Strip them before querying.
	const loc = String(location || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
	if (!loc) return { status: 'unmatched' };
	const sc = await callMcp('area_market_summary', { location: loc, search_type: searchType });
	if (typeof sc === 'undefined') return { status: 'failed' };
	if (!sc || typeof sc.total_listings === 'undefined') return { status: 'failed' };
	if (sc.error === 'location_not_found' || (sc.location_match && sc.location_match.matched === false)) return { status: 'unmatched' };
	return { status: 'ok', data: buildSummary(sc, loc, searchType) };
};

export const areaMarketSummary = async (
	location: string,
	searchType: SearchType = 'for-sale',
): Promise<AreaMarketSummary | null> => {
	const r = await areaMarketSummaryChecked(location, searchType);
	return r.status === 'ok' ? r.data : null;
};

const buildSummary = (sc: any, loc: string, searchType: SearchType): AreaMarketSummary => {
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
		priceUnit: sc.price_unit === 'per_month' || sc.price_unit === 'per_week' || sc.price_unit === 'total' ? sc.price_unit : null,
		priceBasis: sc.price_basis ? String(sc.price_basis) : null,
		matchExact: sc.location_match ? Boolean(sc.location_match.exact) : true,
		matchedLocation: sc.location_match && sc.location_match.matched_location ? String(sc.location_match.matched_location) : null,
		note: sc.note ? String(sc.note) : null,
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
		const photoUrl = canonicalPortalUrl(photo ? (/^https?:\/\//i.test(photo) ? photo : `${PORTAL_ORIGIN}${photo}`) : null);
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
			provinceCode: locObj?.province_code ? String(locObj.province_code) : null,
			municipality: locObj?.municipality ? String(locObj.municipality) : null,
			municipalityCode: locObj?.municipality_code ? String(locObj.municipality_code) : null,
			pricePeriod: p?.price_period ? String(p.price_period) : null,
			lat: num(locObj?.latitude),
			lon: num(locObj?.longitude),
			excerpt: p?.description_excerpt ? String(p.description_excerpt) : null,
			photoUrl,
			url: p?.url ? canonicalPortalUrl(String(p.url)) : id ? `${PORTAL_ORIGIN}/p/${id}` : null,
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
): Promise<{ sale: AreaMarketSummary | null; rent: AreaMarketSummary | null; holiday: AreaMarketSummary | null; ok: boolean }> => {
	const [saleR, rentR, holidayR] = await Promise.all([
		areaMarketSummaryChecked(location, 'for-sale'),
		areaMarketSummaryChecked(location, 'for-rent'),
		areaMarketSummaryChecked(location, 'holiday-rentals'),
	]);
	const pick = (r: AreaFetch) => (r.status === 'ok' ? r.data : null);
	// ok = the SALE answer is definitive for this page's own render: the MCP
	// matched the location and told us the count. A 429, a transport failure or
	// an unmatched name must all fail this, because the founding block turns it
	// into a public claim that nobody has listed here.
	return { sale: pick(saleR), rent: pick(rentR), holiday: pick(holidayR), ok: saleR.status === 'ok' };
};

// ---- portal price enrichment ----
// MCP rental price serializer was fixed 2026-07-04 (Lucy): rentals now return price +
// price_period. This portal-JSON-LD enrichment is now a DORMANT fallback: it only
// fires when price is still null (e.g. price-on-application listings). Safe to keep.
const portalPriceCache = new Map<string, { v: number | null; at: number }>();
const PORTAL_PRICE_TTL_MS = 6 * 60 * 60 * 1000;

export const fetchPortalPrice = async (url: string): Promise<number | null> => {
	if (!url || !/^https?:\/\//i.test(url)) return null;
	const hit = portalPriceCache.get(url);
	if (hit && Date.now() - hit.at < PORTAL_PRICE_TTL_MS) return hit.v;
	let v: number | null = null;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; info-hub)' },
			redirect: 'follow',
			signal: AbortSignal.timeout(6000),
		});
		if (res.ok) {
			const html = await res.text();
			const m = html.match(/"offers"\s*:\s*\{[^}]*?"price"\s*:\s*"?([0-9][0-9.,]*)"?/);
			if (m) {
				const n = Number(String(m[1]).replace(/,/g, ''));
				if (Number.isFinite(n) && n > 0) v = Math.round(n);
			}
		}
	} catch {
		// leave null; caller falls back to "Price on request"
	}
	portalPriceCache.set(url, { v, at: Date.now() });
	return v;
};

export const enrichListingPrices = async (listings: MarketListing[], max = 6): Promise<MarketListing[]> => {
	const targets = listings.slice(0, max).filter((l) => !l.price && l.url);
	await Promise.all(
		targets.map(async (l) => {
			const p = await fetchPortalPrice(l.url);
			if (p) (l as { price: number | null }).price = p;
		})
	);
	return [...listings.filter((l) => l.price), ...listings.filter((l) => !l.price)];
};
