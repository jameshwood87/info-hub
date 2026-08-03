import type { APIRoute } from 'astro';
import beachData from '../../data/beaches.json';
import { adminGetKbPageById, adminGetKbPageByPath } from '../../lib/directus';
import { getKbMeta, getKbMetaSnapshot, setKbMeta } from '../../lib/adminMeta';

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const getTokenFromRequest = (request: Request) => {
	const auth = String(request.headers.get('authorization') || '').trim();
	if (auth.toLowerCase().startsWith('bearer ')) return auth.slice('bearer '.length).trim();
	const apiKey = String(request.headers.get('x-api-key') || '').trim();
	return apiKey || '';
};

const isAreaPath = (p: string) => p.startsWith('/andalucia/') || p.startsWith('/es/andalucia/');
const isNeighbourhoodPath = (p: string) => p.startsWith('/neighbourhood/') || p.startsWith('/es/barrios/');
const NEIGHBOURHOOD_STATS_VERSION = 3;
const STATS_CACHE_DAYS = 90;
const STATS_CACHE_MS = STATS_CACHE_DAYS * 24 * 60 * 60 * 1000;

const legacyNeighbourhoodPathForKey = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/neighbourhood/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return path;
	if (parts.length !== 4) return path;
	const slug = parts[3] || '';
	if (!slug) return path;
	return `/neighbourhood/${slug}/`;
};

export const neighbourhoodSlugFromPath = (p: string) => {
	const parts = String(p || '').split('/').filter(Boolean);
	if (!parts.length) return '';
	if (parts[0] === 'neighbourhood') {
		if (parts.length >= 4) return String(parts[3] || '');
		return String(parts[1] || '');
	}
	if (parts[0] === 'es' && parts[1] === 'barrios') return String(parts[2] || '');
	return '';
};

const isDueStats = (v: any, nowMs: number, opts: { dueKey: string; updatedKey: string; maxAgeMs: number }) => {
	const dueAt = typeof v?.[opts.dueKey] === 'string' ? Date.parse(v[opts.dueKey]) : NaN;
	if (Number.isFinite(dueAt) && dueAt <= nowMs) return true;
	const updatedAt = typeof v?.[opts.updatedKey] === 'string' ? Date.parse(v[opts.updatedKey]) : NaN;
	if (Number.isFinite(updatedAt) && nowMs - updatedAt > opts.maxAgeMs) return true;
	if (!Number.isFinite(dueAt) && !Number.isFinite(updatedAt)) return true;
	return false;
};

