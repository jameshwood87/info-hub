const BASE = 'https://info.propertylist.es';

const PLACEHOLDER_MARKERS = ['Traducción en curso', 'Guía en español próximamente', 'Contenido en español próximamente', 'Abrir en inglés'];

const EN_WORDS = [
	'the',
	'and',
	'for',
	'with',
	'to',
	'from',
	'this',
	'that',
	'you',
	'your',
	'are',
	'not',
	'guide',
	'neighbourhood',
	'market',
	'buyers',
	'renters',
];
const ES_WORDS = [
	'de',
	'la',
	'el',
	'y',
	'para',
	'con',
	'este',
	'esta',
	'que',
	'tu',
	'tus',
	'guía',
	'barrio',
	'mercado',
	'compradores',
	'inquilinos',
];

const countWords = (text, words) => {
	const t = String(text || '').toLowerCase();
	let n = 0;
	for (const w of words) {
		const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g');
		const m = t.match(re);
		if (m) n += m.length;
	}
	return n;
};

const looksEnglish = (html) => {
	const text = String(html || '').replace(/<[^>]*>/g, ' ');
	const en = countWords(text, EN_WORDS);
	const es = countWords(text, ES_WORDS);
	if (es === 0 && en > 0) return true;
	return en >= es * 1.8 && en >= 25;
};

const fetchText = async (url) => {
	const res = await fetch(url, { redirect: 'manual' });
	const text = await res.text();
	return { status: res.status, text, headers: res.headers };
};

const main = async () => {
	const sitemap = await fetchText(`${BASE}/sitemap.xml`);
	if (sitemap.status !== 200) {
		process.stderr.write(`failed to fetch sitemap: ${sitemap.status}\n`);
		process.exit(1);
	}

	const urls = Array.from(sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
	const esUrls = Array.from(new Set(urls.filter((u) => u.startsWith(`${BASE}/es/`) && u.endsWith('/')))).sort();

	const failures = [];
	for (const url of esUrls) {
		const { status, text } = await fetchText(url);
		if (status !== 200) {
			failures.push({ url, reason: `status_${status}` });
			continue;
		}
		if (!text.includes('<html lang="es"')) failures.push({ url, reason: 'html_lang_not_es' });
		for (const m of PLACEHOLDER_MARKERS) {
			if (text.includes(m)) failures.push({ url, reason: `placeholder:${m}` });
		}
		if (looksEnglish(text)) failures.push({ url, reason: 'looks_english' });
	}

	if (failures.length) {
		process.stdout.write(`failures ${failures.length}/${esUrls.length}\n`);
		for (const f of failures) process.stdout.write(`${f.url}\t${f.reason}\n`);
		process.exit(2);
	}

	process.stdout.write(`ok ${esUrls.length}/${esUrls.length}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

