// Drop-in replacement for Mandrill's messages/send, sending through Amazon SES over SMTP (09-10-26).
// Mandrill was suspended on 29-09-26 and its key has answered 401 since 02-10-26. Every caller posted
// { key, message } to https://mandrillapp.com/api/1.0/messages/send(.json) and read Mandrill's reply,
// so this takes the same body and answers in the same shape: [{ email, status, _id, reject_reason }].
// Like Mandrill, each recipient gets a separate copy unless message.preserve_recipients is true, so no
// recipient ever sees another's address. Credentials: SES_SMTP_HOST, SES_SMTP_PORT, SES_SMTP_USER,
// SES_SMTP_PASS, from process.env or the .env file below. Errors are logged as fixed text, never with
// the server's reply, so a credential can never reach a log.
import fs from 'node:fs';
import nodemailer from 'nodemailer';

const ENV_FILE = '/opt/info-hub/.env';

let fileEnv = null;
const cfg = (k) => {
	if (process.env[k]) return String(process.env[k]).trim();
	if (fileEnv === null) {
		fileEnv = {};
		try {
			for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
				const t = line.trim();
				if (!t || t.startsWith('#') || !t.includes('=')) continue;
				const i = t.indexOf('=');
				fileEnv[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
			}
		} catch { /* no file: process.env only */ }
	}
	return (fileEnv[k] || '').trim();
};

let transport = null;
const getTransport = () => {
	if (transport) return transport;
	const host = cfg('SES_SMTP_HOST');
	const user = cfg('SES_SMTP_USER');
	const pass = cfg('SES_SMTP_PASS');
	if (!host || !user || !pass) return null;
	transport = nodemailer.createTransport({
		host,
		port: Number(cfg('SES_SMTP_PORT') || 587),
		secure: false,
		requireTLS: true,
		auth: { user, pass },
	});
	return transport;
};

const reply = (status, data) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => data,
	text: async () => JSON.stringify(data),
});

export async function mandrillFetch(_url, init = {}) {
	let message;
	try {
		message = (JSON.parse(init.body || '{}') || {}).message || {};
	} catch {
		return reply(400, { status: 'error', name: 'ValidationError', message: 'invalid JSON body' });
	}
	const rcpts = (Array.isArray(message.to) ? message.to : []).filter((r) => r && r.email);
	if (!rcpts.length) return reply(400, { status: 'error', name: 'ValidationError', message: 'no recipients' });
	const t = getTransport();
	if (!t) return reply(500, { status: 'error', name: 'Invalid_Config', message: 'SES SMTP is not configured' });

	const headers = { ...(message.headers || {}) };
	const replyTo = headers['Reply-To'] || headers['reply-to'] || undefined;
	delete headers['Reply-To'];
	delete headers['reply-to'];
	const b64 = (s) => Buffer.from(String(s || ''), 'base64');
	const attachments = [
		...(message.attachments || []).map((a) => ({ filename: a.name, content: b64(a.content), contentType: a.type })),
		...(message.images || []).map((a) => ({ filename: a.name, cid: a.name, content: b64(a.content), contentType: a.type })),
	];
	const from = message.from_name ? { name: message.from_name, address: message.from_email } : message.from_email;
	const addr = (r) => (r.name ? { name: r.name, address: r.email } : r.email);
	const groups = message.preserve_recipients ? [rcpts] : rcpts.map((r) => [r]);

	const results = [];
	for (const g of groups) {
		const to = g.filter((r) => !r.type || r.type === 'to').map(addr);
		const cc = g.filter((r) => r.type === 'cc').map(addr);
		const bcc = g.filter((r) => r.type === 'bcc').map(addr);
		try {
			const info = await t.sendMail({
				from,
				to: to.length ? to : undefined,
				cc: cc.length ? cc : undefined,
				bcc: bcc.length ? bcc : undefined,
				replyTo,
				subject: message.subject || '',
				html: message.html || undefined,
				text: message.text || undefined,
				headers,
				attachments,
			});
			for (const r of g) results.push({ email: r.email, status: 'sent', _id: info.messageId || null, reject_reason: null });
		} catch (e) {
			const code = e && (e.responseCode || e.code) ? String(e.responseCode || e.code) : 'unknown';
			console.error(`sesMail: send failed (${code})`);
			for (const r of g) results.push({ email: r.email, status: 'rejected', _id: null, reject_reason: `ses_${code}` });
		}
	}
	return reply(200, results);
}
