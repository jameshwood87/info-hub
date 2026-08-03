import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	// OUT_DIR lets the production deploy build into a staging dir (e.g. dist_new)
	// while the live dist/ keeps serving, then swap it in atomically. Defaults to
	// ./dist so local builds and `npm run build` are unchanged. See deploy/prod-deploy.sh.
	outDir: process.env.OUT_DIR || './dist',
	// The app speaks plain HTTP behind nginx, so Astro was building an http:// request
	// URL while browsers send an https:// Origin header. Its origin check compares the
	// two, so every native <form method="post"> was answered with 403 "Cross-site POST
	// form submissions are forbidden" - the feature board and report-a-problem forms
	// were silently broken in production. Naming the hosts here lets Astro trust the
	// X-Forwarded-Proto nginx already sends. 127.0.0.1/localhost are listed so internal
	// calls (cron scripts, the stats endpoint) keep their real host instead of falling
	// back to "localhost".
	security: {
		allowedDomains: [
			{ hostname: 'info.propertylist.es' },
			{ hostname: '127.0.0.1' },
			{ hostname: 'localhost' },
		],
	},
});
