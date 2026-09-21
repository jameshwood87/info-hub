// Historical aerial tiles for the network map's Then & Now swipe (public/map/then-now.js).
// A proxy with a disk cache in front of IGN's WMS: only whitelisted flights, only tiles
// inside Spain, cached for good because the photographs never change. Keeps the page CSP
// unchanged, survives IGN slowdowns, and lets Cloudflare cache every tile as a .jpg.
// Licence: IGN, CC-BY 4.0 (Orden FOM/2807/2015); the map credits it on screen.
// The cache is pruned by scripts/then-now/prune-tiles.sh (cap 1 GB).
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const WMS = 'https://www.ign.es/wms/pnoa-historico';
const ERAS: Record<string, string> = {
	'1956': 'AMS_1956-1957',
	// 1981-86 drawn underneath fills the places the 1973-86 flight never covered.
	'7080': 'Nacional_1981-1986,Interministerial_1973-1986',
	'2004': 'PNOA2004',
};
const CACHE = path.resolve('var/cache/ign-tiles');
const R = 6378137;
const HALF = Math.PI * R;
// Spain including the Balearics and the Canaries, with generous edges.
const SPAIN = { w: -18.6, e: 4.7, s: 27.3, n: 44.0 };
const toLon = (mx: number) => (mx / R) * (180 / Math.PI);
const toLat = (my: number) => (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * (180 / Math.PI);
const IMG = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' };
const miss = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params }) => {
	const era = String(params.era || '');
	const layers = ERAS[era];
	const z = Number(params.z);
	const x = Number(params.x);
	const y = Number(params.y);
	const n = 2 ** z;
	if (!layers || ![z, x, y].every(Number.isInteger) || z < 10 || z > 18 || x < 0 || y < 0 || x >= n || y >= n) return miss(404);

	const size = (2 * HALF) / n;
	const minx = -HALF + x * size;
	const maxy = HALF - y * size;
	const miny = maxy - size;
	const maxx = minx + size;
	if (toLon(maxx) < SPAIN.w || toLon(minx) > SPAIN.e || toLat(maxy) < SPAIN.s || toLat(miny) > SPAIN.n) return miss(404);

	const file = path.join(CACHE, era, String(z), String(x), `${y}.jpg`);
	try {
		return new Response(await fs.promises.readFile(file), { headers: IMG });
	} catch {
		/* not cached yet */
	}
	const url = `${WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layers)}&STYLES=&SRS=EPSG:3857&BBOX=${minx},${miny},${maxx},${maxy}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
		const buf = Buffer.from(await res.arrayBuffer());
		if (!res.ok || buf[0] !== 0xff || buf[1] !== 0xd8) return miss(502);
		await fs.promises.mkdir(path.dirname(file), { recursive: true });
		await fs.promises.writeFile(file, buf).catch(() => undefined);
		return new Response(buf, { headers: IMG });
	} catch {
		return miss(504);
	}
};
