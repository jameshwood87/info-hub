// Area slug -> province mapping for /neighbourhood/ canonical URLs.
// Any slug not in the JSON map defaults to malaga (the historic default).
import overrides from '../data/area-provinces.json';

export const provinceForAreaSlug = (slug: string): string =>
	(overrides as Record<string, string>)[String(slug || '').toLowerCase()] || 'malaga';

export const canonicalAreaPath = (slug: string): string =>
	`/neighbourhood/spain/${provinceForAreaSlug(slug)}/${slug}/`;

export const AREA_PROVINCE_LABELS: Record<string, string> = {
	malaga: 'Málaga',
	cadiz: 'Cádiz',
	baleares: 'Islas Baleares',
	madrid: 'Madrid',
	almeria: 'Almería',
	granada: 'Granada',
	sevilla: 'Sevilla',
	cordoba: 'Córdoba',
	huelva: 'Huelva',
	jaen: 'Jaén',
};