const toIsoDate = (ms: number) => new Date(ms).toISOString();
const toYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const stripGuideSuffix = (s: string) =>
	String(s || '')
		.replace(/\s*(?:•|-)\s*PropertyList Info Hub\s*$/i, '')
		.replace(/\s+(?:neighbourhood\s+guide|area\s+guide)\s*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();

const slugify = (s: string) =>
	String(s || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const canonicalProvinceLabel = (key: string) => {
	const k = slugify(key);
	const map: Record<string, string> = {
		almeria: 'Almería',
		cadiz: 'Cádiz',
		cordoba: 'Córdoba',
		granada: 'Granada',
		huelva: 'Huelva',
		jaen: 'Jaén',
		malaga: 'Málaga',
		sevilla: 'Sevilla',
	};
	return map[k] || String(key || '').trim();
};

const provinceHintFromTags = (tags: any): string | null => {
	const list = Array.isArray(tags) ? tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
	const kv = list
		.map((t) => {
			const m = t.match(/^(?:province|prov)\s*[:=]\s*(.+)$/i);
			return m ? String(m[1] || '').trim() : '';
		})
		.filter(Boolean)[0];
	if (kv) return canonicalProvinceLabel(kv);

	const loose = list
		.map((t) => slugify(t))
		.filter(Boolean)
		.find((t) => ['almeria', 'cadiz', 'cordoba', 'granada', 'huelva', 'jaen', 'malaga', 'sevilla'].includes(t));
	return loose ? canonicalProvinceLabel(loose) : null;
};

type NeighbourhoodGeoOverride = { lat: number; lon: number; municipality: string; region: string };

// Areas Nominatim cannot place correctly, pinned by hand. Free-text geocoding either
// missed these entirely ("La Quinta, Benahavís, Málaga, Spain" and "Sotogrande, San
// Roque, Cádiz, Spain" both return no result) or answered with somewhere else - it put
// Sotogrande in Estepona, 30km up the coast in the wrong province, and both Balearic
// islands plus Madrid on the Costa del Sol. Coordinates below were each checked against
// Nominatim by name; edit one and that area re-pins on the next refresh.
const NEIGHBOURHOOD_GEO_OVERRIDES: Record<string, NeighbourhoodGeoOverride> = {
	[slugify('Sotogrande')]: { lat: 36.2820648, lon: -5.2970604, municipality: 'San Roque', region: 'Cádiz' },
	[slugify('Alcaidesa')]: { lat: 36.2565300, lon: -5.3543500, municipality: 'San Roque', region: 'Cádiz' },
	[slugify('La Duquesa')]: { lat: 36.3571751, lon: -5.2320702, municipality: 'Manilva', region: 'Málaga' },
	[slugify('Torreblanca')]: { lat: 36.5649600, lon: -4.6065700, municipality: 'Fuengirola', region: 'Málaga' },
	// keeps the position already in production - only the municipality was wrong, as the
	// generic lookup labelled it Artola (which is the far side of Marbella)
	[slugify('La Quinta')]: { lat: 36.5185231, lon: -5.0019978, municipality: 'Benahavís', region: 'Málaga' },
	[slugify('Mallorca')]: { lat: 39.5532200, lon: 2.7290310, municipality: 'Palma', region: 'Illes Balears' },
	[slugify('Ibiza')]: { lat: 38.9743900, lon: 1.4197460, municipality: 'Eivissa', region: 'Illes Balears' },
	[slugify('Madrid')]: { lat: 40.4167800, lon: -3.7035000, municipality: 'Madrid', region: 'Madrid' },
	// bare "Calahonda" matched the one near Motril, 82km east in Granada province, and
	// stored this area as Nerja; ours is Sitio de Calahonda in Mijas
	[slugify('Calahonda')]: { lat: 36.4910310, lon: -4.7267880, municipality: 'Mijas', region: 'Málaga' },
	// was pinned in Málaga city, ~38km from the real Las Chapas
	[slugify('Las Chapas')]: { lat: 36.5355070, lon: -4.8083800, municipality: 'Marbella', region: 'Málaga' },
};

const geoOverrideMatches = (geo: any, o: NeighbourhoodGeoOverride) =>
	!!geo &&
	Number(geo.lat) === o.lat &&
	Number(geo.lon) === o.lon &&
	String(geo.municipality || '') === o.municipality &&
	String(geo.region || '') === o.region;

export const municipalityFromCommaLocation = (raw: string) => {
	const parts = String(raw || '')
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2) return '';
	return parts[1] || '';
};

const canonicalPortalMunicipalitySlug = (raw: string) => {
	const s = slugify(raw || '');
	if (!s) return '';
	const known = [
		'marbella',
		'benahavis',
		'estepona',
		'malaga',
		'mijas',
		'fuengirola',
		'torremolinos',
		'benalmadena',
		'nerja',
		'manilva',
		'casares',
		'ojen',
	];
	if (known.includes(s)) return s;
	for (const k of known) {
		if (s.includes(k)) return k;
	}
	return s;
};

export const portalPathFor = (slug: string, municipality?: string | null) => {
	const s = slugify(slug || '');
	if (!s) return '';
	const m = canonicalPortalMunicipalitySlug(municipality || '');
	if (m) return `/portal/for-sale/${m}/${s}`;
	return `/portal/for-sale/${s}`;
};

let geocodeGate: Promise<void> = Promise.resolve();
// Nominatim's usage policy is one request per second; queue calls so a multi-area
// refresh can never burst past it.
const waitForGeocodeSlot = () => {
	const next = geocodeGate.then(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
	geocodeGate = next.catch(() => undefined);
	return next;
};

const geocodePlace = async (q: string) => {
	const query = String(q || '').trim();
	if (!query) return null;
	const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
	await waitForGeocodeSlot();
	const res = await fetch(url, {
		headers: { 'user-agent': 'PropertyListInfoHub/1.0', accept: 'application/json' },
	}).catch(() => null);
	if (!res || !res.ok) return null;
	const json = (await res.json().catch(() => null)) as any;
	const first = Array.isArray(json) ? json[0] : null;
	if (!first) return null;
	const lat = Number(first.lat);
	const lon = Number(first.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	const name = typeof first.display_name === 'string' ? String(first.display_name).trim() : '';
	const addr = first?.address && typeof first.address === 'object' ? first.address : null;
	const municipality =
		addr && typeof addr.city === 'string'
			? String(addr.city).trim()
			: addr && typeof addr.town === 'string'
				? String(addr.town).trim()
				: addr && typeof addr.municipality === 'string'
					? String(addr.municipality).trim()
					: addr && typeof addr.village === 'string'
						? String(addr.village).trim()
						: null;
	const province =
		addr && typeof addr.province === 'string'
			? String(addr.province).trim()
			: addr && typeof addr.state === 'string'
				? String(addr.state).trim()
				: null;
	return { lat, lon, displayName: name || null, municipality: municipality || null, province: province || null };
};

const fetchClimate = async (lat: number, lon: number, nowMs: number) => {
	const endMs = nowMs - 24 * 60 * 60 * 1000;
	const startMs = endMs - 365 * 24 * 60 * 60 * 1000;
	const start = toYmd(startMs);
	const end = toYmd(endMs);
	const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(
		String(lon),
	)}&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(
		end,
	)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=UTC`;

	const res = await fetch(url, { headers: { 'user-agent': 'PropertyListInfoHub/1.0' } }).catch(() => null);
	if (!res || !res.ok) return null;
	const json = (await res.json().catch(() => null)) as any;
	const daily = json?.daily || null;
	const maxes = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
	const mins = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
	const rain = Array.isArray(daily?.precipitation_sum) ? daily.precipitation_sum : [];

	const avg = (arr: any[]) => {
		const nums = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
		if (!nums.length) return null;
		return nums.reduce((a, b) => a + b, 0) / nums.length;
	};

	const sum = (arr: any[]) => {
		const nums = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
		if (!nums.length) return null;
		return nums.reduce((a, b) => a + b, 0);
	};

	const avgMax = avg(maxes);
	const avgMin = avg(mins);
	const annualRain = sum(rain);
	return {
		recentAvgMaxC: typeof avgMax === 'number' ? Math.round(avgMax * 10) / 10 : null,
		recentAvgMinC: typeof avgMin === 'number' ? Math.round(avgMin * 10) / 10 : null,
		annualRainMm: typeof annualRain === 'number' ? Math.round(annualRain) : null,
	};
};

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
};

const osrmDrive = async (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
	const url = `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(String(fromLon))},${encodeURIComponent(
		String(fromLat),
	)};${encodeURIComponent(String(toLon))},${encodeURIComponent(String(toLat))}?overview=false`;
	const res = await fetch(url, { headers: { 'user-agent': 'PropertyListInfoHub/1.0', accept: 'application/json' } }).catch(() => null);
	if (!res || !res.ok) return null;
	const json = (await res.json().catch(() => null)) as any;
	const route = Array.isArray(json?.routes) ? json.routes[0] : null;
	const distanceM = Number(route?.distance);
	const durationS = Number(route?.duration);
	if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) return null;
	return { distanceKm: distanceM / 1000, durationMin: durationS / 60 };
};

// Beaches do not move, and overpass-api.de refuses connections from this host, so the
// nearest one is resolved from a snapshot of OpenStreetMap rather than a live query.
// Rebuild the snapshot with scripts/fetch-beaches.py (run it from a host Overpass will
// talk to - the Contabo box works). Unnamed entries are kept deliberately: most of the
// Sotogrande shoreline is untagged in OSM, and dropping those would have reported its
// nearest beach as 5km away in the next town instead of the 1.6km that is true.
type BeachRecord = { lat: number; lon: number; name?: string };
const BEACHES = beachData as BeachRecord[];

const nearestBeach = (lat: number, lon: number) => {
	let best: BeachRecord | null = null;
	let bestKm = Infinity;
	for (const b of BEACHES) {
		const km = haversineKm(lat, lon, b.lat, b.lon);
		if (km < bestKm) {
			bestKm = km;
			best = b;
		}
	}
	// same 35km cut-off the live query used, so inland areas report no beach at all
	if (!best || !Number.isFinite(bestKm) || bestKm > 35) return null;
	return { name: best.name || null, lat: best.lat, lon: best.lon, distanceKm: bestKm };
};

const median = (nums: number[]) => {
	const arr = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
	if (!arr.length) return null;
	const mid = Math.floor(arr.length / 2);
	return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
};

const fetchPropertyListMarkdown = async (url: string) => {
	const u = String(url || '').trim();
	if (!u) return null;
	const target = `https://r.jina.ai/http://${u.replace(/^https?:\/\//i, '')}`;
	const res = await fetch(target, { headers: { 'user-agent': 'PropertyListInfoHub/1.0', accept: 'text/plain' } }).catch(() => null);
	if (!res || !res.ok) return null;
	const text = await res.text().catch(() => '');
	return text || null;
};

const parsePortalListingUrls = (md: string) => {
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const m of md.matchAll(/\]\((https?:\/\/propertylist\.es\/[^\s)]+)\)/gi)) {
		const url = String(m[1] || '').trim();
		if (!url) continue;
		if (!/-for-sale-in-/i.test(url)) continue;
		if (seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
		if (urls.length >= 8) break;
	}
	return urls;
};

