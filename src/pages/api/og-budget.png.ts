// Dynamic OG card for /budget/ shares: the WhatsApp preview shows THEIR budget
// and the real stretch between the cheapest and dearest town, as two bars.
// ?b=500000&lang=es. SVG composed here, rasterised with sharp (WhatsApp and
// most platforms will not render SVG og:images, hence PNG).
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

type Town = { slug: string; name: string; m2eur: number };

let cached: { at: number; towns: Town[] } | null = null;
const loadTowns = async (): Promise<Town[]> => {
	if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.towns;
	for (const p of ['/opt/info-hub/var/admin/budget-data.json', 'var/admin/budget-data.json']) {
		try {
			const d = JSON.parse(await readFile(p, 'utf8'));
			if (Array.isArray(d.towns) && d.towns.length) {
				cached = { at: Date.now(), towns: d.towns };
				return d.towns;
			}
		} catch {}
	}
	return [];
};

export const GET: APIRoute = async ({ url }) => {
	const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
	const raw = parseInt(url.searchParams.get('b') || '0', 10) || 0;
	const b = raw >= 100000 && raw <= 10000000 ? raw : 500000;
	const towns = await loadTowns();

	const nf = (v: number) => v.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB');
	const eur = (v: number) => (lang === 'es' ? `${nf(v)} €` : `€${nf(v)}`);

	let svgBody = '';
	if (towns.length >= 2) {
		// towns arrive sorted cheapest EUR/m2 first
		const best = towns[0];
		const worst = towns[towns.length - 1];
		const bestSqm = Math.round(b / best.m2eur);
		const worstSqm = Math.round(b / worst.m2eur);
		const ratio = (worst.m2eur / best.m2eur).toFixed(1);
		const ratioStr = lang === 'es' ? ratio.replace('.', ',') : ratio;
		const w1 = 740;
		const w2 = Math.max(90, Math.round((worstSqm / bestSqm) * w1));
		const kick =
			lang === 'es'
				? `El mismo dinero. ${ratioStr}× más casa.`
				: `Same money. ${ratioStr}× more home.`;
		const cta = lang === 'es' ? 'Mira lo que compra el tuyo' : 'See what yours buys';
		svgBody = `
	<text x="90" y="235" font-family="Arial, Helvetica, sans-serif" font-size="120" font-weight="800" fill="#ffffff" letter-spacing="-4">${esc(eur(b))}</text>
	<rect x="90" y="285" width="${w1}" height="52" rx="26" fill="#00ae9a"/>
	<text x="${90 + w1 + 22}" y="322" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" fill="#ffffff">${esc(`${nf(bestSqm)}m²`)}</text>
	<text x="94" y="372" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="rgba(255,255,255,0.75)">${esc(best.name)}</text>
	<rect x="90" y="400" width="${w2}" height="52" rx="26" fill="#e8b04b"/>
	<text x="${90 + w2 + 22}" y="437" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" fill="#ffffff">${esc(`${nf(worstSqm)}m²`)}</text>
	<text x="94" y="487" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="rgba(255,255,255,0.75)">${esc(worst.name)}</text>
	<text x="90" y="560" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800" fill="#5be3d0">${esc(kick)}  →  ${esc(cta)}</text>`;
	} else {
		const line = lang === 'es' ? '¿Qué compra tu presupuesto de verdad?' : 'What does your budget actually buy?';
		svgBody = `<text x="90" y="330" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${esc(line)}</text>`;
	}

	const sub =
		lang === 'es' ? '14 pueblos de la Costa del Sol comparados' : '14 Costa del Sol towns compared';
	const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
	<rect width="1200" height="630" fill="#0d2b2e"/>
	<circle cx="1080" cy="70" r="330" fill="#00ae9a" opacity="0.10"/>
	<circle cx="100" cy="620" r="240" fill="#e8b04b" opacity="0.07"/>
	<text x="90" y="95" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" letter-spacing="8" fill="#00ae9a">PROPERTYLIST</text>
	<text x="1110" y="95" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="600" fill="rgba(255,255,255,0.5)">${esc(sub)}</text>
	${svgBody}
	</svg>`;

	// flatten() drops the alpha channel: Meta refuses og:image PNGs that carry
	// one ("could not be processed as an image"). The background was already
	// opaque, so this is visually identical and just changes RGBA to RGB.
	const png = await sharp(Buffer.from(svg)).flatten({ background: '#0d2b2e' }).png().toBuffer();
	return new Response(new Uint8Array(png), {
		status: 200,
		headers: {
			'content-type': 'image/png',
			// declared so scrapers know the size before they decode; Astro would
			// otherwise stream this chunked with no length at all
			'content-length': String(png.byteLength),
			'cache-control': 'public, max-age=3600',
		},
	});
};
