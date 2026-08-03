// /llms.txt is the AI-crawler manifest. It used to be a static file in public/ with the
// platform counts typed in by hand, which drifted: it said 6,000+ listings in one line and
// 6,200+ in another, while the portal was on 6,167. Now it is rendered from
// src/data/llms-template.txt with the same live figures the pages use, so the numbers can
// never disagree with the homepage again.
//
// The template keeps the {{LISTINGS}} / {{AGENTS}} / {{AGENCIES}} tokens. If getPortalStats
// cannot reach the portal it returns its last-known-good value, so this endpoint always
// serves a complete file.
import type { APIRoute } from 'astro';
import { getPortalStats, statPlus } from '../lib/portalStats';
import template from '../data/llms-template.txt?raw';

export const GET: APIRoute = async () => {
	let body = template;
	try {
		const s = await getPortalStats();
		body = body
			.replaceAll('{{LISTINGS}}', statPlus(s.listings, 'en'))
			.replaceAll('{{AGENTS}}', statPlus(s.agents, 'en'))
			.replaceAll('{{AGENCIES}}', statPlus(s.agencies, 'en'));
	} catch {
		// Serving the template with its tokens showing would be worse than serving nothing
		// useful, so strip them to plain words rather than leak {{...}} to a crawler.
		body = body
			.replaceAll('{{LISTINGS}}', 'thousands of')
			.replaceAll('{{AGENTS}}', 'over a thousand')
			.replaceAll('{{AGENCIES}}', 'hundreds of');
	}

	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600',
		},
	});
};
