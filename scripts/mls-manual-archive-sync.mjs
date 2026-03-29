import fs from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT = '20250621075840';
const LIVE_ORIGIN = 'https://info.propertylist.es';
const ARCHIVE_ORIGIN = `https://web.archive.org/web/${SNAPSHOT}id_/${LIVE_ORIGIN}`;
const INDEX_PATH = '/docs/propertylist-mls-user-manual/';

const projectRoot = path.resolve(process.cwd());
const outJsonPath = path.join(projectRoot, 'src', 'data', 'mls-manual-archive.json');
const outReportPath = path.join(projectRoot, 'mls-manual-audit.md');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url, maxTries = 3) => {
	let lastErr = null;
	for (let i = 0; i < maxTries; i++) {
		try {
			const res = await fetch(url, {
				redirect: 'follow',
				signal: AbortSignal.timeout(45000),
				headers: {
					'User-Agent': 'PropertyList-InfoHub-Audit/1.0',
					Accept: 'text/html,application/xhtml+xml',
				},
			});
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return await res.text();
		} catch (e) {
			lastErr = e;
			await sleep(400 * (i + 1));
		}
	}
	throw lastErr || new Error(`fetch failed: ${url}`);
};

const unique = (arr) => Array.from(new Set(arr));

const extractPathsFromHtml = (html) => {
	const out = [];
	const re = /href\s*=\s*["']([^"']+)["']/gi;
	let m = null;
	while ((m = re.exec(html))) {
		const href = String(m[1] || '').trim();
		if (!href) continue;
		if (href.startsWith(LIVE_ORIGIN)) {
			try {
				const u = new URL(href);
				out.push(u.pathname);
			} catch {}
			continue;
		}
		if (href.startsWith('/')) out.push(href);
	}
	return out;
};

const normalisePath = (p) => {
	try {
		const u = new URL(p, LIVE_ORIGIN);
		const pn = u.pathname || '/';
		return pn.endsWith('/') ? pn : `${pn}/`;
	} catch {
		return null;
	}
};

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ');
const tidyText = (s) =>
	stripTags(s)
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const pickFirst = (html, patterns) => {
	for (const re of patterns) {
		const m = String(html || '').match(re);
		if (!m) continue;
		if (m[1]) return m[1];
		if (m[0]) return m[0];
	}
	return null;
};

const pickLargestGroup = (html, re) => {
	const s = String(html || '');
	let best = null;
	let bestLen = 0;
	let m = null;
	while ((m = re.exec(s))) {
		const candidate = m[1] ? String(m[1]) : '';
		const len = tidyText(candidate).length;
		if (len > bestLen) {
			bestLen = len;
			best = candidate;
		}
	}
	return best;
};

const removeCruft = (html) => {
	let out = String(html || '');
	out = out
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<(meta|link)\b[^>]*>/gi, '')
		.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<form\b[\s\S]*?<\/form>/gi, '')
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
	return out;
};

