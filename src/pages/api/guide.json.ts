import type { APIRoute } from 'astro';

// GET /api/guide.json?path=/docs/...  Returns one public info-hub page as clean text, for AI assistants
// (the PropertyList MCP's get_guide tool) and anyone else who needs our guides in machine-readable form.
// Read-only. It fetches the page from this same server, so it serves exactly what visitors see.
// Pages marked noindex (drafts, surveys, activation) are refused.

const ORIGIN = 'https://info.propertylist.es';
const DEFAULT_MAX = 12000;
const HARD_MAX = 30000;

const json = (body: unknown, status = 200, cache = 'public, max-age=3600') =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': status === 200 ? cache : 'no-store',
			'access-control-allow-origin': '*',
		},
	});

function decode(s: string) {
	return s
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
		.replace(/&nbsp;|&#160;/g, ' ').replace(/&middot;|&#183;/g, '·')
		.replace(/&euro;/g, '€').replace(/&rarr;/g, '->').replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

// Same conversion as scripts/generate-llms-full.mjs, so llms-full.txt and this API read alike.
function htmlToMarkdown(html: string) {
	let s = html;
	s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
	s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
	s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
	s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
	s = s.replace(/<!--[\s\S]*?-->/g, ' ');
	s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n\n# ${t}\n`);
	s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n\n## ${t}\n`);
	s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n\n### ${t}\n`);
	s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m, t) => `\n\n#### ${t}\n`);
	s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${t}`);
	s = s.replace(/<(p|div|section|tr|br|ul|ol|table|figcaption)[^>]*>/gi, '\n');
	s = s.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (_m, t) => ` ${t} |`);
	s = s.replace(/<[^>]+>/g, '');
	s = decode(s);
	s = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
	return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Inner HTML of the first <div> whose class list contains `cls`, matching nested divs.
function innerOfFirstDiv(html: string, cls: string): string | null {
	const open = new RegExp(`<div[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`, 'i').exec(html);
	if (!open) return null;
	const start = open.index + open[0].length;
	const tag = /<\/?div\b[^>]*>/gi;
	tag.lastIndex = start;
	let depth = 1;
	for (let m = tag.exec(html); m; m = tag.exec(html)) {
		depth += m[0][1] === '/' ? -1 : 1;
		if (depth === 0) return html.slice(start, m.index);
	}
	return null;
}

const firstMatch = (html: string, re: RegExp) => {
	const m = html.match(re);
	return m ? decode(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : null;
};

export const GET: APIRoute = async ({ url }) => {
	let path = (url.searchParams.get('path') || '').trim();
	const maxRaw = Number.parseInt(url.searchParams.get('max_chars') || `${DEFAULT_MAX}`, 10);
	const maxChars = Math.min(Math.max(Number.isFinite(maxRaw) ? maxRaw : DEFAULT_MAX, 500), HARD_MAX);

	// Accept a full info-hub URL as well as a path.
	if (path.startsWith(ORIGIN)) path = path.slice(ORIGIN.length) || '/';
	path = path.split('#')[0].split('?')[0];

	// Only same-site page paths: no other hosts, no traversal, no API or admin routes.
	if (
		!path.startsWith('/') ||
		path.startsWith('//') ||
		path.includes('..') ||
		path.length > 300 ||
		!/^[A-Za-z0-9\-\/_.%]*$/.test(path) ||
		/^\/(api|admin|_astro|_image|internal)(\/|$)/i.test(path)
	) {
		return json({ error: 'invalid_path', message: 'Pass the path of a public page on info.propertylist.es, for example /docs/laws-procedures/.' }, 400);
	}
	if (!/\.[a-z0-9]{2,5}$/i.test(path) && !path.endsWith('/')) path += '/';

	const port = process.env.PORT || '3000';
	let res: Response;
	try {
		res = await fetch(`http://127.0.0.1:${port}${path}`, {
			headers: { 'user-agent': 'info-hub-guide-api', accept: 'text/html' },
			redirect: 'manual',
		});
	} catch {
		return json({ error: 'unavailable' }, 503);
	}

	// Follow one same-site redirect (old paths that moved).
	if (res.status >= 300 && res.status < 400) {
		const loc = res.headers.get('location') || '';
		const next = loc.startsWith(ORIGIN) ? loc.slice(ORIGIN.length) : loc;
		if (!next.startsWith('/') || next.startsWith('//')) return json({ error: 'not_found' }, 404);
		path = next.split('#')[0].split('?')[0];
		try {
			res = await fetch(`http://127.0.0.1:${port}${path}`, {
				headers: { 'user-agent': 'info-hub-guide-api', accept: 'text/html' },
				redirect: 'manual',
			});
		} catch {
			return json({ error: 'unavailable' }, 503);
		}
	}
	if (res.status !== 200) return json({ error: 'not_found' }, 404);
	if (!(res.headers.get('content-type') || '').includes('text/html')) return json({ error: 'not_a_page' }, 404);

	const html = await res.text();
	const robots = html.match(/<meta name="robots" content="([^"]*)"/i)?.[1] || '';
	if (/noindex/i.test(robots)) return json({ error: 'not_public' }, 404);

	const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || `${ORIGIN}${path}`;
	const language = html.match(/<html[^>]*\slang="([a-zA-Z-]+)"/i)?.[1]?.slice(0, 2).toLowerCase() || null;
	const alternates: Record<string, string> = {};
	for (const m of html.matchAll(/<link rel="alternate" hreflang="([a-zA-Z-]+)" href="([^"]+)"/gi)) {
		if (m[1] !== 'x-default') alternates[m[1]] = m[2];
	}
	const title =
		firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
		firstMatch(html, /<title>([\s\S]*?)<\/title>/i);
	const description = html.match(/<meta name="description" content="([^"]*)"/i)?.[1];
	// Law and tax pages carry a curated review dateline; return it so an assistant can say how current the page is.
	const reviewed =
		firstMatch(html, /Last reviewed:\s*([^<]{4,40})</i) ||
		firstMatch(html, /(?:Última revisión|Revisado(?: el)?):\s*([^<]{4,40})</i);

	// Docs pages hold the text in <div class="docContent">, beside the docNav sidebar and docToc contents list.
	// Blog and area-guide pages wrap it in <article class="doc ...">. Asides are dropped either way.
	const main = (
		innerOfFirstDiv(html, 'docContent') ||
		html.match(/<article[^>]*class="doc[^"]*"[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
		html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
		html
	).replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
	let text = htmlToMarkdown(main);
	const truncated = text.length > maxChars;
	if (truncated) text = text.slice(0, maxChars);

	return json({
		url: canonical,
		title,
		description: description ? decode(description) : null,
		language,
		last_reviewed: reviewed,
		alternates,
		text,
		truncated,
		source: 'PropertyList Info Hub (info.propertylist.es)',
	});
};
