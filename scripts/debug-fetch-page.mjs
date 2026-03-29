const url = process.argv[2];
if (!url) {
	process.stderr.write('missing_url\n');
	process.exit(1);
}

const main = async () => {
	const res = await fetch(url, { headers: { 'User-Agent': 'InfoHub-Debug/1.0' } });
	const text = await res.text();
	const textOnly = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const needles = [
		'Welcome to the PropertyList',
		'What is PropertyList',
		'PropertyList is designed to be easy to use',
		'class="docContent"',
		'class="docTitle"',
		'docLead',
		'shortcode_info',
		'doc-post-content',
		'entry-content',
		'<img',
	];
	const idx = Math.max(0, text.indexOf('doc-post-content'));
	const excerpt = idx ? text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 600)) : '';
	const imgMatches = [...text.matchAll(/<img\b[^>]*>/gi)].slice(0, 25);
	const imgDetails = imgMatches.map((m) => {
		const tag = m[0];
		const start = m.index || 0;
		const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || null;
		const dataSrc = (tag.match(/\bdata-(?:src|lazy-src|original)=["']([^"']+)["']/i) || [])[1] || null;
		const context = text.slice(Math.max(0, start - 120), Math.min(text.length, start + tag.length + 120));
		return { src, dataSrc, context };
	});
	const imgSrcs = imgDetails.map((d) => d.src).filter(Boolean);
	const imgPreview = imgSrcs.slice(0, 10);
	process.stdout.write(
		JSON.stringify(
			{
				status: res.status,
				len: text.length,
				cache: {
					age: res.headers.get('age'),
					cacheControl: res.headers.get('cache-control'),
					cfCacheStatus: res.headers.get('cf-cache-status'),
					etag: res.headers.get('etag'),
					xCache: res.headers.get('x-cache'),
					via: res.headers.get('via'),
					server: res.headers.get('server'),
					cfRay: res.headers.get('cf-ray'),
				},
				imgCount: imgSrcs.length,
				imgPreview,
				imgDetails,
				found: Object.fromEntries(needles.map((n) => [n, text.includes(n)])),
				foundTextOnly: {
					Welcome: /welcome/i.test(textOnly),
					PropertyList: /propertylist/i.test(textOnly),
					WhatIs: /what is propertylist/i.test(textOnly),
					NoInstallation: /no installation required/i.test(textOnly),
					MobileOptimised: /mobile[- ]optim/i.test(textOnly),
				},
				excerpt,
			},
			null,
			2,
		),
	);
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
