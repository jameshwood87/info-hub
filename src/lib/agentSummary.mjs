// The summary email an agent asks for from the "Not ready to create an account?"
// box (AgentInterestCta) or the exit-intent popup: what is free, what costs
// credits, what it replaces, and live features to try, CoAgent first.
//
// Plain JavaScript on purpose, so the /api/subscribe endpoint and
// scripts/agent-summary-preview.mjs build exactly the same email. Nothing here
// imports TypeScript: the caller passes in the live counts, the CoAgent WhatsApp
// number (src/data/coagent.ts) and the signed unsubscribe link.
//
// Every price and "free" line comes from the free-vs-paid and feature-status
// ledgers (brain/memory), checked against the live pages the email links to.
// Change a price there first, then here, EN and ES together.
// Deliberately NOT listed: Instant Brochure, because its live pages still say
// coming soon. Add it back once /instant-brochure/ and /pricing/ say it is live.
// No em or en dashes anywhere, in either language.

const SITE = 'https://info.propertylist.es';
const LOGO = `${SITE}/email-images/logo-email.png`;

const esc = (v) =>
	String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const COPY = {
	en: {
		htmlLang: 'en',
		subject: 'PropertyList: what is free, what costs credits',
		preheader: 'Everything free, every price in credits, what it replaces, and CoAgent to try on WhatsApp.',
		hello: 'Here is the summary you asked for.',
		intro: (s) =>
			`PropertyList is the MLS, CRM and property portal that ${s.agencies} agencies and ${s.agents} agents already share, with ${s.listings} live listings. Below is what is free, what costs credits and what it replaces, so you can read it properly or forward it to your business partner.`,
		freeTitle: 'Free, with no card and no contract',
		free: [
			'List your properties on the shared MLS and on the public portal propertylist.es, with no listing fees.',
			'The CRM core: contacts, calendar, and the Lead, Seller and Property pipelines.',
			'Your own agency microsite, created for you.',
			'XML import, and XML push to other portals.',
			'Property alerts that email your buyers when a match comes online.',
			'Leads from other agents and from your microsite, free for good. Leads from the portal, free for now.',
			'Starter allowances: your first 5 buyer leads, first 5 private listings, first 3 Property Intelligence Reports, and 25 photos per listing.',
			'Verifying your agency, any time, which adds 20 credits to your balance.',
			'CoAgent, your CRM on WhatsApp: 5 free messages a day for every agent.',
		],
		creditsTitle: 'What costs credits',
		creditsIntro: 'You only pay for what you choose. 1 credit is about €1: packs run from 20 credits for €20 to 1,000 credits for €800.',
		oneOff: [
			['Buyer lead', '1 credit, only when you move a qualified lead into the Buyer pipeline, after your first 5'],
			['Property Intelligence Report', '5 credits, after your first 3'],
			['Private listing', '5 credits, after your first 5'],
			['Featuring a listing', '10 credits for 3 days, 20 for 7, 30 for 15'],
			['Photos over 25', '1 credit each. Listings that already had more keep them free'],
			['Listing video upload', '5 credits'],
		],
		monthlyTitle: 'Monthly, only if you switch them on',
		monthly: [
			['Automation & Nurture', '20 credits a month'],
			['Website Builder', '50 credits a month, free to build and preview'],
			['Instant Content', '30 credits a month, requires the Website Builder'],
			['Network feed for your own website', '35 credits a month'],
			['CoAgent unlimited', '50 credits a month per agent'],
		],
		replacesTitle: 'What it replaces',
		replaces:
			'Most agencies pay €300 to €700 a month for a portal subscription, a CRM, a website and an XML feed. On PropertyList the core of that is free, and extras such as valuation reports are paid in credits only when you use them.',
		coTitle: 'Try CoAgent on WhatsApp',
		coBody:
			'CoAgent is your CRM on WhatsApp. Send a voice note after a viewing and it prepares the note, the change to what the client is looking for and the follow-up, and saves nothing until you reply YES. From the car, ask it for listings, your diary or a client brief.',
		coReady: 'It knows you by your WhatsApp number, so create your free account and add your number to your user before you message it.',
		coNumberLine: (n) => `The number: ${n}`,
		coButton: 'Message CoAgent on WhatsApp',
		coSoon:
			'The CoAgent number goes live at 9am on Tuesday 15 September. Before you message it, create your free account and add your WhatsApp number to your user.',
		coLink: 'See what CoAgent does',
		moreTitle: 'More you can try today',
		more: [
			['Instant Listing', 'Send the photos and describe the property in a voice note, and the listing is written for you.', '/instant-listing/'],
			['Website Builder', 'Fifteen finished agency website designs that show the whole network’s stock, filtered your way. Free to build and preview.', '/website-builder/'],
			['Pipelines and Nurture', 'Lead, Buyer, Seller and Property pipelines in one CRM, with Automation & Nurture to follow up for you.', '/pipelines/'],
		],
		cta: 'Create your free account',
		linkFree: 'Everything that is free',
		linkPricing: 'The full price list',
		footer: 'You asked for this summary on info.propertylist.es.',
		replyLine: 'Reply to this email with any question.',
		unsub: 'Unsubscribe',
		unsubLine: 'Do not want emails from PropertyList?',
		paths: { coagent: '/coagent/', free: '/free/', pricing: '/pricing/' },
		signup: 'https://agents.propertylist.es/new_agency/new?locale=en',
	},
	es: {
		htmlLang: 'es',
		subject: 'PropertyList: qué es gratis y qué cuesta créditos',
		preheader: 'Todo lo gratis, cada precio en créditos, a qué sustituye y CoAgent para probar en WhatsApp.',
		hello: 'Aquí tienes el resumen que pediste.',
		intro: (s) =>
			`PropertyList es el MLS, CRM y portal inmobiliario que ya comparten ${s.agencies} agencias y ${s.agents} agentes, con ${s.listings} anuncios activos. Aquí tienes qué es gratis, qué cuesta créditos y a qué sustituye, para que lo leas con calma o se lo pases a tu socio.`,
		freeTitle: 'Gratis, sin tarjeta y sin contrato',
		free: [
			'Publicar tus inmuebles en el MLS compartido y en el portal público propertylist.es, sin comisiones por anuncio.',
			'El núcleo del CRM: contactos, calendario y los pipelines de leads, vendedores e inmuebles.',
			'Tu propio microsite de agencia, creado para ti.',
			'Importación XML y envío XML a otros portales.',
			'Alertas que avisan por email a tus compradores cuando entra un inmueble que encaja.',
			'Los leads de otros agentes y de tu microsite, gratis siempre. Los leads del portal, gratis por ahora.',
			'Para empezar: tus 5 primeros leads de compradores, tus 5 primeros anuncios privados, tus 3 primeros Property Intelligence Reports y 25 fotos por anuncio.',
			'Verificar tu agencia, cuando quieras, que añade 20 créditos a tu saldo.',
			'CoAgent, tu CRM en WhatsApp: 5 mensajes gratis al día para cada agente.',
		],
		creditsTitle: 'Qué cuesta créditos',
		creditsIntro: 'Solo pagas lo que eliges. 1 crédito equivale a 1 € aproximadamente: los paquetes van de 20 créditos por 20 € a 1.000 créditos por 800 €.',
		oneOff: [
			['Lead de comprador', '1 crédito, solo cuando pasas un lead cualificado al pipeline de compradores, después de los 5 primeros'],
			['Property Intelligence Report', '5 créditos, después de los 3 primeros'],
			['Anuncio privado', '5 créditos, después de los 5 primeros'],
			['Destacar un anuncio', '10 créditos por 3 días, 20 por 7, 30 por 15'],
			['Fotos por encima de 25', '1 crédito cada una. Los anuncios que ya tenían más las conservan gratis'],
			['Vídeo del anuncio', '5 créditos'],
		],
		monthlyTitle: 'Mensuales, solo si los activas',
		monthly: [
			['Automation y Nurture', '20 créditos al mes'],
			['Constructor de webs', '50 créditos al mes, gratis crearla y previsualizarla'],
			['Contenido Instantáneo', '30 créditos al mes, requiere el Constructor de webs'],
			['Feed de la red para tu propia web', '35 créditos al mes'],
			['CoAgent ilimitado', '50 créditos al mes por agente'],
		],
		replacesTitle: 'A qué sustituye',
		replaces:
			'La mayoría de agencias paga de 300 € a 700 € al mes por una suscripción a un portal, un CRM, una web y un feed XML. En PropertyList el núcleo de todo eso es gratis, y los extras, como los informes de valoración, se pagan en créditos solo cuando los usas.',
		coTitle: 'Prueba CoAgent en WhatsApp',
		coBody:
			'CoAgent es tu CRM en WhatsApp. Mándale una nota de voz al salir de una visita: te prepara la nota, la actualización de lo que busca el cliente y el seguimiento, y no guarda nada hasta que respondes SÍ. Desde el coche, pídele inmuebles, tu agenda o la ficha de un cliente.',
		coReady: 'Te reconoce por tu número de WhatsApp, así que crea tu cuenta gratis y añade tu número a tu usuario antes de escribirle.',
		coNumberLine: (n) => `El número: ${n}`,
		coButton: 'Escribe a CoAgent por WhatsApp',
		coSoon:
			'El número de CoAgent estará disponible desde las 9:00 del martes 15 de septiembre. Antes de escribirle, crea tu cuenta gratis y añade tu número de WhatsApp a tu usuario.',
		coLink: 'Mira lo que hace CoAgent',
		moreTitle: 'Más para probar hoy',
		more: [
			['Listado Instantáneo', 'Manda las fotos y describe el inmueble en una nota de voz, y el anuncio se escribe por ti.', '/es/listado-instantaneo/'],
			['Constructor de webs', 'Quince diseños de web de agencia terminados que muestran el stock de toda la red, filtrado a tu manera. Gratis crearla y previsualizarla.', '/es/constructor-de-webs/'],
			['Pipelines y Nurture', 'Pipelines de leads, compradores, vendedores e inmuebles en un solo CRM, con Automation y Nurture para hacer el seguimiento por ti.', '/es/pipelines/'],
		],
		cta: 'Crea tu cuenta gratis',
		linkFree: 'Todo lo que es gratis',
		linkPricing: 'La lista de precios completa',
		footer: 'Pediste este resumen en info.propertylist.es.',
		replyLine: 'Responde a este email con cualquier duda.',
		unsub: 'Darte de baja',
		unsubLine: '¿No quieres recibir emails de PropertyList?',
		paths: { coagent: '/es/coagent/', free: '/es/gratis/', pricing: '/es/precios/' },
		signup: 'https://agents.propertylist.es/new_agency/new?locale=es',
	},
};

