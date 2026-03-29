import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OLD_SERVER_HOST = process.env.MLS_OLD_SERVER_HOST || '161.35.209.253';
const OLD_SERVER_USER = process.env.MLS_OLD_SERVER_USER || 'root';
const SSH_KEY_PATH = process.env.MLS_OLD_SERVER_SSH_KEY || path.join(process.env.USERPROFILE || '', '.ssh', 'id_ed25519');

const WP_DB = process.env.MLS_OLD_SERVER_WP_DB || 'wordpress';
const WP_POSTS_TABLE = process.env.MLS_OLD_SERVER_WP_POSTS_TABLE || 'wp_posts';

const projectRoot = path.resolve(process.cwd());
const archiveJsonPath = path.join(projectRoot, 'src', 'data', 'mls-manual-archive.json');
const reportPath = path.join(projectRoot, 'mls-manual-old-server-import.md');

const targets = [
	{
		path: '/docs/propertylist-mls-user-manual/your-account/',
		wpId: 9375,
		note: 'WP source slug: /mls-user-manual/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/microsite-share/',
		wpId: 10283,
		note: 'WP source slug: /microsite-share-properties-listings/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/contacts/',
		wpId: 10273,
		note: 'WP source slug: /how-to-use-contacts/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/leads/',
		wpId: 10238,
		note: 'WP source slug: /managing-your-leads/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/calendar/',
		wpId: 10227,
		note: 'WP source slug: /how-to-use-the-calendar/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/faq-mls-crm/',
		wpId: 10350,
		note: 'WP source slug: /faq-mls/',
	},
	{
		path: '/docs/propertylist-mls-user-manual/how-to-use-the-calendar/syncing-your-calendar-with-other-apps/',
		wpId: 10232,
	},
	{
		path: '/docs/propertylist-mls-user-manual/requests/agent-requests/',
		wpId: 15994,
	},
	{
		path: '/docs/propertylist-mls-user-manual/requests/client-requests/',
		wpId: 15996,
	},
	{
		path: '/docs/propertylist-mls-user-manual/marketing-and-promotion/sharing-listings-social-media/',
		wpId: 9688,
	},
	{
		path: '/docs/propertylist-mls-user-manual/managing-listings/generating-property-reports/',
		wpId: 9664,
	},
	{
		path: '/docs/propertylist-mls-user-manual/reports-and-statistics/generating-market-reports/',
		wpId: 9700,
	},
];

const sshArgsBase = [
	'-i',
	SSH_KEY_PATH,
	'-o',
	'IdentitiesOnly=yes',
	'-o',
	'BatchMode=yes',
	'-o',
	'StrictHostKeyChecking=accept-new',
	'-o',
	'ConnectTimeout=25',
	`${OLD_SERVER_USER}@${OLD_SERVER_HOST}`,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sshOnce = async (remoteCmd) => {
	const { stdout } = await execFileAsync('ssh', [...sshArgsBase, remoteCmd], { maxBuffer: 50 * 1024 * 1024 });
	return String(stdout || '');
};

const toUtf8 = (b64) => Buffer.from(b64, 'base64').toString('utf8');

const fetchAllWpPostContentsBase64 = async (wpIds) => {
	const ids = Array.from(new Set(wpIds)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
	if (ids.length === 0) return new Map();

	const sql = `SELECT ID, REPLACE(REPLACE(TO_BASE64(post_content), CHAR(10), ''), CHAR(13), '') FROM ${WP_POSTS_TABLE} WHERE ID IN (${ids.join(
		',',
	)});`;
	const sqlEsc = sql.replaceAll('"', '\\"');
	const remoteCmd = `printf \"%s\\n\" \"${sqlEsc}\" | mysql -N ${WP_DB}`;

	let lastErr = null;
	for (let i = 0; i < 4; i++) {
		try {
			const out = await sshOnce(remoteCmd);
			const map = new Map();
			for (const line of out.split(/\r?\n/)) {
				if (!line.trim()) continue;
				const [idStr, b64] = line.split(/\t/, 2);
				const id = Number(idStr);
				if (!Number.isFinite(id)) continue;
				map.set(id, String(b64 || '').trim());
			}
			return map;
		} catch (e) {
			lastErr = e;
			await sleep(800 * (i + 1));
		}
	}
	throw lastErr;
};

const main = async () => {
	const raw = await fs.readFile(archiveJsonPath, 'utf8');
	const json = JSON.parse(raw);
	if (!json.pages || typeof json.pages !== 'object') json.pages = {};

	const contentById = await fetchAllWpPostContentsBase64(targets.map((t) => t.wpId));

	const results = [];
	for (const t of targets) {
		let body = '';
		let ok = false;
		let err = null;
		try {
			const b64 = String(contentById.get(t.wpId) || '').trim();
			if (b64) {
				body = toUtf8(b64).trim();
				ok = body.length > 0;
			}
		} catch (e) {
			err = e;
		}

		results.push({
			path: t.path,
			wpId: t.wpId,
			ok,
			len: body.length,
			note: t.note || '',
			err: err ? String(err?.message || err) : '',
		});

		if (ok) json.pages[t.path] = { body };
	}

	await fs.writeFile(archiveJsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');

	const md =
		`# MLS manual old-server import\n\n` +
		`Host: ${OLD_SERVER_HOST}\n\n` +
		`| Path | WP ID | Imported | Body length | Note |\n|---|---:|---:|---:|---|\n` +
		results
			.map((r) => `| \`${r.path}\` | ${r.wpId} | ${r.ok ? 'yes' : 'no'} | ${r.len} | ${r.note || r.err || ''} |`)
			.join('\n') +
		`\n`;
	await fs.writeFile(reportPath, md, 'utf8');

	const totals = { pages: results.length, imported: results.filter((r) => r.ok).length };
	process.stdout.write(`${JSON.stringify(totals)}\n`);
};

main().catch((e) => {
	process.stderr.write(`${e?.stack || e}\n`);
	process.exit(1);
});
