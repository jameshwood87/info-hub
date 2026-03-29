import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());

const argValue = (flag) => {
	const idx = process.argv.indexOf(flag);
	if (idx < 0) return null;
	return process.argv[idx + 1] || null;
};

const hasFlag = (flag) => process.argv.includes(flag);

const defaultArchivePath = path.join(projectRoot, 'src', 'data', 'mls-manual-archive.json');
const archivePath = argValue('--archive') ? path.resolve(projectRoot, argValue('--archive')) : defaultArchivePath;
const reportPath = argValue('--report')
	? path.resolve(projectRoot, argValue('--report'))
	: path.join(projectRoot, 'docs-duplicate-subheadings-report.md');

const crawlLive = hasFlag('--crawl-live');
const crawlOrigin = (argValue('--origin') || 'https://info.propertylist.es').replace(/\/+$/, '');
const crawlStart = argValue('--crawl-start') || '/docs/';
const crawlPrefixRaw = argValue('--crawl-prefix') || '/docs/';
const crawlCapRaw = argValue('--crawl-cap');
const crawlCap = Number.isFinite(Number(crawlCapRaw)) ? Number(crawlCapRaw) : 1500;
const crawlDelayMsRaw = argValue('--crawl-delay-ms');
const crawlDelayMs = Number.isFinite(Number(crawlDelayMsRaw)) ? Number(crawlDelayMsRaw) : 60;

const fix = hasFlag('--fix');
const fixParagraphs = hasFlag('--fix-paragraphs') || fix;

const decodeEntities = (s) => {
	let out = String(s || '');
	const named = {
		nbsp: ' ',
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		apos: "'",
	};
	out = out.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (_m, g1) => {
		const v = String(g1 || '');
		if (v.startsWith('#x')) {
			const cp = Number.parseInt(v.slice(2), 16);
			return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
		}
		if (v.startsWith('#')) {
			const cp = Number.parseInt(v.slice(1), 10);
			return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
		}
		const hit = named[v.toLowerCase()];
		return hit != null ? hit : '';
	});
	return out;
};

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ');

const normText = (s) =>
	decodeEntities(stripTags(s))
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const escapeHtml = (s) =>
	String(s || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const titleFromPath = (p) => {
	const parts = String(p || '')
		.split('/')
		.filter(Boolean);
	const seg = parts[parts.length - 1] || '';
	return seg
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(' ');
};

const walkDir = async (dir) => {
	const out = [];
	let entries = [];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const ent of entries) {
		const fp = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...(await walkDir(fp)));
		else if (ent.isFile() && fp.toLowerCase().endsWith('.json')) out.push(fp);
	}
	return out;
};

