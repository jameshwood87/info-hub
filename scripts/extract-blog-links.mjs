const res = await fetch('https://info.propertylist.es/blog/', { redirect: 'follow' });
const html = await res.text();

const re = /href="(\/(?:blog|general-information)\/[^"#?]+\/?)"/g;
const out = new Set();
let m = null;
while ((m = re.exec(html))) {
	let p = m[1] || '';
	if (!p.endsWith('/')) p += '/';
	out.add(p);
}

process.stdout.write([...out].sort().join('\n'));
