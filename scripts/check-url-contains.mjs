const url = process.argv[2] || '';
const needle = process.argv[3] || '';
if (!url || !needle) {
	process.stdout.write('usage: node check-url-contains.mjs <url> <needle>\n');
	process.exit(2);
}

const main = async () => {
	const res = await fetch(url);
	const t = await res.text().catch(() => '');
	const ok = t.includes(needle);
	process.stdout.write(`${ok ? 'found' : 'not_found'}\n`);
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