const extractPathsFromHtml = (html) => {
	const out = [];
	const re = /href\s*=\s*["']([^"']+)["']/gi;
	let m = null;
	while ((m = re.exec(String(html || '')))) {
		const href = String(m[1] || '').trim();
		if (!href) continue;
		if (href.startsWith('#')) continue;
		if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
		if (href.startsWith('javascript:')) continue;
		if (href.startsWith(crawlOrigin)) {
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
		const u = new URL(p, crawlOrigin);
		const pn = u.pathname || '/';
		if (pn === '/') return '/';
		return pn.endsWith('/') ? pn : `${pn}/`;
	} catch {
		return null;
	}
};

const extractMainFromHtml = (html) => {
	const m = String(html || '').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	return m && m[1] ? String(m[1]) : String(html || '');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url, maxTries = 3) => {
	let lastErr = null;
	for (let i = 0; i < maxTries; i++) {
		try {
			const res = await fetch(url, {
				redirect: 'follow',
				signal: AbortSignal.timeout(45000),
				headers: { Accept: 'text/html,application/xhtml+xml' },
			});
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return await res.text();
		} catch (e) {
			lastErr = e;
			await sleep(250 * (i + 1));
		}
	}
	throw lastErr || new Error(`fetch failed: ${url}`);
};

const extractHtmlHeadings = (html) => {
	const out = [];
	const s = String(html || '');
	const re = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m = null;
	let idx = 0;
	while ((m = re.exec(s))) {
		idx += 1;
		const level = Number(m[1] || 0);
		const rawInner = String(m[2] || '');
		const text = normText(rawInner);
		out.push({
			kind: `h${level}`,
			text,
			rawInner,
			index: idx,
		});
	}
	return out;
};

const extractStrongLeads = (html) => {
	const out = [];
	const s = String(html || '');
	const re = /<p\b[^>]*>\s*<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>\s*(:)?/gi;
	let m = null;
	let idx = 0;
	while ((m = re.exec(s))) {
		const raw = String(m[2] || '');
		const hadColon = Boolean(m[3]);
		const text = normText(raw).replace(/:$/, '');
		if (!hadColon) continue;
		if (!text) continue;
		const words = text.split(' ').filter(Boolean);
		if (words.length > 10) continue;
		if (text.length > 80) continue;
		idx += 1;
		out.push({
			kind: 'strong',
			text,
			rawInner: raw,
			index: idx,
		});
	}
	return out;
};

const extractParagraphs = (html) => {
	const out = [];
	const s = String(html || '');
	const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
	let m = null;
	let idx = 0;
	while ((m = re.exec(s))) {
		idx += 1;
		const rawInner = String(m[1] || '');
		const text = normText(rawInner);
		if (!text) continue;
		out.push({ text, rawInner, index: idx });
	}
	return out;
};

const isComingSoon = (t) => {
	const s = String(t || '')
		.replace(/[–—-]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
	return s === 'coming soon' || s === 'coming soon:' || s === 'coming soon!';
};

const proposeUniqueHeading = ({ baseText, pagePath, occurrenceIndex }) => {
	const t = String(baseText || '').trim();
	if (!t) return '';
	if (isComingSoon(t)) {
		const title = titleFromPath(pagePath);
		return title ? `Coming soon: ${title}` : 'Coming soon';
	}
	if (occurrenceIndex === 2) return `${t} (continued)`;
	return `${t} (${occurrenceIndex})`;
};

const auditDuplicatesInList = ({ items, keyOf }) => {
	const byKey = new Map();
	for (const it of items) {
		const key = keyOf(it);
		if (!key) continue;
		const arr = byKey.get(key) || [];
		arr.push(it);
		byKey.set(key, arr);
	}
	const dups = [];
	for (const [key, arr] of byKey.entries()) {
		if (arr.length < 2) continue;
		dups.push({ key, items: arr });
	}
	return dups;
};

const severityFor = ({ scope, count }) => {
	if (scope === 'within_page') return 'high';
	if (count >= 10) return 'medium';
	return 'low';
};

const loadArchivePages = async (fp) => {
	const raw = await fs.readFile(fp, 'utf8');
	const json = JSON.parse(raw);
	const pages = json?.pages && typeof json.pages === 'object' ? json.pages : {};
	const out = [];
	for (const [p, v] of Object.entries(pages)) {
		const body = typeof v?.body === 'string' ? v.body : '';
		out.push({ source: fp, pagePath: String(p), body });
	}
	return out;
};

const loadVersionPages = async (versionsDir) => {
	const files = await walkDir(versionsDir);
	const out = [];
	for (const fp of files) {
		let raw = '';
		try {
			raw = await fs.readFile(fp, 'utf8');
		} catch {
			continue;
		}
		let json = null;
		try {
			json = JSON.parse(raw);
		} catch {
			continue;
		}
		const page = json?.page || null;
		if (!page) continue;
		const lang = String(page.language || '');
		const p = String(page.path || '');
		if (lang !== 'en') continue;
		if (!p.startsWith('/docs/')) continue;
		out.push({ source: fp, pagePath: p, body: String(page.body || '') });
	}
	return out;
};

const crawlLiveDocs = async () => {
	const start = normalisePath(crawlStart) || '/docs/';
	const crawlPrefix = normalisePath(crawlPrefixRaw) || '/docs/';
	if (!start.startsWith(crawlPrefix)) return [];
	const queue = [start];
	const seen = new Set(queue);
	const docs = [];

	while (queue.length && docs.length < crawlCap) {
		const p = queue.shift();
		if (!p) break;
		const url = `${crawlOrigin}${p}`;

		let html = '';
		try {
			html = await fetchText(url, 2);
		} catch {
			continue;
		}

		const main = extractMainFromHtml(html);
		docs.push({ source: `live:${crawlOrigin}`, pagePath: p, body: main });

		const links = extractPathsFromHtml(html)
			.map(normalisePath)
			.filter(Boolean)
			.filter((x) => x.startsWith(crawlPrefix) && !x.startsWith('/docs/admin/'));

		for (const lp of links) {
			if (seen.has(lp)) continue;
			seen.add(lp);
			queue.push(lp);
		}

		if (crawlDelayMs > 0) await sleep(crawlDelayMs);
	}

	return docs;
};

const fixArchiveBody = ({ body, pagePath }) => {
	let next = String(body || '');

	next = next.replace(/<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (_full, level, attrs, inner) => {
		const text = normText(inner);
		if (!text) return '';
		const cleaned = text.replace(/\s+/g, ' ').trim();
		if (!cleaned) return '';
		const finalText = isComingSoon(cleaned) ? proposeUniqueHeading({ baseText: cleaned, pagePath, occurrenceIndex: 1 }) : cleaned;
		return `<h${level}${attrs}>${escapeHtml(finalText)}</h${level}>`;
	});

	if (fixParagraphs) {
		const seen = new Set();
		next = next.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
			const text = normText(inner);
			const key = text;
			if (!text) return '';
			const isDupe = seen.has(key);
			seen.add(key);
			if (!isDupe) return full;
			if (text.length < 40) return full;
			return '';
		});
	}

	{
		const seen = new Map();
		next = next.replace(/<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level, attrs, inner) => {
			const text = normText(inner);
			if (!text) return '';
			const count = (seen.get(text) || 0) + 1;
			seen.set(text, count);
			if (count === 1) return full;
			const replacement = proposeUniqueHeading({ baseText: text, pagePath, occurrenceIndex: count });
			return `<h${level}${attrs}>${escapeHtml(replacement)}</h${level}>`;
		});
	}

	{
		const seen = new Map();
		next = next.replace(/<p\b([^>]*)>\s*<(strong|b)\b([^>]*)>([\s\S]*?)<\/\2>\s*:(\s*)/gi, (full, pAttrs, tag, strongAttrs, inner, tailSpace) => {
			const text = normText(inner);
			if (!text) return full;
			const count = (seen.get(text) || 0) + 1;
			seen.set(text, count);
			if (count === 1) return full;
			const replacement = proposeUniqueHeading({ baseText: text, pagePath, occurrenceIndex: count });
			return `<p${pAttrs}><${tag}${strongAttrs}>${escapeHtml(replacement)}</${tag}>:${tailSpace}`;
		});
	}

	return next.replace(/\n{3,}/g, '\n\n').trim();
};

