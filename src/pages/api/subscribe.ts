import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { mirrorSubmission } from '../../lib/submissions';
import { notifySubmission } from '../../lib/notify';
import { getPortalStats, statPlus } from '../../lib/portalStats';
import { COAGENT_NUMBER } from '../../data/coagent';
// Plain JS module, shared with scripts/agent-summary-preview.mjs so the preview is the real email.
// @ts-ignore
import { sendAgentSummary } from '../../lib/agentSummary.mjs';

type SubscribeRequest = {
	email?: string;
	lang?: string;
	page?: string;
	utm?: Record<string, string>;
	/** 'agent' routes to the agent/developer CRM; anything else uses the consumer audience */
	audience?: 'agent' | 'consumer';
	/** extra Mailchimp tag, e.g. 'seller' or 'blog' */
	tag?: string;
	/** true only from the two boxes that promise the summary email (AgentInterestCta, ExitIntent) */
	summary?: boolean;
	/** honeypot: a hidden field real people never fill */
	website?: string;
};

const json = (obj: unknown, status = 200) =>
	new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function md5Lower(input: string): string {
	return crypto.createHash('md5').update(input.trim().toLowerCase()).digest('hex');
}

// best-effort in-process rate limit: 5 submissions per IP per hour
const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 5) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};
// behind Cloudflare the real client IP is cf-connecting-ip (spoofed values are stripped)
const clientIpOf = (request: Request, clientAddress?: string) =>
	String(request.headers.get('cf-connecting-ip') || clientAddress || 'unknown');

