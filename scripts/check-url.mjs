const url = process.argv[2] || '';
if (!url) {
	process.stdout.write('missing url\n');
	process.exit(2);
}

const main = async () => {
	const res = await fetch(url, { redirect: 'manual' });
	process.stdout.write(`status ${res.status}\n`);
	const loc = res.headers.get('location') || '';
	if (loc) process.stdout.write(`location ${loc}\n`);
	const t = await res.text().catch(() => '');
	process.stdout.write(`${t.slice(0, 200).replace(/\s+/g, ' ').trim()}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

