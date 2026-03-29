const url = process.argv[2] || '';
const needle = process.argv[3] || '';
const retries = Math.max(1, Math.min(10, Number(process.argv[4] || 5)));
const waitMs = Math.max(0, Math.min(30_000, Number(process.argv[5] || 2000)));

if (!url || !needle) {
	process.stdout.write('usage: node check-url-contains-retry.mjs <url> <needle> [retries] [waitMs]\n');
	process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
	for (let i = 0; i < retries; i++) {
		const res = await fetch(url);
		const t = await res.text().catch(() => '');
		const ok = t.includes(needle);
		process.stdout.write(`${ok ? 'found' : 'not_found'} attempt=${i + 1}/${retries}\n`);
		if (ok) return;
		if (i < retries - 1) await sleep(waitMs);
	}
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});