// Only a path on this site is kept, e.g. "/es/precios/".
const cleanPage = (raw: unknown) => {
	const s = String(raw || '').trim().slice(0, 200);
	return /^\/[^\s<>"]*$/.test(s) ? s : '';
};

// ---------------------------------------------------------------------------
// The summary email. Until 13-09-26 this box promised "We will email you the
// summary" and sent nothing: the address only went into Mailchimp. Now the
// request is stored, the summary is sent, and James is told.
//
// Abuse guards, because a public form that sends mail can be pointed at
// someone else's address: the per-IP limit above, a honeypot, a strict address
// check, one summary per address per 30 days, and a daily ceiling on send
// ATTEMPTS (failed ones count too, so a refused address cannot be retried forever).
// ---------------------------------------------------------------------------
// Overridable only so a staging copy never writes into the live store.
const SUMMARY_STORE = String(process.env.AGENT_SUMMARY_STORE || '/opt/info-hub/var/admin/agent-summary.json');
const RESEND_AFTER_MS = 30 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
const DAILY_CAP = 150;
const RESPONSE_DEADLINE_MS = 9000;
const SUMMARY_EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const SITE = 'https://info.propertylist.es';

type SendRecord = { email: string; at: string; lang: string; page: string; outcome: string };

// All reads and writes of the store go through one in-process queue, so two
// requests that overlap can never read the same list and overwrite each other.
let storeQueue: Promise<unknown> = Promise.resolve();
const withStore = <T>(fn: () => Promise<T>): Promise<T> => {
	const run = storeQueue.then(fn, fn);
	storeQueue = run.catch(() => undefined);
	return run;
};
const readStore = async (): Promise<SendRecord[]> => {
	try {
		const all = JSON.parse(await fs.readFile(SUMMARY_STORE, 'utf8'));
		return Array.isArray(all) ? all : [];
	} catch {
		return [];
	}
};
const writeStore = async (all: SendRecord[]) => {
	const tmp = `${SUMMARY_STORE}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(all.slice(-5000), null, 2), 'utf8');
	await fs.rename(tmp, SUMMARY_STORE);
};

// Signed one-click unsubscribe, the same token the market email uses, so
// /api/unsubscribe verifies it without any new secret.
const unsubUrlFor = (email: string, lang: string) => {
	const secret = String(process.env.NEWSLETTER_SECRET || '').trim();
	if (!secret) return '';
	const e = email.toLowerCase();
	const t = crypto.createHmac('sha256', secret).update(e).digest('hex').slice(0, 32);
	return `${SITE}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${t}&lang=${lang === 'es' ? 'es' : 'en'}&list=agent`;
};

const SUMMARY_LABEL: Record<string, string> = {
	sent: 'sent',
	rejected: 'NOT sent: Mandrill refused it (journalctl -u info-hub | grep agent-summary)',
	error: 'NOT sent: send error (journalctl -u info-hub | grep agent-summary)',
	not_configured: 'NOT sent: Mandrill is not configured',
	skipped_recent: 'not sent again: this address already had it in the last 30 days',
	daily_cap: 'NOT sent: daily limit reached, possible abuse',
};

async function handleSummary(email: string, lang: 'en' | 'es', page: string): Promise<string> {
	const lower = email.toLowerCase();
	const now = Date.now();

	// Decide and reserve inside the queue, so the 30-day rule and the daily cap
	// hold even when requests overlap. The attempt is recorded before sending.
	const decision = await withStore(async () => {
		const all = await readStore();
		const lastSent = all
			.filter((r) => r.email === lower && r.outcome === 'sent')
			.map((r) => Date.parse(r.at))
			.filter(Number.isFinite)
			.sort((a, b) => b - a)[0];
		const pendingForAddress = all.some((r) => r.email === lower && r.outcome === 'sending' && now - Date.parse(r.at) < 60_000);
		if ((lastSent && now - lastSent < RESEND_AFTER_MS) || pendingForAddress) return 'skipped_recent';
		const attemptsToday = all.filter((r) => r.outcome !== 'skipped_recent' && now - Date.parse(r.at) < DAY_MS).length;
		if (attemptsToday >= DAILY_CAP) return 'daily_cap';
		all.push({ email: lower, at: new Date(now).toISOString(), lang, page, outcome: 'sending' });
		await writeStore(all);
		return 'send';
	});

	// Store the request, so a mail outage can never lose the lead.
	await mirrorSubmission({
		kind: 'agent-summary',
		email: lower,
		lang,
		source: 'agent-summary',
		page,
		payload: { requested: 'summary email', precheck: decision },
	});

	let status = decision;
	if (decision === 'send') {
		const s = await getPortalStats();
		const stats = { agencies: statPlus(s.agencies, lang), agents: statPlus(s.agents, lang), listings: statPlus(s.listings, lang) };
		const result = await sendAgentSummary({
			email: lower,
			lang,
			stats,
			coagentNumber: COAGENT_NUMBER,
			unsubUrl: unsubUrlFor(lower, lang),
			key: String(process.env.MANDRILL_API_KEY || '').trim(),
			from: String(process.env.NOTIFY_FROM || '').trim(),
			fromName: 'PropertyList',
			// A monitored team inbox, set on the server. Deliberately no fallback to
			// NOTIFY_TO, which is a personal address for internal alerts.
			replyTo: String(process.env.SUMMARY_REPLY_TO || '').trim(),
		});
		status = result.status;
		await withStore(async () => {
			const all = await readStore();
			for (let i = all.length - 1; i >= 0; i--) {
				if (all[i].email === lower && all[i].outcome === 'sending') {
					all[i].outcome = status;
					break;
				}
			}
			await writeStore(all);
		}).catch((err) => console.error('[agent-summary] could not record the outcome', err && (err as Error).name));
	}

	// James's alert does not hold up the visitor.
	notifySubmission({
		kind: 'summary request',
		fields: [
			['Email', lower],
			['Language', lang],
			['Page', page || '(unknown)'],
			['Summary email', SUMMARY_LABEL[status] || status],
		],
	}).catch(() => undefined);
	return status;
}

async function mailchimpPut(email: string, body: SubscribeRequest, lang: string, page: string) {
	// process.env only: info-hub.service loads /opt/info-hub/.env as its EnvironmentFile.
	// The old import.meta.env fallback made Vite inline the API key into the server
	// bundle under dist/, which is a secret sitting in a build artifact.
	const apiKey = String(process.env.MAILCHIMP_API_KEY || '').trim();
	// Two audiences on purpose: the original list is a CRM mirror whose CTYPE field only
	// permits agent|developer and whose engagement fields are synced from the platform, so
	// buyers/sellers/renters must never land in it.
	const agentAudienceId = String(process.env.MAILCHIMP_AUDIENCE_ID || '').trim();
	const consumerAudienceId = String(process.env.MAILCHIMP_CONSUMER_AUDIENCE_ID || '').trim();

	if (!apiKey || (!agentAudienceId && !consumerAudienceId)) return { ok: false, status: 501, error: 'not_configured' };
	const dc = apiKey.split('-')[1] || '';
	if (!dc) return { ok: false, status: 400, error: 'invalid_api_key' };

	const audienceId =
		body.audience === 'agent' ? agentAudienceId || consumerAudienceId : consumerAudienceId || agentAudienceId;
	if (!audienceId) return { ok: false, status: 501, error: 'not_configured' };

	const tags: string[] = [];
	const extraTag = (body.tag || '').trim();
	if (extraTag) tags.push(extraTag);
	if (lang) tags.push(`lang:${lang}`);
	if (page) tags.push(`page:${page}`);
	if (body.utm) {
		for (const [k, v] of Object.entries(body.utm)) {
			if (!k || !v) continue;
			tags.push(`utm:${k}=${v}`);
		}
	}

	const url = `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${md5Lower(email)}`;
	const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
	try {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
			body: JSON.stringify({ email_address: email, status: 'subscribed', tags }),
			signal: AbortSignal.timeout(8000),
		});
		return res.ok ? { ok: true, status: 200, error: '' } : { ok: false, status: 502, error: 'mailchimp_error' };
	} catch {
		return { ok: false, status: 502, error: 'mailchimp_error' };
	}
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);

	let body: SubscribeRequest = {};
	try {
		body = (await request.json()) as SubscribeRequest;
	} catch {
		return json({ ok: false, error: 'invalid_json' }, 400);
	}

	const email = String(body.email || '').trim();
	const lang = String(body.lang || 'en').trim().toLowerCase();
	const page = cleanPage(body.page);

	// The summary boxes: send what was promised, then add to Mailchimp as before.
	if (body.summary === true && body.audience === 'agent') {
		// honeypot: bots fill the hidden field. Pretend success, do nothing.
		if (String(body.website || '').trim()) return json({ ok: true });
		if (email.length > 160 || !SUMMARY_EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);

		const work = handleSummary(email, lang === 'es' ? 'es' : 'en', page).catch((err) => {
			console.error('[agent-summary] handler failed', err && (err as Error).name);
			return 'error';
		});
		// Mailchimp is best-effort here and never holds up the visitor.
		mailchimpPut(email, body, lang, page).catch(() => undefined);
		// Answer within a bounded time even if Directus, the portal and Mandrill are
		// all slow at once; the send carries on in the background.
		await Promise.race([work, new Promise((resolve) => setTimeout(resolve, RESPONSE_DEADLINE_MS))]);
		// Same answer whatever happened, so the form never reveals whether an address was already known.
		return json({ ok: true });
	}

	// Every other caller keeps the original behaviour and the original check.
	if (!email || !email.includes('@')) return json({ ok: false, error: 'invalid_email' }, 400);
	const mc = await mailchimpPut(email, body, lang, page);
	if (!mc.ok) return json({ ok: false, error: mc.error }, mc.status);
	return json({ ok: true });
};
