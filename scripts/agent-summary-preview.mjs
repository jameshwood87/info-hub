// Preview (and, only on request, test-send) the summary email that the
// "Not ready to create an account?" box and the exit-intent popup send.
//
//   node scripts/agent-summary-preview.mjs
//       writes var/admin/agent-summary-preview-{en,es}.html (number not set yet)
//       and var/admin/agent-summary-preview-{en,es}-number.html (with a sample number)
//       plus the plain-text versions. Sends nothing.
//
//   node scripts/agent-summary-preview.mjs --test=you@example.com --lang=en
//       sends ONE real email to that one address through Mandrill, exactly as the
//       endpoint would: live counts, the live number from src/data/coagent.ts, the
//       signed unsubscribe link and Reply-To from SUMMARY_REPLY_TO.
//       Only run this with James's yes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildAgentSummary, sendAgentSummary } from '../src/lib/agentSummary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'var/admin');
const SITE = 'https://info.propertylist.es';
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

// Sample counts in the format statPlus produces, used for previews and as a fallback.
const SAMPLE = {
	en: { agencies: '1,000+', agents: '1,390+', listings: '6,110+' },
	es: { agencies: '1.000+', agents: '1.390+', listings: '6.110+' },
};

const test = arg('test');
if (!test) {
	for (const lang of ['en', 'es']) {
		for (const [suffix, number] of [['', ''], ['-number', '+34 600 000 000']]) {
			const { subject, html, text } = buildAgentSummary({
				lang,
				stats: SAMPLE[lang],
				coagentNumber: number,
				unsubUrl: `${SITE}/api/unsubscribe?e=agent%40example.com&t=preview&lang=${lang}&list=agent`,
				hasReplyTo: true,
			});
			fs.writeFileSync(path.join(OUT, `agent-summary-preview-${lang}${suffix}.html`), html);
			fs.writeFileSync(path.join(OUT, `agent-summary-preview-${lang}${suffix}.txt`), `Subject: ${subject}\n\n${text}\n`);
			const dashes = (html + text).match(/[–—]/g);
			console.log(`${lang}${suffix}: ${subject} | html ${html.length} bytes | dashes ${dashes ? dashes.length : 0}`);
		}
	}
	process.exit(0);
}

// --test: one real email to one address, built exactly as the endpoint builds it
const env = Object.fromEntries(
	fs
		.readFileSync(path.join(ROOT, '.env'), 'utf8')
		.split('\n')
		.filter((l) => /^[A-Z0-9_]+=/.test(l))
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^['"]|['"]$/g, '').trim()]),
);
const numberFile = fs.readFileSync(path.join(ROOT, 'src/data/coagent.ts'), 'utf8');
const number = (numberFile.match(/export const COAGENT_NUMBER = '([^']*)'/) || [])[1] || '';
const lang = arg('lang') === 'es' ? 'es' : 'en';
const email = test.trim().toLowerCase();

// Live counts from the portal, rounded down to the nearest 10 like statPlus.
let stats = SAMPLE[lang];
try {
	const res = await fetch('https://propertylist.es/portal/bootstrap', {
		headers: { Accept: 'application/json', 'User-Agent': 'info-hub' },
		signal: AbortSignal.timeout(4000),
	});
	if (res.ok) {
		const j = await res.json();
		const sep = lang === 'en' ? ',' : '.';
		const plus = (n) => {
			const v = Math.floor(Number(n) / 10) * 10;
			return v > 0 ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep) + '+' : '';
		};
		// portal key names are misleading: agents_count is agencies, employees_count is agents
		const live = { agencies: plus(j.agents_count), agents: plus(j.employees_count), listings: plus(j.listings_count) };
		if (live.agencies && live.agents && live.listings) stats = live;
	}
} catch {
	// keep the sample counts
}

const secret = String(env.NEWSLETTER_SECRET || '').trim();
const unsubUrl = secret
	? `${SITE}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${crypto.createHmac('sha256', secret).update(email).digest('hex').slice(0, 32)}&lang=${lang}&list=agent`
	: '';

const result = await sendAgentSummary({
	email,
	lang,
	stats,
	coagentNumber: number,
	unsubUrl,
	key: env.MANDRILL_API_KEY,
	from: env.NOTIFY_FROM,
	fromName: 'PropertyList',
	replyTo: String(env.SUMMARY_REPLY_TO || '').trim(),
});
console.log(
	`test send (${lang}, number ${number ? 'set' : 'not set'}, reply-to ${env.SUMMARY_REPLY_TO ? 'set' : 'not set'}, unsubscribe ${unsubUrl ? 'signed' : 'missing'}, counts ${stats.agencies}/${stats.agents}/${stats.listings}): ${result.status}${result.detail ? ' ' + result.detail : ''}`,
);