const waLink = (number) => {
	const digits = String(number || '').replace(/[^0-9]/g, '');
	return digits ? `https://wa.me/${digits}?text=${encodeURIComponent('PropertyList CoAgent')}` : '';
};

const button = (href, label, bg = '#00ae9a', color = '#ffffff') =>
	`<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${color};text-decoration:none;font-weight:bold;font-size:15px;line-height:20px;padding:12px 22px;border-radius:10px">${esc(label)}</a>`;

/**
 * Build the summary email.
 * @param {{ lang?: string, stats: { agencies: string, agents: string, listings: string }, coagentNumber?: string, unsubUrl?: string, hasReplyTo?: boolean }} opts
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildAgentSummary({ lang = 'en', stats, coagentNumber = '', unsubUrl = '', hasReplyTo = false }) {
	const c = COPY[lang === 'es' ? 'es' : 'en'];
	const wa = waLink(coagentNumber);
	const url = (p) => `${SITE}${p}`;

	const checkRows = c.free
		.map(
			(item) =>
				`<tr><td valign="top" style="padding:5px 10px 5px 0;color:#0a6d61;font-weight:bold;font-size:15px;line-height:22px">&#10003;</td>` +
				`<td style="padding:5px 0;font-size:14.5px;line-height:22px;color:#101828">${esc(item)}</td></tr>`,
		)
		.join('');
	const priceRows = (rows) =>
		rows
			.map(
				([label, price]) =>
					`<tr><td valign="top" style="padding:9px 14px 9px 0;border-top:1px solid #e9efee;font-size:14px;line-height:20px;font-weight:bold;color:#101828;width:42%">${esc(label)}</td>` +
					`<td valign="top" style="padding:9px 0;border-top:1px solid #e9efee;font-size:14px;line-height:20px;color:#475467">${esc(price)}</td></tr>`,
			)
			.join('');
	const section = (title, inner) =>
		`<tr><td style="padding:28px 32px 0"><h2 style="margin:0 0 12px;font-size:17px;line-height:24px;color:#0a6d61;font-family:Arial,Helvetica,sans-serif">${esc(title)}</h2>${inner}</td></tr>`;
	const table = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;

	const coagentAction = wa
		? `<p style="margin:14px 0 6px;font-size:14px;line-height:21px;color:#c9d5d3">${esc(c.coReady)}</p>` +
			`<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#ffffff;font-weight:bold">${esc(c.coNumberLine(coagentNumber))}</p>` +
			`<p style="margin:0">${button(wa, c.coButton, '#25d366', '#0b1220')}</p>`
		: `<p style="margin:14px 0 16px;font-size:14px;line-height:21px;color:#c9d5d3">${esc(c.coSoon)}</p>` +
			`<p style="margin:0">${button(url(c.paths.coagent), c.coLink, '#5eead4', '#0b1220')}</p>`;

	const moreRows = c.more
		.map(
			([name, desc, path]) =>
				`<tr><td style="padding:12px 0;border-top:1px solid #e9efee">` +
				`<a href="${esc(url(path))}" style="color:#0a6d61;font-weight:bold;font-size:15px;line-height:22px;text-decoration:none">${esc(name)} &rsaquo;</a>` +
				`<div style="font-size:14px;line-height:21px;color:#475467;margin-top:2px">${esc(desc)}</div></td></tr>`,
		)
		.join('');

	const footerHtml =
		`${esc(c.footer)}${hasReplyTo ? ' ' + esc(c.replyLine) : ''}<br>` +
		(unsubUrl ? `${esc(c.unsubLine)} <a href="${esc(unsubUrl)}" style="color:#667085;text-decoration:underline">${esc(c.unsub)}</a><br>` : '') +
		`PropertyList &middot; <a href="${SITE}/" style="color:#667085">info.propertylist.es</a>`;

	const html =
		`<!doctype html><html lang="${c.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>` +
		`<body style="margin:0;padding:0;background:#eef3f2">` +
		`<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef3f2">${esc(c.preheader)}</div>` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f2"><tr><td align="center" style="padding:24px 12px">` +
		`<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;font-family:Arial,Helvetica,sans-serif;color:#101828">` +
		`<tr><td style="padding:28px 32px 6px"><img src="${LOGO}" width="140" height="45" alt="PropertyList" style="display:block;border:0;outline:none"></td></tr>` +
		`<tr><td style="padding:10px 32px 0"><h1 style="margin:0 0 12px;font-size:24px;line-height:30px;color:#0b1220;font-family:Arial,Helvetica,sans-serif">${esc(c.hello)}</h1>` +
		`<p style="margin:0;font-size:15px;line-height:23px;color:#475467">${esc(c.intro(stats))}</p></td></tr>` +
		section(c.freeTitle, table(checkRows)) +
		section(
			c.creditsTitle,
			`<p style="margin:0 0 10px;font-size:14px;line-height:21px;color:#475467">${esc(c.creditsIntro)}</p>` +
				table(priceRows(c.oneOff)) +
				`<p style="margin:18px 0 8px;font-size:14px;line-height:20px;font-weight:bold;color:#0b1220">${esc(c.monthlyTitle)}</p>` +
				table(priceRows(c.monthly)),
		) +
		section(c.replacesTitle, `<p style="margin:0;font-size:14.5px;line-height:23px;color:#101828">${esc(c.replaces)}</p>`) +
		`<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:12px"><tr><td style="padding:24px 24px 26px">` +
		`<h2 style="margin:0 0 10px;font-size:19px;line-height:26px;color:#5eead4;font-family:Arial,Helvetica,sans-serif">${esc(c.coTitle)}</h2>` +
		`<p style="margin:0;font-size:14.5px;line-height:23px;color:#ffffff">${esc(c.coBody)}</p>` +
		coagentAction +
		`</td></tr></table></td></tr>` +
		section(c.moreTitle, table(moreRows)) +
		`<tr><td align="center" style="padding:30px 32px 8px">${button(c.signup, c.cta)}</td></tr>` +
		`<tr><td align="center" style="padding:6px 32px 30px;font-size:14px;line-height:22px">` +
		`<a href="${esc(url(c.paths.free))}" style="color:#0a6d61;text-decoration:underline">${esc(c.linkFree)}</a>` +
		`<span style="color:#98a2b3">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>` +
		`<a href="${esc(url(c.paths.pricing))}" style="color:#0a6d61;text-decoration:underline">${esc(c.linkPricing)}</a></td></tr>` +
		`</table>` +
		`<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td style="padding:16px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:19px;color:#667085;text-align:center">` +
		footerHtml +
		`</td></tr></table>` +
		`</td></tr></table></body></html>`;

	const bullet = (s) => `- ${s}`;
	const priceLine = ([label, price]) => `- ${label}: ${price}`;
	const text = [
		c.hello,
		'',
		c.intro(stats),
		'',
		c.freeTitle.toUpperCase(),
		...c.free.map(bullet),
		'',
		c.creditsTitle.toUpperCase(),
		c.creditsIntro,
		...c.oneOff.map(priceLine),
		'',
		c.monthlyTitle,
		...c.monthly.map(priceLine),
		'',
		c.replacesTitle.toUpperCase(),
		c.replaces,
		'',
		c.coTitle.toUpperCase(),
		c.coBody,
		...(wa ? [c.coReady, c.coNumberLine(coagentNumber), wa] : [c.coSoon, url(c.paths.coagent)]),
		'',
		c.moreTitle.toUpperCase(),
		...c.more.map(([name, desc, path]) => `- ${name}: ${desc} ${url(path)}`),
		'',
		`${c.cta}: ${c.signup}`,
		`${c.linkFree}: ${url(c.paths.free)}`,
		`${c.linkPricing}: ${url(c.paths.pricing)}`,
		'',
		hasReplyTo ? `${c.footer} ${c.replyLine}` : c.footer,
		...(unsubUrl ? [`${c.unsubLine} ${c.unsub}: ${unsubUrl}`] : []),
		'PropertyList, info.propertylist.es',
	].join('\n');

	return { subject: c.subject, html, text };
}

/**
 * Send the summary to one address through Mandrill. Never throws.
 * Logs failures with an [agent-summary] prefix and never logs the address.
 * @returns {Promise<{ status: 'sent' | 'rejected' | 'error' | 'not_configured', detail?: string }>}
 */
