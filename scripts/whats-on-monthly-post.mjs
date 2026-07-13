#!/usr/bin/env node
/**
 * whats-on-monthly-post.mjs - monthly "What's On in {town}" blog post
 * for info.propertylist.es, composed from the events store (var/admin/events/{town}.json).
 *
 * The event listings (names, dates, times, venues, blurbs) are assembled
 * DETERMINISTICALLY from the curated store - the AI writes only the intro,
 * with a static fallback, so the post can never contain invented events.
 * EN and ES are both composed from the store's bilingual fields.
 *
 * Cron: monthly on the 26th, generating NEXT month's post for every town
 * in TOWNS. Usage:
 *   node scripts/whats-on-monthly-post.mjs [--month=YYYY-MM] [--town=key] [--dry-run]
 */
import fs from 'node:fs';

try {
	const envPath = new URL('../.env', import.meta.url).pathname;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && (process.env[m[1]] == null || process.env[m[1]] === '')) {
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
} catch {}

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';
const AI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const DRY = process.argv.includes('--dry-run');
const MIN_EVENTS = 8;

const TOWNS = [
	{
		key: 'marbella',
		nameEn: 'Marbella', nameEs: 'Marbella',
		store: '/opt/info-hub/var/admin/events/marbella.json',
		pageEn: '/whats-on/marbella/', pageEs: '/es/que-hacer/marbella/',
		areaGuideEn: '/neighbourhood/spain/malaga/marbella/', areaGuideEs: '/es/barrios/marbella/',
		image: ['/area-images/marbella.jpg', 'Marbella, Costa del Sol'],
		marketsEn: 'The weekly street markets run all year: Monday at Las Albarizas (Marbella), Thursday in San Pedro Alcantara (Recinto Ferial) and Saturday at Centro Plaza (Nueva Andalucia). Mornings only - go before 14:00.',
		marketsEs: 'Los mercadillos semanales funcionan todo el ano: lunes en Las Albarizas (Marbella), jueves en San Pedro Alcantara (Recinto Ferial) y sabado en Centro Plaza (Nueva Andalucia). Solo por la manana - ve antes de las 14:00.',
	},
	{
		key: 'estepona',
		nameEn: 'Estepona', nameEs: 'Estepona',
		store: '/opt/info-hub/var/admin/events/estepona.json',
		pageEn: '/whats-on/estepona/', pageEs: '/es/que-hacer/estepona/',
		areaGuideEn: '/neighbourhood/spain/malaga/estepona/', areaGuideEs: '/es/barrios/estepona/',
		image: ['/area-images/estepona.jpg', 'Estepona, Costa del Sol'],
		marketsEn: 'The big Wednesday street market fills Calle Eslovaquia (off Avenida Juan Carlos I) from 09:00 to 14:30 with 250+ stalls, and the Sunday marina market runs at the Puerto Deportivo from 09:00 to 14:00.',
		marketsEs: 'El gran mercadillo de los miercoles llena la Calle Eslovaquia (junto a la Avenida Juan Carlos I) de 09:00 a 14:30 con mas de 250 puestos, y el mercadillo del puerto abre los domingos de 09:00 a 14:00.',
	},
	{
		key: 'malaga',
		nameEn: 'Malaga', nameEs: 'Málaga',
		store: '/opt/info-hub/var/admin/events/malaga.json',
		pageEn: '/whats-on/malaga/', pageEs: '/es/que-hacer/malaga/',
		areaGuideEn: '/neighbourhood/spain/malaga/malaga-centre/', areaGuideEs: '/es/barrios/malaga-centre/',
		image: ['/area-images/malaga-centre.jpg', 'Malaga city centre'],
		marketsEn: 'The 1879 Atarazanas market hall trades Monday to Saturday mornings (08:00 - 14:00), and the big Sunday rastro runs at the Recinto Ferial (Cortijo de Torres) from 09:00 to 15:00 with 300+ stalls.',
		marketsEs: 'El mercado de Atarazanas (1879) abre de lunes a sabado por la manana (08:00 - 14:00), y el gran rastro dominical funciona en el Recinto Ferial (Cortijo de Torres) de 09:00 a 15:00 con mas de 300 puestos.',
	},
];

