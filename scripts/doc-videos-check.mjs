#!/usr/bin/env node
/**
 * doc-videos-check.mjs - guards the "prefer to watch" bars on the manual.
 * Fails if a mapped manual page stops existing, if its video anchor is gone from the video
 * guides page, if the bar does not render, or if a Spanish page offers an English video.
 * Usage: node scripts/doc-videos-check.mjs [base]      default http://127.0.0.1:3000
 */
import { DOC_VIDEO_PAGES } from '../src/data/doc-videos.ts';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const get = async (p) => {
	const r = await fetch(BASE + p, { redirect: 'follow' });
	return { status: r.status, html: (await r.text()).replace(/ data-astro-cid-[\w-]+(="[^"]*")?/g, '') };
};

let bad = 0;
const fail = (m) => { console.log('FAIL ' + m); bad++; };

for (const [lang, pagePath] of [['en', '/video-guides/'], ['es', '/es/video-guias/']]) {
	const page = await get(pagePath);
	if (page.status !== 200) { fail(`${pagePath} returned ${page.status}`); continue; }
	const pages = DOC_VIDEO_PAGES[lang];
	const guides = DOC_VIDEO_PAGES[lang === 'en' ? 'enGuides' : 'esGuides'];
	for (const slug of new Set(Object.values(pages))) {
		if (!page.html.includes(`id="guide-${slug}"`)) fail(`${pagePath} has no anchor guide-${slug}`);
		if (!guides[slug]) fail(`${lang}: no title and duration for ${slug}`);
		else if (!page.html.includes(guides[slug].title)) fail(`${pagePath} no longer shows the title "${guides[slug].title}"`);
	}
	for (const [docPath, slug] of Object.entries(pages)) {
		const doc = await get(docPath);
		if (doc.status !== 200) { fail(`${docPath} returned ${doc.status}`); continue; }
		if (!doc.html.includes(`href="${pagePath}#guide-${slug}"`)) fail(`${docPath} does not link ${pagePath}#guide-${slug}`);
		if (!doc.html.includes('data-doc-video')) fail(`${docPath} does not render the video bar`);
		if (lang === 'es' && doc.html.includes('href="/video-guides/#guide-')) fail(`${docPath} links an English video`);
	}
	console.log(`${lang}: ${Object.keys(pages).length} manual pages checked against ${pagePath}`);
}

// a manual page with no video must not show a bar
for (const p of ['/docs/propertylist-mls-user-manual/getting-started/what-is-propertylist/', '/es/docs/propertylist-mls-manual-de-usuario/empezar/what-is-propertylist/']) {
	const doc = await get(p);
	if (doc.html.includes('data-doc-video')) fail(`${p} shows a video bar but has no video`);
}

console.log(bad ? `DOC VIDEOS CHECK FAILED (${bad})` : 'DOC VIDEOS ALL PASS');
process.exit(bad ? 1 : 0);
