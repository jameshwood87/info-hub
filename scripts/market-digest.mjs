// The Costa del Sol market email the footer signup promises.
//
// Everything in it is computed from data the site already collects: the daily
// portal pull in var/admin/budget-data.json (the same figures /budget/ shows)
// and the dated snapshots archive-budget.sh keeps in var/admin/history. Nothing
// is written by hand and nothing is estimated: if a number is not in that data,
// the email does not claim it.
//
//   node scripts/market-digest.mjs --dry            preview EN + ES, send nothing
//   node scripts/market-digest.mjs --test=me@x.es   send one copy to one address
//   node scripts/market-digest.mjs                  send to the list (guarded)
//   node scripts/market-digest.mjs --force          ignore the once-a-month guard
//
// The guard exists because a cron that fires twice is a list that unsubscribes
// twice as fast. State lives in var/admin/market-digest-state.json.
import fs from 'node:fs';
import crypto from 'node:crypto';

const DIR = '/opt/info-hub';
const DATA = `${DIR}/var/admin/budget-data.json`;
const HIST = `${DIR}/var/admin/history`;
const LIST = `${DIR}/var/admin/newsletter.json`;
const STATE = `${DIR}/var/admin/market-digest-state.json`;
const SITE = 'https://info.propertylist.es';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const TEST = (args.find((a) => a.startsWith('--test=')) || '').slice(7).trim();

