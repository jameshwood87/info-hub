import fs from 'node:fs/promises';

const linksText = await fs.readFile(new URL('./extract-blog-links.mjs', import.meta.url)).catch(() => null);
if (!linksText) {
	console.error('Missing extract-blog-links.mjs');
	process.exit(1);
}

const listRes = await fetch('https://info.propertylist.es/blog/', { redirect: 'follow' });
const listHtml = await listRes.text();
const re = /href="(\/(?:blog|general-information)\/[^"#?]+\/?)"/g;
const paths = new Set();
let m = null;
while ((m = re.exec(listHtml))) {
	let p = (m[1] || '').trim();
	if (!p.endsWith('/')) p += '/';
	paths.add(p);
}

const origin = 'https://info.propertylist.es';
const results = [];
for (const p of [...paths].sort()) {
	const url = `${origin}${p}`;
	const html = await (await fetch(url, { redirect: 'follow' })).text();
	const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '';
	const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
	const isSvgHero = /\/blog\/hero-[a-z0-9-]+\.svg$/i.test(og);
	results.push({ path: p, title: h1, ogImage: og, needsFeatured: !og || isSvgHero });
}

console.log(JSON.stringify(results, null, 2));
