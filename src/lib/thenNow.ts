// Then & Now: pre-rendered aerial photos of each area guide from Spain's national
// mapping flights (IGN). Images and the manifest live in public/then-now/ and are built
// by scripts/then-now/gen.py (frames, era choice) and og.py (share cards).
// The images are gitignored - rebuild them with the scripts, never hand-edit.
import fs from 'node:fs';

export type ThenNowEra = {
	key: string;
	label: string;
	credit: string;
	year: number;
	src800: string;
	src1600: string;
};
export type ThenNowArea = {
	slug: string;
	name: string;
	groundWidthM: number;
	then: ThenNowEra[];
	now: ThenNowEra;
	og: { en: string | null; es: string | null };
};

type RawEra = { layer: string; en: string; es: string; credit: string };
type Raw = { areas: Record<string, { name: string; groundWidthM: number; eras: Record<string, RawEra> }> };

const THEN_ORDER = ['1956', '7080', '2000s'];
let manifest: Raw | null | undefined;
const load = (): Raw | null => {
	if (manifest !== undefined) return manifest;
	try {
		manifest = JSON.parse(fs.readFileSync('public/then-now/manifest.json', 'utf8')) as Raw;
	} catch {
		manifest = null;
	}
	return manifest;
};

// Same slug rule the generator uses: drop a bracketed suffix, strip accents, hyphenate.
export const thenNowSlug = (name: string): string =>
	String(name || '')
		.replace(/\s*\(.*?\)\s*/g, ' ')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

// The year a flight is labelled by: 1956 for the American flight, the start of the
// series for the 1970s-80s flights, the flight year for PNOA.
const eraYear = (layer: string): number => {
	const m = layer.match(/(\d{4})/);
	return m ? Number(m[1]) : 0;
};

// The share card for an area page (og:image), or null so callers fall back to the area photo.
export const thenNowOg = (nameOrSlug: string, lang: 'en' | 'es'): string | null => {
	const slug = thenNowSlug(nameOrSlug);
	const path = `/then-now/${slug}/og-${lang}.jpg`;
	return slug && fs.existsSync(`public${path}`) ? path : null;
};

export const thenNowFor = (nameOrSlug: string, lang: 'en' | 'es' = 'en'): ThenNowArea | null => {
	const data = load();
	if (!data) return null;
	const slug = thenNowSlug(nameOrSlug);
	const rec = data.areas[slug];
	if (!rec || !rec.eras.now) return null;
	const dir = `/then-now/${slug}`;
	const toEra = (key: string): ThenNowEra => {
		const e = rec.eras[key];
		return {
			key,
			label: lang === 'es' ? e.es : e.en,
			credit: e.credit,
			year: eraYear(e.layer),
			src800: `${dir}/${key}-800.webp`,
			src1600: `${dir}/${key}-1600.webp`,
		};
	};
	const then = THEN_ORDER.filter((k) => rec.eras[k] && fs.existsSync(`public${dir}/${k}-1600.webp`)).map(toEra);
	if (!then.length || !fs.existsSync(`public${dir}/now-1600.webp`)) return null;
	const og = (l: 'en' | 'es') => (fs.existsSync(`public${dir}/og-${l}.jpg`) ? `${dir}/og-${l}.jpg` : null);
	return { slug, name: rec.name, groundWidthM: rec.groundWidthM, then, now: toEra('now'), og: { en: og('en'), es: og('es') } };
};
