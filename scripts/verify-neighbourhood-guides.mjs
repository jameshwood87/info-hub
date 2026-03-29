const BASE = 'https://info.propertylist.es';
const REQUIRED = 'Expect meaningful variation from one pocket to the next.';
const FORBIDDEN = 'Costa del Sol location where day-to-day practicality and resale confidence depend heavily';

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
		if (text.includes(FORBIDDEN)) failures.push({ url, reason: 'old_template_phrase_present' });
		if (!text.includes(REQUIRED)) failures.push({ url, reason: 'new_template_phrase_missing' });
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

