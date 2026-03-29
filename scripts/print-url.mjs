const url = process.argv[2];
if (!url) {
	process.stderr.write('usage: node scripts/print-url.mjs <url>\n');
	process.exit(1);
}

const main = async () => {
	const res = await fetch(url, { headers: { 'User-Agent': 'InfoHub-Debug/1.0' }, redirect: 'manual' });
	const text = await res.text();
	process.stdout.write(`status ${res.status}\n`);
	process.stdout.write(`finalUrl ${res.url}\n`);
	process.stdout.write(`location ${res.headers.get('location') || ''}\n`);
	process.stdout.write(text.slice(0, 2000));
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