const parseListingFromMarkdown = (md: string) => {
	const priceMatch = md.match(/\n€\s*([0-9][0-9,\.]*)\s*\n/);
	const titleMatch = md.match(/\n\n€\s*[0-9][0-9,\.]*\s*\n\n([^\n]+)\n\n/);
	const bedsMatch = md.match(/Bedrooms\s*\n\n(\d+)/i);
	const bathsMatch = md.match(/Bathrooms\s*\n\n(\d+)/i);
	const buildMatch = md.match(/Build\s*\(m²\)\s*\n\n(\d+)/i);
	const imageMatch = md.match(/!\[Image\s+\d+\]\((https?:\/\/propertylist\.es\/rails\/active_storage\/blobs\/redirect\/[^\)]+)\)/i);
	const price = priceMatch ? Number(String(priceMatch[1]).replace(/[^\d]/g, '')) : NaN;
	const bedrooms = bedsMatch ? Number(bedsMatch[1]) : NaN;
	const bathrooms = bathsMatch ? Number(bathsMatch[1]) : NaN;
	const buildM2 = buildMatch ? Number(buildMatch[1]) : NaN;
	const title = titleMatch ? String(titleMatch[1] || '').trim() : '';
	return {
		title: title || null,
		priceEur: Number.isFinite(price) ? price : null,
		bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
		bathrooms: Number.isFinite(bathrooms) ? bathrooms : null,
		buildM2: Number.isFinite(buildM2) ? buildM2 : null,
		imageUrl: imageMatch ? String(imageMatch[1] || '').trim() : null,
	};
};

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
const topKeys = (m: Map<string, number>, limit: number) =>
	[...m.entries()]
		.sort((a, b) => b[1] - a[1])
		.map((x) => x[0])
		.filter(Boolean)
		.slice(0, Math.max(0, limit));

