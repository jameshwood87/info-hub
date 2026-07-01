// Geography model for area guides: country -> region -> area.
// Extensible: add a country to COUNTRIES and its regions to REGIONS to grow coverage.
// Drive-time anchors generalise the (previously Malaga-hardcoded) neighbourhood stats.

export type DriveAnchor = { key: string; label: string; lat: number; lon: number; kind: 'airport' | 'hub' };

export type Region = {
	key: string;
	label: string;
	labelEs?: string;
	country: string;
	geocodeHint: string;
	driveAnchors: DriveAnchor[];
};

export type Country = { key: string; label: string; labelEs: string; regions: string[] };

export const COUNTRIES: Record<string, Country> = {
	spain: {
		key: 'spain',
		label: 'Spain',
		labelEs: 'España',
		regions: ['malaga', 'cadiz', 'granada', 'almeria', 'sevilla', 'cordoba', 'huelva', 'jaen'],
	},
	portugal: {
		key: 'portugal',
		label: 'Portugal',
		labelEs: 'Portugal',
		regions: ['lisbon', 'porto', 'faro'],
	},
};

// Common Andalucía anchor: Málaga Airport (AGP) is the Costa del Sol gateway.
const AGP: DriveAnchor = { key: 'agp', label: 'Málaga Airport', lat: 36.6749, lon: -4.4991, kind: 'airport' };

export const REGIONS: Record<string, Region> = {
	// ---- Spain (Andalucía) ----
	malaga: {
		key: 'malaga',
		label: 'Málaga',
		country: 'spain',
		geocodeHint: 'Málaga, Andalucía, Spain',
		driveAnchors: [
			AGP,
			{ key: 'marbella', label: 'Marbella', lat: 36.5101, lon: -4.8853, kind: 'hub' },
			{ key: 'banus', label: 'Puerto Banús', lat: 36.487, lon: -4.952, kind: 'hub' },
		],
	},
	cadiz: {
		key: 'cadiz',
		label: 'Cádiz',
		country: 'spain',
		geocodeHint: 'Cádiz, Andalucía, Spain',
		driveAnchors: [AGP, { key: 'jerez', label: 'Jerez Airport', lat: 36.7446, lon: -6.0601, kind: 'airport' }],
	},
	granada: {
		key: 'granada',
		label: 'Granada',
		country: 'spain',
		geocodeHint: 'Granada, Andalucía, Spain',
		driveAnchors: [{ key: 'grx', label: 'Granada Airport', lat: 37.1887, lon: -3.7776, kind: 'airport' }, AGP],
	},
	almeria: {
		key: 'almeria',
		label: 'Almería',
		country: 'spain',
		geocodeHint: 'Almería, Andalucía, Spain',
		driveAnchors: [{ key: 'lei', label: 'Almería Airport', lat: 36.8439, lon: -2.3701, kind: 'airport' }],
	},
	sevilla: {
		key: 'sevilla',
		label: 'Sevilla',
		country: 'spain',
		geocodeHint: 'Sevilla, Andalucía, Spain',
		driveAnchors: [{ key: 'svq', label: 'Sevilla Airport', lat: 37.418, lon: -5.8931, kind: 'airport' }],
	},
	cordoba: {
		key: 'cordoba',
		label: 'Córdoba',
		country: 'spain',
		geocodeHint: 'Córdoba, Andalucía, Spain',
		driveAnchors: [{ key: 'svq', label: 'Sevilla Airport', lat: 37.418, lon: -5.8931, kind: 'airport' }],
	},
	huelva: {
		key: 'huelva',
		label: 'Huelva',
		country: 'spain',
		geocodeHint: 'Huelva, Andalucía, Spain',
		driveAnchors: [{ key: 'svq', label: 'Sevilla Airport', lat: 37.418, lon: -5.8931, kind: 'airport' }],
	},
	jaen: {
		key: 'jaen',
		label: 'Jaén',
		country: 'spain',
		geocodeHint: 'Jaén, Andalucía, Spain',
		driveAnchors: [{ key: 'grx', label: 'Granada Airport', lat: 37.1887, lon: -3.7776, kind: 'airport' }],
	},
	// ---- Portugal ----
	lisbon: {
		key: 'lisbon',
		label: 'Lisbon',
		labelEs: 'Lisboa',
		country: 'portugal',
		geocodeHint: 'Lisbon, Portugal',
		driveAnchors: [
			{ key: 'lis', label: 'Lisbon Airport', lat: 38.7742, lon: -9.1342, kind: 'airport' },
			{ key: 'cascais', label: 'Cascais', lat: 38.6979, lon: -9.4215, kind: 'hub' },
		],
	},
	porto: {
		key: 'porto',
		label: 'Porto',
		country: 'portugal',
		geocodeHint: 'Porto, Portugal',
		driveAnchors: [{ key: 'opo', label: 'Porto Airport', lat: 41.2481, lon: -8.6814, kind: 'airport' }],
	},
	faro: {
		key: 'faro',
		label: 'Algarve (Faro)',
		labelEs: 'Algarve (Faro)',
		country: 'portugal',
		geocodeHint: 'Faro, Algarve, Portugal',
		driveAnchors: [{ key: 'fao', label: 'Faro Airport', lat: 37.0144, lon: -7.9659, kind: 'airport' }],
	},
};

// Map an MCP province name (from search_properties / autocomplete_location) to a region key.
const PROVINCE_TO_REGION: Record<string, string> = {
	malaga: 'malaga',
	málaga: 'malaga',
	cadiz: 'cadiz',
	cádiz: 'cadiz',
	granada: 'granada',
	almeria: 'almeria',
	almería: 'almeria',
	sevilla: 'sevilla',
	seville: 'sevilla',
	cordoba: 'cordoba',
	córdoba: 'cordoba',
	huelva: 'huelva',
	jaen: 'jaen',
	jaén: 'jaen',
	lisboa: 'lisbon',
	lisbon: 'lisbon',
	porto: 'porto',
	oporto: 'porto',
	faro: 'faro',
	algarve: 'faro',
};

export const regionFromProvince = (province: string): Region | null => {
	const k = String(province || '')
		.trim()
		.toLowerCase();
	if (!k) return null;
	const rk = PROVINCE_TO_REGION[k] || '';
	return rk ? REGIONS[rk] || null : null;
};

export const countryOfRegion = (regionKey: string): Country | null => {
	const r = REGIONS[regionKey];
	return r ? COUNTRIES[r.country] || null : null;
};

export const getRegion = (regionKey: string): Region | null => REGIONS[regionKey] || null;
export const getCountry = (countryKey: string): Country | null => COUNTRIES[countryKey] || null;