// .env, same loader the other crons use.
try {
	for (const line of fs.readFileSync(`${DIR}/.env`, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
} catch {}
const KEY = (process.env.MANDRILL_API_KEY || '').trim();
const FROM = (process.env.NOTIFY_FROM || '').trim();
const FROM_NAME = 'PropertyList';
const SECRET = (process.env.NEWSLETTER_SECRET || '').trim();

// ---------------------------------------------------------------- helpers
const esc = (v) =>
	String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Spanish and English both read dd-mm-yy here, so one format serves both.
const ddmmyy = (iso) => {
	const d = new Date(iso);
	const p = (n) => String(n).padStart(2, '0');
	return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)}`;
};
const eur = (n) => (n == null ? null : '€' + Math.round(n).toLocaleString('en-GB').replace(/,/g, ','));
const eurEs = (n) => (n == null ? null : Math.round(n).toLocaleString('de-DE') + ' €');
const pct = (now, was) => (was && now ? ((now - was) / was) * 100 : null);
const signed = (p, dp = 1) => (p == null ? null : (p >= 0 ? '+' : '') + p.toFixed(dp) + '%');

const unsubToken = (email) =>
	crypto.createHmac('sha256', SECRET).update(String(email).toLowerCase()).digest('hex').slice(0, 32);
const unsubUrl = (email, lang) =>
	`${SITE}/api/unsubscribe?e=${encodeURIComponent(String(email).toLowerCase())}&t=${unsubToken(email)}&lang=${lang}`;

// ---------------------------------------------------------------- the data
const now = JSON.parse(fs.readFileSync(DATA, 'utf8'));
if (!now?.towns?.length) {
	console.error('no towns in budget-data.json, refusing to send an empty email');
	process.exit(1);
}

// Compare against the newest snapshot that is old enough to mean something.
// Under MIN_GAP days apart, day-to-day listing churn dominates and the movement
// column would be noise sold as a trend, so it is dropped instead.
const MIN_GAP = 20;
const nowMs = Date.parse(now.updatedAt);
let prev = null;
try {
	const files = fs
		.readdirSync(HIST)
		.filter((f) => /^budget-\d{4}-\d{2}-\d{2}\.json$/.test(f))
		.sort();
	for (const f of files.reverse()) {
		const d = JSON.parse(fs.readFileSync(`${HIST}/${f}`, 'utf8'));
		const days = (nowMs - Date.parse(d.updatedAt)) / 86400000;
		if (days >= MIN_GAP) { prev = d; break; }
	}
} catch {}

const prevOf = (slug) => (prev ? prev.towns.find((t) => t.slug === slug) : null);

// Sorted by EUR/m2, which is the column that actually compares one town with
// another: a median asking price mostly reports how big the homes are.
const rows = now.towns
	.slice()
	.sort((a, b) => (a.m2eur || 0) - (b.m2eur || 0))
	.map((t) => {
		const p = prevOf(t.slug);
		return {
			name: t.name,
			slug: t.slug,
			n: t.n,
			med: t.medPrice,
			m2: t.m2eur,
			dM2: p ? pct(t.m2eur, p.m2eur) : null,
			dN: p ? t.n - p.n : null,
			oracle: t.oracle && t.oracle.verifiedPricePerSqm ? t.oracle : null,
		};
	});

const totalListings = rows.reduce((a, r) => a + (r.n || 0), 0);
const cheapest = rows[0];
const dearest = rows[rows.length - 1];
const movers = rows.filter((r) => r.dM2 != null).sort((a, b) => Math.abs(b.dM2) - Math.abs(a.dM2)).slice(0, 3);
const stamp = ddmmyy(now.updatedAt);
const prevStamp = prev ? ddmmyy(prev.updatedAt) : null;

// ---------------------------------------------------------------- the email
const T = {
	en: {
		subject: `Costa del Sol asking prices, ${stamp}`,
		preheader: `Median asking price and EUR per m2 across ${rows.length} towns, counted from ${totalListings.toLocaleString('en-GB')} live listings.`,
		title: 'The Costa del Sol market',
		intro: `Every figure below is counted from the ${totalListings.toLocaleString('en-GB')} homes for sale on the portal on ${stamp}. Asking prices, not sold prices.`,
		thTown: 'Town', thN: 'Listings', thMed: 'Median asking', thM2: 'EUR per m2', thChg: `EUR per m2 vs ${prevStamp}`,
		movedH: 'What moved',
		movedNone: `This is the first issue with a comparison window, so movement starts in the next one.`,
		spreadH: 'The spread',
		spread: `${cheapest.name} is the cheapest of the ${rows.length} by EUR per m2 at ${eur(cheapest.m2)}, ${dearest.name} the dearest at ${eur(dearest.m2)}.`,
		ctaText: 'See what a budget buys, town by town',
		note: 'Median asking price is the middle listing, so half the homes in that town ask more and half ask less. EUR per m2 uses listings that state a build size.',
		why: 'You are getting this because you asked for the Costa del Sol market email on info.propertylist.es.',
		unsub: 'Unsubscribe',
		privacy: 'Privacy',
	},
	es: {
		subject: `Precios de salida en la Costa del Sol, ${stamp}`,
		preheader: `Precio medio de salida y euros por m2 en ${rows.length} municipios, contados sobre ${totalListings.toLocaleString('de-DE')} anuncios en vivo.`,
		title: 'El mercado de la Costa del Sol',
		intro: `Cada cifra de abajo está contada sobre las ${totalListings.toLocaleString('de-DE')} viviendas en venta en el portal el ${stamp}. Precios de salida, no precios de venta.`,
		thTown: 'Municipio', thN: 'Anuncios', thMed: 'Mediana de salida', thM2: 'Euros por m2', thChg: `Euros por m2 vs ${prevStamp}`,
		movedH: 'Qué se ha movido',
		movedNone: 'Este es el primer número con ventana de comparación, así que el movimiento empieza en el siguiente.',
		spreadH: 'La horquilla',
		spread: `${cheapest.name} es el más barato de los ${rows.length} por euros por m2, con ${eurEs(cheapest.m2)}, y ${dearest.name} el más caro, con ${eurEs(dearest.m2)}.`,
		ctaText: 'Mira qué compra cada presupuesto, municipio a municipio',
		note: 'La mediana de salida es el anuncio central: la mitad de las viviendas de ese municipio piden más y la mitad piden menos. Los euros por m2 usan los anuncios que indican superficie construida.',
		why: 'Recibes este correo porque lo pediste en info.propertylist.es.',
		unsub: 'Darse de baja',
		privacy: 'Privacidad',
	},
};

const money = (lang, n) => (lang === 'es' ? eurEs(n) : eur(n));
const budgetUrl = (lang) => (lang === 'es' ? `${SITE}/es/presupuesto/` : `${SITE}/budget/`);
const privacyUrl = (lang) =>
	lang === 'es'
		? `${SITE}/es/docs/propertylist-mls-manual-de-usuario/legal/privacy-policy/`
		: `${SITE}/docs/propertylist-mls-user-manual/legal/privacy-policy/`;

const buildHtml = (lang, email) => {
	const t = T[lang];
	const cell = 'padding:10px 12px;border-bottom:1px solid #e5ecec;font-size:14px;color:#0d2b2e';
	const head = 'padding:10px 12px;border-bottom:2px solid #0d2b2e;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#4a5b5d;text-align:left';
	const trs = rows
		.map((r) => {
			const chg = signed(r.dM2);
			const chgCell = prev
				? `<td style="${cell};text-align:right;color:${r.dM2 == null ? '#8aa0a2' : r.dM2 >= 0 ? '#0d7a6a' : '#b0413e'}">${chg ? esc(chg) : '-'}</td>`
				: '';
			return (
				`<tr><td style="${cell}"><strong>${esc(r.name)}</strong></td>` +
				`<td style="${cell};text-align:right">${r.n.toLocaleString(lang === 'es' ? 'de-DE' : 'en-GB')}</td>` +
				`<td style="${cell};text-align:right">${esc(money(lang, r.med))}</td>` +
				`<td style="${cell};text-align:right">${esc(money(lang, r.m2))}</td>` +
				chgCell +
				`</tr>`
			);
		})
		.join('');

	const moved = prev && movers.length
		? `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#0d2b2e">` +
			movers
				.map((m) => {
					const dir = lang === 'es' ? (m.dM2 >= 0 ? 'sube' : 'baja') : m.dM2 >= 0 ? 'up' : 'down';
					return lang === 'es'
						? `<strong>${esc(m.name)}</strong> ${dir} un ${esc(Math.abs(m.dM2).toFixed(1))}% por m2${m.dN != null ? `, ${m.dN >= 0 ? '+' : ''}${m.dN} anuncios` : ''}.`
						: `<strong>${esc(m.name)}</strong> ${dir} ${esc(Math.abs(m.dM2).toFixed(1))}% per m2${m.dN != null ? `, ${m.dN >= 0 ? '+' : ''}${m.dN} listings` : ''}.`;
				})
				.join(' ') +
			`</p>`
		: `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#4a5b5d">${esc(t.movedNone)}</p>`;

	return (
		`<div style="background:#faf6ee;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
		`<span style="display:none;font-size:1px;color:#faf6ee;opacity:0">${esc(t.preheader)}</span>` +
		`<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5ecec;border-radius:16px;overflow:hidden">` +
		`<div style="background:#0d2b2e;padding:22px 26px">` +
		`<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#6fe5d3;font-weight:700">PropertyList</div>` +
		`<div style="font-size:24px;line-height:1.25;color:#fff;margin-top:6px">${esc(t.title)}</div>` +
		`<div style="font-size:13px;color:#b8c9cb;margin-top:4px">${esc(stamp)}</div></div>` +
		`<div style="padding:24px 26px">` +
		`<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#4a5b5d">${esc(t.intro)}</p>` +
		`<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:22px">` +
		`<tr><th style="${head}">${esc(t.thTown)}</th><th style="${head};text-align:right">${esc(t.thN)}</th>` +
		`<th style="${head};text-align:right">${esc(t.thMed)}</th><th style="${head};text-align:right">${esc(t.thM2)}</th>` +
		(prev ? `<th style="${head};text-align:right">${esc(t.thChg)}</th>` : '') +
		`</tr>${trs}</table>` +
		`<h3 style="margin:0 0 8px;font-size:16px;color:#0d2b2e">${esc(t.movedH)}</h3>${moved}` +
		`<h3 style="margin:18px 0 8px;font-size:16px;color:#0d2b2e">${esc(t.spreadH)}</h3>` +
		`<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#0d2b2e">${esc(t.spread)}</p>` +
		`<p style="margin:0 0 22px"><a href="${budgetUrl(lang)}" style="background:#00ae9a;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">${esc(t.ctaText)}</a></p>` +
		`<p style="margin:0;font-size:12.5px;line-height:1.6;color:#8aa0a2">${esc(t.note)}</p>` +
		`</div>` +
		`<div style="padding:18px 26px;background:#f7f9f9;border-top:1px solid #e5ecec;font-size:12px;line-height:1.6;color:#8aa0a2">` +
		`<p style="margin:0 0 6px">${esc(t.why)}</p>` +
		`<p style="margin:0"><a href="${esc(unsubUrl(email, lang))}" style="color:#4a5b5d">${esc(t.unsub)}</a> &middot; ` +
		`<a href="${privacyUrl(lang)}" style="color:#4a5b5d">${esc(t.privacy)}</a></p>` +
		`</div></div></div>`
	);
};

