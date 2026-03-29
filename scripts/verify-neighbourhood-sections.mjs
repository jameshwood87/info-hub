const BASE = 'https://info.propertylist.es';

const REQUIRED = ['At a glance', 'Overview', 'Property market insights', 'Transport &amp; connectivity', 'Local tips', 'Buyers vs renters', 'Bottom line'];
const FORBIDDEN = ['Amenities & daily living', 'Ideal for', 'For buyers', 'For renters', 'Sources', 'Map of ', 'Property types (current listing sample)'];

const fetchText = async (url) => {
	const res = await fetch(url);
	const t = await res.text();
	return { status: res.status, text: t };
};

const main = async () => {
	const sitemap = await fetchText(`${BASE}/sitemap.xml`);
	if (sitemap.status !== 200) {
		process.stderr.write(`failed to fetch sitemap: ${sitemap.status}\n`);
		process.exit(1);
	}
	const urls = Array.from(sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
	const nh = urls.filter((u) => u.includes('/neighbourhood/andalucia/') && u.endsWith('/'));
	const uniq = Array.from(new Set(nh)).sort();

	const failures = [];
	for (const url of uniq) {
		const { status, text } = await fetchText(url);
		if (status !== 200) {
			failures.push({ url, reason: `status_${status}` });
			continue;
		}
		for (const r of REQUIRED) {
			if (!text.includes(r)) failures.push({ url, reason: `missing:${r}` });
		}
		for (const f of FORBIDDEN) {
			if (text.includes(f)) failures.push({ url, reason: `forbidden:${f}` });
		}
	}

	if (failures.length) {
		process.stdout.write(`failures ${failures.length}/${uniq.length}\n`);
		for (const f of failures) process.stdout.write(`${f.url}\t${f.reason}\n`);
		process.exit(2);
	}

	process.stdout.write(`ok ${uniq.length}/${uniq.length}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
