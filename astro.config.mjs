import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	// OUT_DIR lets the production deploy build into a staging dir (e.g. dist_new)
	// while the live dist/ keeps serving, then swap it in atomically. Defaults to
	// ./dist so local builds and `npm run build` are unchanged. See deploy/prod-deploy.sh.
	outDir: process.env.OUT_DIR || './dist',
});