const main = async () => {
	const docs = [];
	const archiveExists = await fs
		.access(archivePath)
		.then(() => true)
		.catch(() => false);
	if (archiveExists) docs.push(...(await loadArchivePages(archivePath)));
	docs.push(...(await loadVersionPages(path.join(projectRoot, 'var', 'admin', 'versions'))));
	if (crawlLive) docs.push(...(await crawlLiveDocs()));

	const enDocs = docs.filter((d) => String(d.pagePath || '').startsWith('/docs/'));
	const pageFindings = [];

	for (const d of enDocs) {
		const headings = [...extractHtmlHeadings(d.body), ...extractStrongLeads(d.body)].filter((h) => h.text);
		const dupHeadings = auditDuplicatesInList({ items: headings, keyOf: (h) => `${h.kind}::${h.text}` });
		const paras = extractParagraphs(d.body);
		const dupParas = auditDuplicatesInList({ items: paras, keyOf: (p) => p.text }).filter((x) => x.items[0].text.length >= 40);

		if (!dupHeadings.length && !dupParas.length) continue;

		pageFindings.push({
			source: d.source,
			pagePath: d.pagePath,
			dupHeadings,
			dupParas,
		});
	}

	const globalHeadings = [];
	for (const d of enDocs) {
		const headings = [...extractHtmlHeadings(d.body), ...extractStrongLeads(d.body)].filter((h) => h.text);
		for (const h of headings) {
			globalHeadings.push({ ...h, pagePath: d.pagePath, source: d.source });
		}
	}

	const crossPage = auditDuplicatesInList({ items: globalHeadings, keyOf: (h) => `${h.kind}::${h.text}` }).filter(
		(x) => new Set(x.items.map((i) => i.pagePath)).size > 1,
	);

	const lines = [];
	lines.push(`# Duplicate Subheading Audit (en)\n`);
	lines.push(`Generated: ${new Date().toISOString()}\n`);
	lines.push(`Sources scanned:\n`);
	if (archiveExists) lines.push(`- ${path.relative(projectRoot, archivePath)}\n`);
	lines.push(`- var/admin/versions/** (en docs only)\n`);
	if (crawlLive) lines.push(`- live crawl: ${crawlOrigin}${normalisePath(crawlStart) || '/docs/'} (cap ${crawlCap})\n`);

	lines.push(`\n## Findings (Within Page)\n`);
	if (!pageFindings.length) {
		lines.push(`No exact duplicate subheading text found within a single page.\n`);
	} else {
		for (const f of pageFindings.sort((a, b) => a.pagePath.localeCompare(b.pagePath))) {
			lines.push(`\n### ${f.pagePath}\n`);
			lines.push(`- Source: ${path.relative(projectRoot, f.source)}\n`);

			for (const h of f.dupHeadings) {
				const first = h.items[0];
				const kind = String(first.kind);
				const text = String(first.text);
				const sev = severityFor({ scope: 'within_page', count: h.items.length });
				lines.push(`- Duplicate subheading: ${JSON.stringify(text)} (${kind}) — severity: ${sev}\n`);
				lines.push(
					`  - Occurrences: ${h.items
						.map((x) => `#${x.index}`)
						.join(', ')}\n`,
				);
			}

			for (const p of f.dupParas) {
				const text = String(p.items[0]?.text || '');
				const sev = 'medium';
				lines.push(`- Duplicate paragraph text (exact) — severity: ${sev}\n`);
				lines.push(`  - Snippet: ${JSON.stringify(text.slice(0, 160) + (text.length > 160 ? '…' : ''))}\n`);
				lines.push(
					`  - Occurrences: ${p.items
						.map((x) => `#${x.index}`)
						.join(', ')}\n`,
				);
			}
		}
	}

	lines.push(`\n## Findings (Across Pages)\n`);
	if (!crossPage.length) {
		lines.push(`No exact duplicate subheading text found across multiple pages.\n`);
	} else {
		const sorted = [...crossPage].sort((a, b) => b.items.length - a.items.length);
		for (const g of sorted.slice(0, 250)) {
			const first = g.items[0];
			const kind = String(first.kind);
			const text = String(first.text);
			const pages = Array.from(new Set(g.items.map((i) => i.pagePath))).sort();
			const sev = severityFor({ scope: 'cross_page', count: pages.length });
			lines.push(`- Duplicate subheading: ${JSON.stringify(text)} (${kind}) — pages: ${pages.length} — severity: ${sev}\n`);
			lines.push(`  - Pages: ${pages.slice(0, 40).join(', ')}${pages.length > 40 ? ', …' : ''}\n`);
		}
	}

	await fs.writeFile(reportPath, lines.join(''), 'utf8');

	if (fix && archiveExists) {
		const raw = await fs.readFile(archivePath, 'utf8');
		const json = JSON.parse(raw);
		const pages = json?.pages && typeof json.pages === 'object' ? json.pages : {};
		const nextPages = {};
		for (const [p, v] of Object.entries(pages)) {
			const body = typeof v?.body === 'string' ? v.body : '';
			const fixedBody = fixArchiveBody({ body, pagePath: String(p) });
			nextPages[p] = { ...(v || {}), body: fixedBody };
		}
		const backup = `${archivePath}.bak`;
		await fs.writeFile(backup, raw, 'utf8');
		await fs.writeFile(archivePath, JSON.stringify({ ...json, pages: nextPages }, null, 2) + '\n', 'utf8');
	}

	process.stdout.write(`Report written: ${path.relative(projectRoot, reportPath)}\n`);
	if (fix && archiveExists) process.stdout.write(`Archive updated: ${path.relative(projectRoot, archivePath)}\n`);
};

await main();