export async function sendAgentSummary({ email, lang, stats, coagentNumber, unsubUrl, key, from, fromName, replyTo }) {
	if (!key || !from || !email) return { status: 'not_configured' };
	const { subject, html, text } = buildAgentSummary({ lang, stats, coagentNumber, unsubUrl, hasReplyTo: !!replyTo });
	const headers = {};
	if (replyTo) headers['Reply-To'] = replyTo;
	if (unsubUrl) {
		headers['List-Unsubscribe'] = `<${unsubUrl}>`;
		headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
	}
	try {
		const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: AbortSignal.timeout(8000),
			body: JSON.stringify({
				key,
				message: {
					from_email: from,
					from_name: fromName || 'PropertyList',
					to: [{ email, type: 'to' }],
					subject,
					html,
					text,
					...(Object.keys(headers).length ? { headers } : {}),
					tags: ['info-hub', 'agent-summary'],
					track_opens: false,
					track_clicks: false,
				},
			}),
		});
		if (!res.ok) {
			console.error('[agent-summary] mandrill http %s', res.status);
			return { status: 'error', detail: `http ${res.status}` };
		}
		const out = await res.json().catch(() => null);
		const r = Array.isArray(out) ? out[0] : null;
		if (r && (r.status === 'sent' || r.status === 'queued' || r.status === 'scheduled')) return { status: 'sent' };
		const reason = r ? `${r.status}${r.reject_reason ? ' ' + r.reject_reason : ''}` : 'no result';
		console.error('[agent-summary] mandrill did not send: %s', reason);
		return { status: 'rejected', detail: reason };
	} catch (err) {
		console.error('[agent-summary] send failed: %s', err && err.name ? err.name : 'error');
		return { status: 'error', detail: 'exception' };
	}
}