const normalizePropType = (raw: string) => {
	const s = String(raw || '').trim();
	if (!s) return '';
	if (/^apartment/i.test(s)) return 'Apartment';
	if (/^penthouse/i.test(s)) return 'Penthouse';
	if (/^villa/i.test(s)) return 'Villa';
	if (/^townhouse/i.test(s)) return 'Townhouse';
	if (/^plot/i.test(s)) return 'Plot';
	if (/^house/i.test(s)) return 'House';
	return s.replace(/\s+/g, ' ').trim();
};

type RefreshResult = { ok: true; updated: boolean; skipped: boolean; key: string; updatedKey?: string } | { ok: false; error: string; key: string };

const inflight = new Map<string, Promise<RefreshResult>>();

export const refreshKbStatsForKeyWithSnapshot = async (
	key: string,
	snapshot: Record<string, any>,
	opts: { nowMs: number; force?: boolean; nextDueMs?: number },
): Promise<RefreshResult> => {
	const rawKey = String(key || '').trim();
	if (!rawKey) return { ok: false, error: 'missing_key', key: rawKey };

	const lockKey = rawKey;
	const existingInflight = inflight.get(lockKey);
	if (existingInflight) return existingInflight;

	const p = (async (): Promise<RefreshResult> => {
		const now = Math.max(0, Number(opts?.nowMs) || Date.now());
		const nowIso = toIsoDate(now);
		const nextDueIso = toIsoDate(Math.max(now, Number(opts?.nextDueMs) || now + STATS_CACHE_MS));
		const force = Boolean(opts?.force);

		const directExisting = (snapshot as any)[rawKey] || {};
		const lookupKey = rawKey.startsWith('/') ? legacyNeighbourhoodPathForKey(rawKey) : rawKey;
		const page = rawKey.startsWith('/')
			? await adminGetKbPageByPath(lookupKey).catch(() => null)
			: await adminGetKbPageById(rawKey).catch(() => null);
		const pagePath = String(page?.path || (rawKey.startsWith('/') ? rawKey : ''));
		const idKey = String(page?.id || (rawKey.startsWith('/') ? '' : rawKey));

		const kind = isAreaPath(pagePath) ? 'area' : isNeighbourhoodPath(pagePath) ? 'neighbourhood' : null;
		if (!kind) return { ok: true, updated: false, skipped: true, key: rawKey };

		const existing = idKey ? (snapshot as any)[idKey] || directExisting : directExisting;
		const needsVersionRefresh =
			kind === 'neighbourhood' && Number((existing as any)?.neighbourhoodStatsVersion || 0) < NEIGHBOURHOOD_STATS_VERSION;
		const wantsMunicipalityRefresh =
			kind === 'neighbourhood' &&
			!String((existing as any)?.neighbourhoodStats?.municipality || (existing as any)?.neighbourhoodGeo?.municipality || '').trim();
		const wantsListingsRefresh =
			kind === 'neighbourhood' &&
			typeof (existing as any)?.neighbourhoodStats?.listingCount === 'number' &&
			Number((existing as any).neighbourhoodStats.listingCount) > 0 &&
			(!Array.isArray((existing as any)?.neighbourhoodListings) || (existing as any).neighbourhoodListings.length === 0);
		const wantsGeoOverrideRefresh = (() => {
			if (kind !== 'neighbourhood') return false;
			const title = stripGuideSuffix(String(page?.title || ''));
			const override = NEIGHBOURHOOD_GEO_OVERRIDES[slugify(title || '')] || null;
			if (!override) return false;
			return !geoOverrideMatches((existing as any)?.neighbourhoodGeo || null, override);
		})();

		const due = force
			? true
			: kind === 'area'
				? isDueStats(existing, now, { dueKey: 'areaStatsDueAt', updatedKey: 'areaStatsUpdatedAt', maxAgeMs: STATS_CACHE_MS })
				: wantsGeoOverrideRefresh ||
					wantsMunicipalityRefresh ||
					needsVersionRefresh ||
					wantsListingsRefresh ||
					isDueStats(existing, now, {
						dueKey: 'neighbourhoodStatsDueAt',
						updatedKey: 'neighbourhoodStatsUpdatedAt',
						maxAgeMs: STATS_CACHE_MS,
					});
		if (!due) return { ok: true, updated: false, skipped: true, key: rawKey };

		if (kind === 'area') {
			if (!idKey) return { ok: true, updated: false, skipped: true, key: rawKey };
			await setKbMeta(idKey, { areaStatsUpdatedAt: nowIso, areaStatsDueAt: nextDueIso });
			return { ok: true, updated: true, skipped: false, key: rawKey, updatedKey: idKey };
		}

		if (!idKey) return { ok: true, updated: false, skipped: true, key: rawKey };

		const currentMeta = await getKbMeta(idKey).catch(() => ({} as any));
		const rawGeo: any = currentMeta?.neighbourhoodGeo || (existing as any)?.neighbourhoodGeo || null;
		let lat = typeof rawGeo?.lat === 'number' ? rawGeo.lat : Number(rawGeo?.lat);
		let lon = typeof rawGeo?.lon === 'number' ? rawGeo.lon : Number(rawGeo?.lon);
		let geoPatch: any = null;

		const title = stripGuideSuffix(String(page?.title || ''));
		const override = NEIGHBOURHOOD_GEO_OVERRIDES[slugify(title || '')] || null;
		const provinceHint =
			provinceHintFromTags((currentMeta as any)?.tags) ||
			provinceHintFromTags((existing as any)?.tags) ||
			(currentMeta?.neighbourhoodGeo?.region && !/^andaluc/i.test(String(currentMeta.neighbourhoodGeo.region))
				? String(currentMeta.neighbourhoodGeo.region)
				: null) ||
			'Málaga';

		const municipalityHint =
			(override ? override.municipality : '') ||
			String(currentMeta?.neighbourhoodGeo?.municipality || '').trim() ||
			String((existing as any)?.neighbourhoodGeo?.municipality || '').trim() ||
			'';

		if (override) {
			lat = override.lat;
			lon = override.lon;
			geoPatch = {
				lat,
				lon,
				placeName: title || undefined,
				municipality: override.municipality,
				region: override.region,
				country: 'Spain',
			};
		}

		if (
			!override &&
			(!Number.isFinite(lat) || !Number.isFinite(lon) || !String(rawGeo?.municipality || '').trim() || force) &&
			!geoPatch
		) {
			const query = [title || '', provinceHint || '', 'Andalucía', 'Spain'].filter(Boolean).join(', ');
			const hit = await geocodePlace(query).catch(() => null);
			if (hit) {
				lat = hit.lat;
				lon = hit.lon;
				const muni =
					String(hit.municipality || '').trim() || municipalityHint || municipalityFromCommaLocation(hit.displayName || '');
				geoPatch = {
					lat,
					lon,
					placeName: title || undefined,
					municipality: muni || undefined,
					region: provinceHint || 'Andalucía',
					country: 'Spain',
				};
			}
		}

		const climate = Number.isFinite(lat) && Number.isFinite(lon) ? await fetchClimate(lat, lon, now) : null;

		const prevStats: any = currentMeta?.neighbourhoodStats && typeof currentMeta.neighbourhoodStats === 'object' ? currentMeta.neighbourhoodStats : {};
		const nextStats: any = climate ? { ...prevStats, ...climate } : { ...prevStats };

		const pinMoved =
			!!geoPatch &&
			(Number(rawGeo?.lat) !== Number(geoPatch.lat) || Number(rawGeo?.lon) !== Number(geoPatch.lon));
		if (pinMoved) {
			// these all describe the old position - drop them so a lookup that fails this run
			// leaves a gap rather than the previous area's answer
			for (const k of [
				'nearestBeachName',
				'beachDistanceKm',
				'driveToBeachMin',
				'airportDistanceKm',
				'driveToMalagaAirportMin',
				'driveToMarbellaMin',
				'driveToPuertoBanusMin',
			]) {
				delete nextStats[k];
			}
		}

		const slug = (() => {
			return neighbourhoodSlugFromPath(pagePath);
		})();

		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			const MALAGA_AIRPORT = { lat: 36.6749, lon: -4.4991 };
			const MARBELLA = { lat: 36.5101, lon: -4.8853 };
			const PUERTO_BANUS = { lat: 36.487, lon: -4.952 };

			const airport = await osrmDrive(lat, lon, MALAGA_AIRPORT.lat, MALAGA_AIRPORT.lon).catch(() => null);
			if (airport) {
				nextStats.airportDistanceKm = Math.round(airport.distanceKm * 10) / 10;
				nextStats.driveToMalagaAirportMin = Math.round(airport.durationMin);
			}

			const marbella = await osrmDrive(lat, lon, MARBELLA.lat, MARBELLA.lon).catch(() => null);
			if (marbella) nextStats.driveToMarbellaMin = Math.round(marbella.durationMin);

			const banus = await osrmDrive(lat, lon, PUERTO_BANUS.lat, PUERTO_BANUS.lon).catch(() => null);
			if (banus) nextStats.driveToPuertoBanusMin = Math.round(banus.durationMin);

			const beach = nearestBeach(lat, lon);
			if (beach) {
				nextStats.nearestBeachName = beach.name;
				nextStats.beachDistanceKm = Math.round(beach.distanceKm * 10) / 10;
				const beachDrive = await osrmDrive(lat, lon, beach.lat, beach.lon).catch(() => null);
				if (beachDrive) nextStats.driveToBeachMin = Math.round(beachDrive.durationMin);
			}
		}

		let listings: any[] | null = null;
		if (slug) {
			const muni =
				String(nextStats?.municipality || '').trim() ||
				String(geoPatch?.municipality || '').trim() ||
				String(currentMeta?.neighbourhoodGeo?.municipality || '').trim() ||
				String((existing as any)?.neighbourhoodGeo?.municipality || '').trim() ||
				municipalityHint ||
				'';

			const candidates = [portalPathFor(slug, muni), portalPathFor(slug, null)].filter(Boolean);
			let portalMd: string | null = null;
			for (const p of candidates) {
				const md = await fetchPropertyListMarkdown(`https://propertylist.es${p}`).catch(() => null);
				if (!md) continue;
				const countMatch = md.match(/(\d[\d,]*)\s+results/i);
				const count = countMatch ? Number(String(countMatch[1]).replace(/[^\d]/g, '')) : NaN;
				const urls = parsePortalListingUrls(md);
				const hasItems = urls.length > 0 || (Number.isFinite(count) && count > 0);
				if (!hasItems) {
					portalMd = md;
					continue;
				}
				portalMd = md;
				break;
			}

			if (portalMd) {
				const countMatch = portalMd.match(/(\d[\d,]*)\s+results/i);
				const count = countMatch ? Number(String(countMatch[1]).replace(/[^\d]/g, '')) : NaN;
				if (Number.isFinite(count)) nextStats.listingCount = count;

				const urls = parsePortalListingUrls(portalMd);
				const topUrls = urls.slice(0, 4);
				const topListings: any[] = [];
				for (const u of topUrls) {
					const detailMd = await fetchPropertyListMarkdown(u).catch(() => null);
					if (!detailMd) continue;
					const parsed = parseListingFromMarkdown(detailMd);
					topListings.push({ url: u, ...parsed });
				}
				listings = topListings.filter((l) => l && l.url);

				const subareaCounts = new Map<string, number>();
				const municipalityCounts = new Map<string, number>();
				const typeCounts = new Map<string, number>();

				for (const l of listings) {
					const title = String(l?.title || '').trim();
					const typeMatch = title.match(/^(.+?)\s+for\s+/i);
					const propType = normalizePropType(typeMatch ? String(typeMatch[1] || '') : '');
					if (propType) inc(typeCounts, propType);

					const inMatch = title.match(/\bin\s+(.+?)\s*$/i);
					const locRaw = inMatch ? String(inMatch[1] || '').trim() : '';
					if (!locRaw) continue;
					const parts = locRaw.split(',').map((pt) => pt.trim()).filter(Boolean);
					if (parts.length >= 2) {
						const sub = parts[0];
						const muni = parts[1];
						if (sub && muni && sub.toLowerCase() !== muni.toLowerCase()) inc(subareaCounts, sub);
						if (muni) inc(municipalityCounts, muni);
					} else if (parts.length === 1) {
						inc(municipalityCounts, parts[0]);
					}
				}

				const municipality = topKeys(municipalityCounts, 1)[0] || null;
				const topSubareas = topKeys(subareaCounts, 4);
				if (municipality) nextStats.municipality = municipality;
				else if (!nextStats.municipality && muni) nextStats.municipality = muni;
				if (topSubareas.length) nextStats.topSubareas = topSubareas;
				if (typeCounts.size) {
					const total = [...typeCounts.values()].reduce((a, b) => a + b, 0) || 0;
					if (total) {
						const obj: Record<string, number> = {};
						for (const [k, v] of typeCounts.entries()) obj[k] = Math.round((v / total) * 100);
						nextStats.propertyTypeBreakdown = obj;
					}
				}

				const prices = listings.map((l) => Number(l?.priceEur)).filter((n) => Number.isFinite(n));
				const perM2 = listings
					.map((l) => (Number(l?.priceEur) && Number(l?.buildM2) ? Number(l.priceEur) / Number(l.buildM2) : NaN))
					.filter((n) => Number.isFinite(n));

				const medPrice = median(prices);
				if (typeof medPrice === 'number') nextStats.avgPriceEur = Math.round(medPrice);
				const medPerM2 = median(perM2);
				if (typeof medPerM2 === 'number') nextStats.pricePerM2Eur = Math.round(medPerM2);
				if (prices.length) {
					nextStats.priceMinEur = Math.min(...prices);
					nextStats.priceMaxEur = Math.max(...prices);
				}
				nextStats.sampleSize = listings.length;
			}
		}

		await setKbMeta(idKey, {
			neighbourhoodStats: nextStats,
			neighbourhoodStatsVersion: NEIGHBOURHOOD_STATS_VERSION,
			neighbourhoodStatsUpdatedAt: nowIso,
			neighbourhoodStatsDueAt: nextDueIso,
			neighbourhoodListings: listings ? listings : undefined,
			neighbourhoodGeo: geoPatch ? geoPatch : undefined,
		});
		return { ok: true, updated: true, skipped: false, key: rawKey, updatedKey: idKey };
	})();

	inflight.set(lockKey, p);
	try {
		return await p;
	} finally {
		inflight.delete(lockKey);
	}
};