// ---- helpers ----
const noDashes = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ');
// store titles carry category suffixes like "Rosario (concert)" - drop them in prose
const deSuffix = (s) => String(s || '').replace(/\s*\((concert|concierto|exhibition|exposicion|exposición|festival|theatre|teatro|dance|danza)\)\s*$/i, '');
const esc = (s) => noDashes(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const fmtLong = (iso, locale) =>
	new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(iso + 'T12:00:00Z'));
const fmtShort = (iso, locale) =>
	new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(iso + 'T12:00:00Z'));

async function aiJson(messages, maxTokens = 2500) {
	const url = `${AI_BASE}/chat/completions`;
	const headers = { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' };
	const base = { model: MODEL, messages, response_format: { type: 'json_object' } };
	for (const body of [{ ...base, max_tokens: maxTokens }, { ...base, max_completion_tokens: maxTokens }]) {
		const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
		const text = await res.text();
		if (res.ok) return JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}');
		if (!/max_tokens|max_completion_tokens|unsupported/i.test(text)) throw new Error(`AI ${res.status}: ${text.slice(0, 200)}`);
	}
	throw new Error('AI request failed');
}

async function directus(path, { method = 'GET', body } = {}) {
	const res = await fetch(`${DIRECTUS_URL}${path}`, {
		method,
		headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(`Directus ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

async function setFeaturedImage(id, url, alt) {
	const token = (process.env.INTERNAL_META_TOKEN || '').trim();
	if (!token || !id) return;
	try {
		await fetch('http://127.0.0.1:3000/api/internal/set-meta', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
			body: JSON.stringify({ id: String(id), featuredImageUrl: url, featuredImageAlt: alt }),
		});
	} catch {}
}

// ---- month selection: default is NEXT month (cron runs on the 26th) ----
const monthArg = (process.argv.find((a) => a.startsWith('--month=')) || '').slice(8);
let [year, month] = monthArg ? monthArg.split('-').map(Number) : [0, 0];
if (!year || !month) {
	const now = new Date();
	year = now.getFullYear(); month = now.getMonth() + 2;
	if (month > 12) { month = 1; year++; }
}
const mm = String(month).padStart(2, '0');
const monthStart = `${year}-${mm}-01`;
const monthEnd = `${year}-${mm}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
const monthEn = cap(new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(monthStart + 'T12:00:00Z')));
const monthEs = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(monthStart + 'T12:00:00Z'));

const townArg = (process.argv.find((a) => a.startsWith('--town=')) || '').slice(7);
const towns = townArg ? TOWNS.filter((t) => t.key === townArg) : TOWNS;

for (const town of towns) {
	console.log(`\n=== ${town.nameEn} - ${monthEn} ${year} ===`);
	let store;
	try { store = JSON.parse(fs.readFileSync(town.store, 'utf8')); } catch { console.log('no events store - skipping'); continue; }

	const evs = (store.events || []).filter((e) => {
		const s = e.start || '';
		return s && s <= monthEnd && (e.end || s) >= monthStart;
	});
	if (evs.length < MIN_EVENTS) { console.log(`only ${evs.length} events for ${monthEn} (<${MIN_EVENTS}) - skipping`); continue; }

	const days = (e) => (new Date((e.end || e.start) + 'T12:00:00Z') - new Date(e.start + 'T12:00:00Z')) / 86400000;
	const ongoing = evs.filter((e) => days(e) > 3).sort((a, b) => (a.end || a.start).localeCompare(b.end || b.start));
	const oneOff = evs.filter((e) => days(e) <= 3).sort((a, b) => (a.start + (a.time || '')).localeCompare(b.start + (b.time || '')));
	const headliners = oneOff.filter((e) => ['music', 'festival', 'nightlife'].includes(e.category));
	const diary = oneOff.filter((e) => !['music', 'festival', 'nightlife'].includes(e.category));

	const slug = `whats-on-${town.key}-${monthEn.toLowerCase()}-${year}`;

	// skip if this month's post already exists
	const existing = await directus(`/items/kb_pages?filter[path][_eq]=${encodeURIComponent('/blog/' + slug)}&fields=id&limit=1`).catch(() => null);
	if (existing?.data?.length) { console.log(`/blog/${slug} already exists - skipping`); continue; }

	// ---- deterministic listing HTML (no AI anywhere near the facts) ----
	const li = (e, lang) => {
		const title = deSuffix(lang === 'en' ? (e.titleEn || e.title) : (e.titleEs || e.title));
		const blurb = lang === 'en' ? e.blurbEn : e.blurbEs;
		const locale = lang === 'en' ? 'en-GB' : 'es-ES';
		let when;
		if (days(e) > 0) {
			when = lang === 'en'
				? (e.start >= monthStart ? `${fmtShort(e.start, locale)} to ${fmtShort(e.end, locale)}` : `until ${fmtShort(e.end, locale)}`)
				: (e.start >= monthStart ? `del ${fmtShort(e.start, locale)} al ${fmtShort(e.end, locale)}` : `hasta el ${fmtShort(e.end, locale)}`);
		} else {
			when = fmtLong(e.start, locale) + (e.time ? ` - ${e.time}` : '');
		}
		const where = [e.venue, e.town].filter(Boolean).join(', ');
		return `<li><strong>${esc(title)}</strong><br>${esc(cap(when))}${where ? ` &middot; ${esc(where)}` : ''}${blurb ? `<br>${esc(blurb)}` : ''}</li>`;
	};
	const list = (arr, lang) => `<ul>\n${arr.map((e) => li(e, lang)).join('\n')}\n</ul>`;

	const counts = { total: evs.length, headliners: headliners.length, diary: diary.length, ongoing: ongoing.length };
	const topNames = headliners.slice(0, 5).map((e) => deSuffix(e.titleEn || e.title)).join(', ');

	// ---- intro: AI-written, grounded, with a static fallback ----
	let intro = null;
	if (AI_KEY) {
		try {
			intro = await aiJson([{
				role: 'user',
				content: `Write the intro for a monthly events guide blog post, in BOTH English and Spanish. Return JSON {"introEn":"<p>...</p><p>...</p>","introEs":"<p>...</p><p>...</p>"} - exactly two short <p> paragraphs per language, max 110 words per language total.
Facts you may use (do NOT add any other names, dates or claims):
- Town: ${town.nameEn}, month: ${monthEn} ${year}.
- ${counts.total} curated events this month, including headline concerts: ${topNames || 'none'}.
- The live diary at info.propertylist.es lets readers build a free day plan, share it, and export it to their calendar.
Voice: warm, useful, local-expert; write for holiday-makers and residents. Plain hyphens only - NEVER em-dashes or en-dashes. The Spanish must be natural, not a literal translation.`,
			}], 6000);
		} catch (e) { console.log('AI intro failed, using fallback:', e.message); }
	}
	const introEn = noDashes(intro?.introEn) ||
		`<p>${town.nameEn} does not slow down in ${monthEn}. This guide lists ${counts.total} real, verified events happening across the municipality this month - concerts, festivals, exhibitions and the weekly street markets - pulled from our live diary, which is updated every week.</p><p>Every event here links back to the live diary, where you can build a free day plan, share it with friends and drop it straight into your calendar.</p>`;
	const introEs = noDashes(intro?.introEs) ||
		`<p>${town.nameEs} no frena en ${monthEs}. Esta guia recoge ${counts.total} eventos reales y verificados en todo el municipio este mes - conciertos, festivales, exposiciones y los mercadillos semanales - sacados de nuestra agenda en vivo, que se actualiza cada semana.</p><p>Desde la agenda puedes montar un plan del dia gratis, compartirlo con amigos y pasarlo directo a tu calendario.</p>`;

	// ---- assemble bodies ----
	const ctaEn = `<p><a href="${town.pageEn}"><strong>See the live What's On diary for ${town.nameEn} &rarr;</strong></a> - filter by date and category, build your own plan and export it to your calendar, free.</p>`;
	const ctaEs = `<p><a href="${town.pageEs}"><strong>Ver la agenda en vivo de ${town.nameEs} &rarr;</strong></a> - filtra por fecha y categoria, monta tu propio plan y pasalo a tu calendario, gratis.</p>`;

	const bodyEn = [
		introEn, ctaEn,
		headliners.length ? `<h2>The headline acts in ${monthEn}</h2>` + list(headliners, 'en') : '',
		diary.length ? `<h2>Day by day: culture, family and more</h2>` + list(diary, 'en') : '',
		ongoing.length ? `<h2>Running all month</h2>` + list(ongoing, 'en') : '',
		`<h2>Weekly street markets</h2><p>${town.marketsEn}</p>`,
		`<h2>Plan it in one tap</h2><p>Dates and times change - the <a href="${town.pageEn}">live diary</a> is refreshed every week from official sources, so check it before you set out. Tap "Add to plan" on anything that catches your eye, share the plan with your group and export it to your calendar.</p><p>Falling for ${town.nameEn}? See what homes cost in our <a href="${town.areaGuideEn}">${town.nameEn} area guide</a>, with live prices and notary-verified values.</p>`,
	].filter(Boolean).join('\n');

	const bodyEs = [
		introEs, ctaEs,
		headliners.length ? `<h2>Los conciertos de ${monthEs}</h2>` + list(headliners, 'es') : '',
		diary.length ? `<h2>Dia a dia: cultura, familia y mas</h2>` + list(diary, 'es') : '',
		ongoing.length ? `<h2>Durante todo el mes</h2>` + list(ongoing, 'es') : '',
		`<h2>Mercadillos semanales</h2><p>${town.marketsEs}</p>`,
		`<h2>Planifica en un toque</h2><p>Fechas y horarios cambian - la <a href="${town.pageEs}">agenda en vivo</a> se actualiza cada semana desde fuentes oficiales, asi que consultala antes de salir. Toca "Anadir al plan" en lo que te llame, comparte el plan con tu grupo y exportalo a tu calendario.</p><p>Te esta conquistando ${town.nameEs}? Mira precios reales en nuestra <a href="${town.areaGuideEs}">guia de ${town.nameEs}</a>, con valores verificados ante notario.</p>`,
	].filter(Boolean).join('\n');

	const titleEn = `What's On in ${town.nameEn}: ${monthEn} ${year} - Concerts, Festivals and Markets`;
	const titleEs = `Que hacer en ${town.nameEs}: ${monthEs} ${year} - conciertos, festivales y mercadillos`;
	const descEn = `${counts.total} verified events in ${town.nameEn} this ${monthEn}: ${topNames ? topNames + ', plus ' : ''}exhibitions, family events and the weekly street markets - with a free day planner.`.slice(0, 200);
	const descEs = `${counts.total} eventos verificados en ${town.nameEs} en ${monthEs}: conciertos, exposiciones, planes en familia y los mercadillos semanales - con planificador gratis.`.slice(0, 200);

	console.log(`events: ${counts.total} (headliners ${counts.headliners}, diary ${counts.diary}, ongoing ${counts.ongoing})`);
	console.log(`slug: ${slug}`);
	if (DRY) { console.log('--- DRY RUN ---\n' + bodyEn.slice(0, 800)); continue; }

	const en = await directus('/items/kb_pages', { method: 'POST', body: {
		status: 'published', language: 'en', path: `/blog/${slug}`,
		title: noDashes(titleEn), description: noDashes(descEn), body: bodyEn,
		seo_title: `What's On in ${town.nameEn} ${monthEn} ${year}`.slice(0, 60),
		seo_description: noDashes(descEn).slice(0, 160),
	} });
	console.log(`EN published: id=${en.data?.id} /blog/${slug}`);

	const es = await directus('/items/kb_pages', { method: 'POST', body: {
		status: 'published', language: 'es', path: `/es/blog/${slug}`,
		title: noDashes(titleEs), description: noDashes(descEs), body: bodyEs,
		seo_title: `Que hacer en ${town.nameEs} ${monthEs} ${year}`.slice(0, 60),
		seo_description: noDashes(descEs).slice(0, 160),
	} });
	console.log(`ES published: id=${es.data?.id} /es/blog/${slug}`);

	await setFeaturedImage(en.data?.id, town.image[0], town.image[1]);
	await setFeaturedImage(es.data?.id, town.image[0], town.image[1]);

	// IndexNow (best effort)
	try {
		const key = fs.readFileSync('/opt/info-hub/var/admin/indexnow-key.txt', 'utf8').trim();
		const urls = [`https://info.propertylist.es/blog/${slug}`, `https://info.propertylist.es/es/blog/${slug}`];
		const res = await fetch('https://www.bing.com/indexnow', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ host: 'info.propertylist.es', key, keyLocation: `https://info.propertylist.es/${key}.txt`, urlList: urls }),
		});
		console.log('IndexNow:', res.status);
	} catch (e) { console.log('IndexNow skipped:', e.message); }
}
console.log('\ndone.');