const buildText = (lang, email) => {
	const t = T[lang];
	const lines = rows.map((r) => {
		const chg = prev && r.dM2 != null ? `  ${signed(r.dM2)}` : '';
		return `  ${r.name}: ${r.n} ${lang === 'es' ? 'anuncios' : 'listings'}, ${money(lang, r.med)}, ${money(lang, r.m2)}/m2${chg}`;
	});
	return (
		`${t.title} - ${stamp}\n\n${t.intro}\n\n${lines.join('\n')}\n\n` +
		`${t.spreadH}: ${t.spread}\n\n${budgetUrl(lang)}\n\n${t.note}\n\n` +
		`${t.why}\n${t.unsub}: ${unsubUrl(email, lang)}\n`
	);
};

// ---------------------------------------------------------------- run
if (DRY) {
	for (const lang of ['en', 'es']) {
		const p = `${DIR}/var/admin/market-digest-preview-${lang}.html`;
		fs.writeFileSync(p, buildHtml(lang, 'preview@example.com'), 'utf8');
		console.log(`preview -> ${p}`);
	}
	console.log(`\nsubject EN: ${T.en.subject}\nsubject ES: ${T.es.subject}`);
	console.log(`snapshot ${stamp}, comparison ${prevStamp || 'none yet'}, towns ${rows.length}, listings ${totalListings}`);
	console.log('\n' + buildText('en', 'preview@example.com'));
	process.exit(0);
}