export const refreshKbStatsForKey = async (key: string, opts?: { nowMs?: number; force?: boolean }) => {
	const now = Math.max(0, Number(opts?.nowMs) || Date.now());
	const snapshot = await getKbMetaSnapshot();
	return refreshKbStatsForKeyWithSnapshot(key, snapshot as any, { nowMs: now, force: Boolean(opts?.force) });
};

export const POST: APIRoute = async ({ request }) => {
	const token = readEnv('INFO_HUB_STATS_TOKEN') || readEnv('INFO_HUB_SCHEDULER_TOKEN') || '';
	if (!token) return json(501, { ok: false, error: 'not_configured' });
	if (getTokenFromRequest(request) !== token) return json(401, { ok: false, error: 'unauthorized' });

	let body: any = null;
	try {
		body = await request.json();
	} catch {}

	const now = Date.now();
	const nowIso = toIsoDate(now);
	const nextDueIso = toIsoDate(now + 30 * 24 * 60 * 60 * 1000);
	const force = Boolean(body?.force);
	const limit = Math.max(1, Math.min(500, Number(body?.limit) || 200));

	const snapshot = await getKbMetaSnapshot();
	const requestedKeys = Array.isArray(body?.keys) ? body.keys.map((k: any) => String(k || '').trim()).filter(Boolean) : [];
	const keys = (requestedKeys.length ? requestedKeys : Object.keys(snapshot)).slice(0, limit);

	let updated = 0;
	let skipped = 0;
	const updatedKeys: string[] = [];

	for (const key of keys) {
		const r = await refreshKbStatsForKeyWithSnapshot(key, snapshot as any, {
			nowMs: now,
			force,
			nextDueMs: now + 30 * 24 * 60 * 60 * 1000,
		});
		if (r.ok && r.updated && r.updatedKey) {
			updated += 1;
			updatedKeys.push(r.updatedKey);
		} else {
			skipped += 1;
		}
	}

	return json(200, { ok: true, updated, skipped, keys: updatedKeys });
};
