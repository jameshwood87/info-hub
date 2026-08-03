import { areaMarketSummary } from './marketData';

// The market breakdown we promise the seller on /what-is-my-property-worth/.
// Everything here is built from real MCP/Oracle figures - if a number is missing we drop
// the line rather than guess. Never call this a valuation or tasacion (regulated in Spain
// under Orden ECO/805/2003); it is an indicative market guide.

const KEY = (process.env.MANDRILL_API_KEY || '').trim();
const FROM = (process.env.NOTIFY_FROM || '').trim();
const SITE = 'https://info.propertylist.es';

// Node on this droplet is small-ICU, so Intl does not apply es-ES separators reliably.
const group = (n: number, lang: string) => {
	const s = Math.round(n).toLocaleString('en-GB');
	return lang === 'es' ? s.replace(/,/g, '.') : s;
};
const eur = (n: number | null | undefined, lang: string) =>
	typeof n === 'number' && Number.isFinite(n) ? `€${group(n, lang)}` : null;

const esc = (v: unknown) =>
	String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type SellerFacts = {
	email: string;
	name?: string;
	area: string;
	builtSqm?: string | number;
	estimateLow?: string | number;
	estimateHigh?: string | number;
	basis?: string;
	lang?: string;
};

export const sendSellerBreakdown = async (f: SellerFacts): Promise<boolean> => {
	if (!KEY || !FROM || !f.email || !f.area) return false;
	const lang = f.lang === 'es' ? 'es' : 'en';

	let sale = null;
	let rent = null;
	try {
		[sale, rent] = await Promise.all([
			areaMarketSummary(f.area, 'for-sale'),
			areaMarketSummary(f.area, 'for-rent'),
		]);
	} catch {
		/* fall through - we still send what we have */
	}
	if (!sale) return false;

	const t =
		lang === 'es'
			? {
					subject: `Tu desglose de mercado - ${f.area}`,
					hi: f.name ? `Hola ${f.name},` : 'Hola,',
					intro: `Aquí tienes el detalle que hay detrás de la cifra que viste para ${f.area}.`,
					yours: 'Tu guía orientativa',
					forSize: (m: string) => `Para ${m} m² en ${f.area}`,
					keyTitle: 'Lo que de verdad importa',
					registered: 'Precio registrado (ventas ante notario)',
					asking: 'Precio de salida (lo que se pide)',
					gapLine: (g: string) =>
						`La diferencia es de aproximadamente <strong>${g}</strong>. Ese hueco es el que suele dejar una propiedad parada durante meses.`,
					areaTitle: `El mercado en ${f.area} ahora mismo`,
					median: 'Precio medio de venta',
					onMarket: 'Propiedades a la venta ahora',
					range: 'Rango de precios',
					rentLine: 'Alquiler de larga duración (media)',
					bedTitle: 'Por dormitorios',
					adviceTitle: 'Qué hacer con esto',
					a1: '<strong>Fija el precio con datos registrados, no con anuncios.</strong> Lo que piden tus vecinos no es lo que han cobrado.',
					a2: '<strong>Las primeras dos semanas mandan.</strong> Una propiedad bien valorada mueve visitas pronto; una cara se queda quieta y luego hay que bajar.',
					a3: '<strong>Pide comparables reales.</strong> Cualquier agencia seria debería enseñarte con qué ventas concretas ha valorado la tuya.',
					proof: 'Ver la verificación notarial',
					sourceLine: (n: string, d: string) => `Fuente: registro notarial español, ${n} ventas hasta ${d}.`,
					disclaimer:
						'Esto es una guía de mercado, no una tasación formal, y no constituye asesoramiento legal, fiscal ni financiero. Las cifras son estimaciones a partir de datos de mercado disponibles y no están garantizadas.',
					why: 'Recibes este email porque lo pediste en info.propertylist.es.',
				}
			: {
					subject: `Your market breakdown - ${f.area}`,
					hi: f.name ? `Hi ${f.name},` : 'Hi,',
					intro: `Here is the detail behind the number you saw for ${f.area}.`,
					yours: 'Your indicative guide',
					forSize: (m: string) => `For ${m} m² in ${f.area}`,
					keyTitle: 'The bit that actually matters',
					registered: 'Registered price (notarised sales)',
					asking: 'Asking price (what sellers want)',
					gapLine: (g: string) =>
						`The gap is roughly <strong>${g}</strong>. That gap is what leaves a property sitting on the market for months.`,
					areaTitle: `The ${f.area} market right now`,
					median: 'Median asking price',
					onMarket: 'Properties for sale now',
					range: 'Price range',
					rentLine: 'Long-term rental (median)',
					bedTitle: 'By bedroom count',
					adviceTitle: 'What to do with this',
					a1: '<strong>Price off registered sales, not listings.</strong> What your neighbours are asking is not what they got.',
					a2: '<strong>The first two weeks decide it.</strong> A well-priced property gets viewings early; an ambitious one sits, then has to drop anyway.',
					a3: '<strong>Ask for real comparables.</strong> Any serious agent should show you which specific sales they priced yours against.',
					proof: 'See the notarial verification',
					sourceLine: (n: string, d: string) => `Source: Spanish notarial register, ${n} sales to ${d}.`,
					disclaimer:
						'This is a market guide, not a formal valuation, and it is not legal, tax or financial advice. Figures are estimates from available market data and are not guaranteed.',
					why: 'You are receiving this because you asked for it on info.propertylist.es.',
				};

	const rows: string[] = [];
	const row = (label: string, value: string | null) =>
		value
			? rows.push(
					`<tr><td style="padding:7px 18px 7px 0;color:#667085;font-size:14px">${esc(label)}</td>` +
						`<td style="padding:7px 0;color:#101828;font-size:14px"><strong>${value}</strong></td></tr>`,
				)
			: null;

	const regSqm = sale.oracle?.verified ? sale.oracle.verifiedPricePerSqm : null;
	const askSqm = sale.medianPricePerSqm;

	// headline range
	const low = Number(f.estimateLow);
	const high = Number(f.estimateHigh);
	const hasRange = Number.isFinite(low) && Number.isFinite(high) && low > 0;

	// the registered-vs-asking contrast, the reason this email is worth reading
	let contrast = '';
	if (regSqm && askSqm && askSqm > regSqm) {
		const gapPct = Math.round(((askSqm - regSqm) / regSqm) * 100);
		contrast =
			`<h3 style="margin:26px 0 10px;font-size:16px;color:#101828">${esc(t.keyTitle)}</h3>` +
			`<table style="border-collapse:collapse">` +
			`<tr><td style="padding:7px 18px 7px 0;color:#667085;font-size:14px">${esc(t.registered)}</td>` +
			`<td style="padding:7px 0;font-size:14px"><strong style="color:#0a6d61">${eur(regSqm, lang)}/m²</strong></td></tr>` +
			`<tr><td style="padding:7px 18px 7px 0;color:#667085;font-size:14px">${esc(t.asking)}</td>` +
			`<td style="padding:7px 0;font-size:14px"><strong>${eur(askSqm, lang)}/m²</strong></td></tr>` +
			`</table>` +
			`<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:rgba(16,24,40,0.75)">${t.gapLine(gapPct + '%')}</p>`;
	}

	row(t.median, eur(sale.medianPrice, lang));
	row(t.onMarket, sale.totalListings ? group(sale.totalListings, lang) : null);
	if (sale.minPrice && sale.maxPrice)
		row(t.range, `${eur(sale.minPrice, lang)} - ${eur(sale.maxPrice, lang)}`);
	if (rent?.medianPrice) row(t.rentLine, `${eur(rent.medianPrice, lang)}/mo`);

	// bedroom bands, only when there is something real to show
	const bands = Object.entries(sale.byBedroomBand || {}).filter(([, v]) => Number(v) > 0);
	const bandsHtml = bands.length
		? `<h3 style="margin:26px 0 10px;font-size:16px;color:#101828">${esc(t.bedTitle)}</h3>` +
			`<table style="border-collapse:collapse">` +
			bands
				.slice(0, 6)
				.map(
					([k, v]) =>
						`<tr><td style="padding:5px 18px 5px 0;color:#667085;font-size:14px">${esc(k)}</td>` +
						`<td style="padding:5px 0;color:#101828;font-size:14px"><strong>${group(Number(v), lang)}</strong></td></tr>`,
				)
				.join('') +
			`</table>`
		: '';

	const proof = sale.oracle?.attestationUrl
		? `<p style="margin:14px 0 0;font-size:13px"><a href="${esc(sale.oracle.attestationUrl)}" style="color:#0a6d61;font-weight:700">${esc(t.proof)} →</a></p>`
		: '';
	const source =
		sale.oracle?.verified && sale.oracle.sampleSize && sale.oracle.periodEnd
			? `<p style="margin:8px 0 0;font-size:12.5px;color:rgba(16,24,40,0.55)">${esc(t.sourceLine(group(sale.oracle.sampleSize, lang), sale.oracle.periodEnd))}</p>`
			: '';

	const html =
		`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#101828">` +
		`<p style="font-size:15px;margin:0 0 6px">${esc(t.hi)}</p>` +
		`<p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:rgba(16,24,40,0.78)">${esc(t.intro)}</p>` +
		(hasRange
			? `<div style="padding:20px 22px;border:1px solid rgba(0,174,154,0.3);border-radius:14px;background:rgba(0,174,154,0.06)">` +
				`<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:rgba(16,24,40,0.55)">${esc(t.yours)}</div>` +
				`<div style="font-size:28px;font-weight:900;color:#0a6d61;margin:6px 0 4px">${eur(low, lang)} - ${eur(high, lang)}</div>` +
				(f.builtSqm
					? `<div style="font-size:13px;color:rgba(16,24,40,0.6)">${esc(t.forSize(String(f.builtSqm)))}</div>`
					: '') +
				`</div>`
			: '') +
		contrast +
		(rows.length
			? `<h3 style="margin:26px 0 10px;font-size:16px;color:#101828">${esc(t.areaTitle)}</h3>` +
				`<table style="border-collapse:collapse">${rows.join('')}</table>`
			: '') +
		bandsHtml +
		proof +
		source +
		`<h3 style="margin:26px 0 10px;font-size:16px;color:#101828">${esc(t.adviceTitle)}</h3>` +
		`<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:rgba(16,24,40,0.8)">` +
		`<li>${t.a1}</li><li>${t.a2}</li><li>${t.a3}</li></ul>` +
		`<p style="margin:26px 0 0;font-size:12px;line-height:1.55;color:rgba(16,24,40,0.5)">${esc(t.disclaimer)}</p>` +
		`<p style="margin:8px 0 0;font-size:12px;color:rgba(16,24,40,0.45)">${esc(t.why)} ` +
		`<a href="${SITE}/" style="color:rgba(16,24,40,0.55)">info.propertylist.es</a></p>` +
		`</div>`;

	const text =
		`${t.hi}\n\n${t.intro}\n\n` +
		(hasRange ? `${t.yours}: ${eur(low, lang)} - ${eur(high, lang)}\n` : '') +
		(regSqm ? `${t.registered}: ${eur(regSqm, lang)}/m2\n` : '') +
		(askSqm ? `${t.asking}: ${eur(askSqm, lang)}/m2\n` : '') +
		`\n${t.disclaimer}\n`;

	try {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 10000);
		try {
			const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				signal: ctl.signal,
				body: JSON.stringify({
					key: KEY,
					message: {
						from_email: FROM,
						from_name: 'PropertyList',
						to: [{ email: f.email, type: 'to' }],
						subject: t.subject,
						html,
						text,
						tags: ['info-hub', 'seller-breakdown'],
						track_opens: true,
						track_clicks: true,
					},
				}),
			});
			const out = await res.json().catch(() => null);
			return Array.isArray(out) && out[0]?.status && out[0].status !== 'rejected';
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return false;
	}
};
