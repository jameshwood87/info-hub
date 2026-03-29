const url = process.argv[2];
const needleRaw = process.argv[3];
if (!url || !needleRaw) {
	process.stderr.write('usage: node scripts/find-url-snippet.mjs <url> <needle>\n');
	process.exit(1);
}

const needle = String(needleRaw).toLowerCase();

const main = async () => {
	const res = await fetch(url, { headers: { 'User-Agent': 'InfoHub-Debug/1.0' } });
	const text = await res.text();
	const hay = text.toLowerCase();
	const idx = hay.indexOf(needle);
	process.stdout.write(`status ${res.status}\n`);
	if (idx < 0) {
		process.stdout.write('not_found\n');
		return;
	}
	const start = Math.max(0, idx - 500);
	const end = Math.min(text.length, idx + needle.length + 500);
	process.stdout.write(text.slice(start, end));
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

