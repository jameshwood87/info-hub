#!/usr/bin/env node
/**
 * generate-llms-full.mjs - builds /llms-full.txt: a full-text markdown dump of
 * the key public pages for AI crawlers (llms.txt is the map; this is the
 * territory). Fetches each live page, extracts <main>, converts to markdown.
 * Writes to public/ (source of truth for future builds) AND dist/client/
 * (live immediately, no rebuild). Cron: monthly, 1st at 06:40.
 * Usage: node scripts/generate-llms-full.mjs
 */
import fs from 'node:fs';

const ORIGIN = 'https://info.propertylist.es';
const PAGES = [
	['/', 'Homepage'],
	['/what-we-offer/', 'What we offer'],
	['/pricing/', 'Pricing'],
	['/features/', 'Features FAQ'],
	['/faq/', 'General FAQ'],
	['/website-builder/', 'Website Builder'],
	['/instant-listing/', 'Instant Listing'],
	['/instant-content/', 'Instant Content'],
	['/instant-renovation/', 'Instant Renovation (coming soon)'],
	['/instant-brochure/', 'Instant Brochure (coming soon)'],
	['/instant-video/', 'Instant Video (coming soon)'],
	['/instant-images/', 'Instant Images (coming soon)'],
	['/ai-property-search/', 'AI Property Search'],
	['/costa-del-sol/', 'The Costa del Sol town by town (market data per town)'],
	['/launch/', 'Launch your estate agency in minutes'],
	['/free/', 'Everything an estate agency needs, free (vs the paid stack)'],
	['/request-new-features/', 'Feature Requests & Roadmap Voting'],
	['/mobile-app/', 'Mobile App'],
	['/referrals/', 'Referral Program'],
	['/rentals/', 'Rentals Module'],
	['/pipelines/', 'Sales Pipelines'],
	['/developers/', 'For Property Developers'],
	['/verify-your-agency/', 'Verified Agencies'],
	['/docs/propertylist-mls-user-manual/credits/how-billing-works/', 'How billing works'],
	['/docs/propertylist-mls-user-manual/community-guidelines/', 'Community Guidelines'],
	['/whats-on/', "What's On - Costa del Sol events"],
	['/about-us/', 'About us'],
];

const MAX_PER_PAGE = 15000;

function htmlToMarkdown(html) {
	let s = html;
	s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
	s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
	s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
	s = s.replace(/<!--[\s\S]*?-->/g, ' ');
	s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, t) => `\n\n# ${t}\n`);
	s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m, t) => `\n\n## ${t}\n`);
	s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m, t) => `\n\n### ${t}\n`);
	s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (m, t) => `\n\n#### ${t}\n`);
	s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => `\n- ${t}`);
	s = s.replace(/<(p|div|section|tr|br|ul|ol|table|figcaption)[^>]*>/gi, '\n');
	s = s.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (m, t) => ` ${t} |`);
	s = s.replace(/<[^>]+>/g, '');
	s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
		.replace(/&nbsp;|&#160;/g, ' ').replace(/&middot;|&#183;/g, '·')
		.replace(/&euro;/g, '€').replace(/&rarr;/g, '->').replace(/&[a-z]+;|&#\d+;/gi, ' ');
	s = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
	s = s.replace(/\n{3,}/g, '\n\n').trim();
	return s;
}

const parts = [
	`# PropertyList Info Hub - Full Text for AI Models`,
	``,
	`Source: ${ORIGIN}/ | Generated: ${new Date().toISOString().slice(0, 10)}`,
	`This is the full-text companion to ${ORIGIN}/llms.txt. Spanish versions of every page exist (see llms.txt for paths). First-party data APIs: https://mcp.propertylist.es/mcp (live listing counts and prices for Spain and Portugal, free) and https://oracle.propertylist.es (notary-verified sale prices).`,
	``,
];

let ok = 0;
for (const [path, label] of PAGES) {
	try {
		const res = await fetch(`${ORIGIN}${path}`, { headers: { 'User-Agent': 'llms-full-generator' } });
		if (!res.ok) { console.log(`SKIP ${path}: ${res.status}`); continue; }
		const html = await res.text();
		const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
		const inner = m ? m[1] : html;
		let md = htmlToMarkdown(inner);
		if (md.length > MAX_PER_PAGE) md = md.slice(0, MAX_PER_PAGE) + `\n[truncated - full page at ${ORIGIN}${path}]`;
		parts.push(`\n---\n\n# ${label}\nURL: ${ORIGIN}${path}\n\n${md}`);
		ok++;
		console.log(`ok ${path} (${md.length} chars)`);
	} catch (e) { console.log(`FAIL ${path}: ${e.message}`); }
}

if (ok < PAGES.length * 0.7) {
	console.error(`only ${ok}/${PAGES.length} pages fetched - refusing to write a thin file`);
	process.exit(1);
}

const out = parts.join('\n');
for (const dest of ['/opt/info-hub/public/llms-full.txt', '/opt/info-hub/dist/client/llms-full.txt']) {
	try { fs.writeFileSync(dest, out, 'utf8'); console.log(`wrote ${dest} (${out.length} bytes)`); }
	catch (e) { console.log(`write ${dest} failed: ${e.message}`); }
}