const extractDocBodyFromArchive = (archiveHtml) => {
	const raw = String(archiveHtml || '');
	const candidate = pickFirst(raw, [
		/<article\b[\s\S]*?<\/article>/i,
		/<main\b[\s\S]*?<\/main>/i,
		/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
	]);
	const body = removeCruft(candidate || raw);
	const inner =
		pickLargestGroup(body, /<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi) ||
		pickLargestGroup(
			body,
			/<div\b[^>]*class=["'][^"']*\b(?:elementor-widget-container|wp-block-post-content|post-content|postContent)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
		) ||
		body;

	let out = String(inner || '');
	if (tidyText(out).length < 80) out = String(body || '');
	out = out
		.replace(/<img\b[^>]*>/gi, '')
		.replace(/<a\b[^>]*>\s*Sign\s*Up\s*FREE\s*<\/a>/gi, '')
		.replace(/\b\d+\s*Views?\b/gi, '')
		.replace(/Estimated\s+reading:\s*\d+\s*minutes?\b/gi, '')
		.replace(/Powered\s+By\s+PropertyList[\s\S]*?®/gi, '')
		.replace(/<p\b[^>]*>\s*(Leave a Comment|Recent Posts|Related Posts|Categories|Archives|Search)\b[\s\S]*?<\/p>/gi, '')
		.trim();

	const text = tidyText(out);
	if (!text) return null;
	return out;
};

const snapshotDate = SNAPSHOT.slice(0, 8);

const getBestWaybackTimestamp = async (fullUrl) => {
	const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(fullUrl)}&output=json&fl=timestamp,statuscode&filter=statuscode:200&collapse=digest&to=${snapshotDate}&limit=5`;
	try {
		const raw = await fetchText(cdx, 2);
		const json = JSON.parse(raw);
		if (!Array.isArray(json) || json.length < 2) return null;
		const last = json[json.length - 1];
		const ts = Array.isArray(last) ? last[0] : null;
		return typeof ts === 'string' && ts.length >= 8 ? ts : null;
	} catch {
		return null;
	}
};

const fetchArchiveBody = async (pathOnly) => {
	const full = `${LIVE_ORIGIN}${pathOnly}`;
	try {
		const html = await fetchText(`${ARCHIVE_ORIGIN}${pathOnly}`, 2);
		const body = extractDocBodyFromArchive(html);
		if (body && tidyText(body).length >= 80) return body;
	} catch {}

	const ts = await getBestWaybackTimestamp(full);
	if (!ts) return null;
	try {
		const html = await fetchText(`https://web.archive.org/web/${ts}id_/${full}`, 2);
		const body = extractDocBodyFromArchive(html);
		return body && tidyText(body).length >= 80 ? body : null;
	} catch {
		return null;
	}
};

const main = async () => {
	const liveIndexHtml = await fetchText(`${LIVE_ORIGIN}${INDEX_PATH}`);
	const paths = unique(
		extractPathsFromHtml(liveIndexHtml)
			.map(normalisePath)
			.filter(Boolean)
			.filter((p) => p.startsWith(INDEX_PATH)),
	).sort();

	const auditRows = [];
	const archiveMap = {};

	for (let i = 0; i < paths.length; i++) {
		const p = paths[i];
		process.stdout.write(`[${i + 1}/${paths.length}] ${p}\n`);
		let liveText = '';
		let looksPlaceholder = true;
		try {
			const liveHtml = await fetchText(`${LIVE_ORIGIN}${p}`);
			liveText = tidyText(liveHtml);
			looksPlaceholder = liveText.includes('Detailed documentation for') || /\bcoming soon\b/i.test(liveText);
		} catch {
			looksPlaceholder = true;
		}

		let archiveBody = null;
		let archiveOk = false;
		if (looksPlaceholder) {
			archiveBody = await fetchArchiveBody(p);
			archiveOk = Boolean(archiveBody && tidyText(archiveBody).length >= 80);
		}

		auditRows.push({
			path: p,
			live: looksPlaceholder ? 'placeholder/empty' : 'has content',
			archive: archiveOk ? 'found' : 'missing',
		});

		if (archiveOk) {
			archiveMap[p] = { body: archiveBody };
		}

		await sleep(1500);
	}

	await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
	await fs.writeFile(outJsonPath, JSON.stringify({ snapshot: SNAPSHOT, origin: LIVE_ORIGIN, pages: archiveMap }, null, 2), 'utf8');

	const md =
		`# MLS & CRM User Manual Audit\n\n` +
		`Source snapshot: ${ARCHIVE_ORIGIN}${INDEX_PATH}\n\n` +
		`## Pages\n\n` +
		`| Path | Live | Archive |\n|---|---|---|\n` +
		auditRows.map((r) => `| \`${r.path}\` | ${r.live} | ${r.archive} |`).join('\n') +
		`\n`;

	await fs.writeFile(outReportPath, md, 'utf8');

	const totals = {
		pages: auditRows.length,
		livePlaceholder: auditRows.filter((r) => r.live !== 'has content').length,
		archiveFound: auditRows.filter((r) => r.archive === 'found').length,
	};

	process.stdout.write(`${JSON.stringify(totals)}\n`);
};

main().catch((e) => {
	process.stderr.write(`${e?.stack || e}\n`);
	process.exit(1);
});
