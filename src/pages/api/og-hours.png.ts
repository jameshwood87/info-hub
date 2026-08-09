// Dynamic OG card for /hours/ shares: the WhatsApp preview shows THEIR number.
// ?h=14 renders "14h a week lost to admin"; no h renders the generic card.
// SVG composed here, rasterised with sharp (already a dependency). WhatsApp and
// most platforms will not render SVG og:images, hence PNG.
import type { APIRoute } from 'astro';
import sharp from 'sharp';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async ({ url }) => {
	const h = Math.min(120, Math.max(0, parseInt(url.searchParams.get('h') || '0', 10) || 0));
	const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';

	const big = h ? `${h}h` : lang === 'es' ? '¿Cuántas?' : 'How many?';
	const line1 = h
		? lang === 'es' ? 'a la semana perdidas en papeleo' : 'a week lost to admin'
		: lang === 'es' ? 'horas a la semana pierdes en papeleo' : 'hours a week do you lose to admin?';
	const line2 = h
		? lang === 'es' ? '¿Tú cuántas pierdes?' : 'What do you lose?'
		: lang === 'es' ? 'Elige tu veneno y súmalo' : 'Pick your poison and add it up';

	const days = h ? Math.round((h * 46) / 8) : 0;
	const daysLine = h ? (lang === 'es' ? `= ${days} días de trabajo al año` : `= ${days} working days a year`) : '';

	const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
	<rect width="1200" height="630" fill="#0b1220"/>
	<circle cx="1060" cy="80" r="340" fill="#00ae9a" opacity="0.12"/>
	<circle cx="120" cy="600" r="260" fill="#00ae9a" opacity="0.08"/>
	<text x="90" y="120" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="8" fill="#00ae9a">PROPERTYLIST</text>
	<text x="90" y="330" font-family="Arial, Helvetica, sans-serif" font-size="${h ? 190 : 110}" font-weight="800" fill="#ffffff" letter-spacing="-6">${esc(big)}</text>
	<text x="90" y="410" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="600" fill="rgba(255,255,255,0.85)">${esc(line1)}</text>
	${daysLine ? `<text x="90" y="465" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#f97066">${esc(daysLine)}</text>` : ''}
	<text x="90" y="${h ? 555 : 520}" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="800" fill="#00ae9a">${esc(line2)} &#8594;</text>
	</svg>`;

	// flatten() drops the alpha channel: Meta refuses og:image PNGs that carry
	// one ("could not be processed as an image"). The background was already
	// opaque, so this is visually identical and just changes RGBA to RGB.
	const png = await sharp(Buffer.from(svg)).flatten({ background: '#0b1220' }).png().toBuffer();
	return new Response(new Uint8Array(png), {
		status: 200,
		headers: {
			'content-type': 'image/png',
			// declared so scrapers know the size before they decode; Astro would
			// otherwise stream this chunked with no length at all
			'content-length': String(png.byteLength),
			'cache-control': 'public, max-age=86400',
		},
	});
};