if (!SECRET) { console.error('NEWSLETTER_SECRET is not set; unsubscribe links would not verify. Refusing to send.'); process.exit(1); }
if (!KEY || !FROM) { console.error('mail not configured'); process.exit(1); }

let recipients = [];
if (TEST) {
	recipients = [{ email: TEST, lang: args.includes('--es') ? 'es' : 'en' }];
} else {
	let all = [];
	try { all = JSON.parse(fs.readFileSync(LIST, 'utf8')); } catch {}
	recipients = (Array.isArray(all) ? all : [])
		.filter((r) => r && r.email && !r.unsubscribedAt)
		.map((r) => ({ email: String(r.email).toLowerCase(), lang: r.lang === 'es' ? 'es' : 'en' }));

	// Once a month, unless forced. A second run in the same month is almost
	// always a cron misfire, and the reader cannot tell the difference.
	let state = {};
	try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
	const monthKey = now.updatedAt.slice(0, 7);
	if (!FORCE && state.lastMonth === monthKey) {
		console.log(`already sent for ${monthKey} (${state.lastSentAt}); use --force to override`);
		process.exit(0);
	}
	if (!recipients.length) { console.log('no subscribers, nothing to send'); process.exit(0); }
}

let sent = 0, failed = 0;
for (const r of recipients) {
	// One message per recipient: the unsubscribe link is signed for that address,
	// and nobody should ever see another subscriber's address in a To header.
	const body = {
		key: KEY,
		message: {
			from_email: FROM,
			from_name: FROM_NAME,
			to: [{ email: r.email, type: 'to' }],
			subject: T[r.lang].subject,
			html: buildHtml(r.lang, r.email),
			text: buildText(r.lang, r.email),
			headers: { 'List-Unsubscribe': `<${unsubUrl(r.email, r.lang)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
			tags: ['info-hub', 'market-digest'],
			track_opens: false,
			track_clicks: false,
		},
	};
	try {
		const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
		});
		const out = await res.json().catch(() => null);
		const ok = Array.isArray(out) && out[0] && (out[0].status === 'sent' || out[0].status === 'queued');
		if (ok) sent++; else { failed++; console.error('reject', r.email, JSON.stringify(out).slice(0, 200)); }
	} catch (e) {
		failed++; console.error('fail', r.email, String(e));
	}
	await new Promise((s) => setTimeout(s, 250));
}

if (!TEST) {
	fs.writeFileSync(STATE, JSON.stringify({ lastSentAt: new Date().toISOString(), lastMonth: now.updatedAt.slice(0, 7), sent, failed }, null, 2));
}
console.log(`market digest ${stamp}: sent ${sent}, failed ${failed}, recipients ${recipients.length}`);
