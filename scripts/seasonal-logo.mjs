import { renameSync, existsSync } from 'fs';
import { resolve } from 'path';
const season = process.argv[2];
if (!season) { console.error('Season argument required (e.g. christmas, valentines, easter …)'); process.exit(1); }
const src = resolve('public/og', `logo-${season}.png`);
const dst = resolve('public/logo-black.png');
if (!existsSync(src)) { console.error(`Missing source logo: ${src}`); process.exit(1); }
renameSync(src, dst);
console.log(`✅ Switched logo to ${season}`);
