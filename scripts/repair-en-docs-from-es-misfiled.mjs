import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const loadDotEnvIfPresent = () => {
	const stripQuotes = (v) => {
		const s = String(v || '').trim();
		if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
		return s;
	};

	const parseEnvText = (text) => {
		const lines = String(text || '').split(/\r?\n/);
		for (const rawLine of lines) {
			const line = String(rawLine || '').trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			if (!key) continue;
			if (Object.prototype.hasOwnProperty.call(process.env, key) && String(process.env[key] || '').trim() !== '') continue;
			const valRaw = line.slice(eq + 1);
			process.env[key] = stripQuotes(valRaw);
		}
	};

	const findEnvUpwards = (startDir) => {
		let dir = path.resolve(startDir);
		for (let i = 0; i < 8; i++) {
			const fp = path.join(dir, '.env');
			if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
			const next = path.dirname(dir);
			if (next === dir) break;
			dir = next;
		}
		return null;
	};

	const candidates = [];
	try {
		const cwdFound = findEnvUpwards(process.cwd());
		if (cwdFound) candidates.push(cwdFound);
	} catch {}
	try {
		const scriptDir = path.dirname(fileURLToPath(import.meta.url));
		const scriptFound = findEnvUpwards(scriptDir);
		if (scriptFound) candidates.push(scriptFound);
	} catch {}

	for (const fp of candidates) {
		try {
			const txt = fs.readFileSync(fp, 'utf8');
			parseEnvText(txt);
			return;
		} catch {}
	}
};

loadDotEnvIfPresent();

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const DRAFT_ES = process.argv.includes('--draft-es');
const CANONICALIZE_ES = process.argv.includes('--canonicalize-es');
const QUARANTINE_ES_WRONG_LANG = process.argv.includes('--quarantine-es-wrong-lang');
const CREATE_MISSING_ES = process.argv.includes('--create-missing-es');
const FIX_ES_LINKS = process.argv.includes('--fix-es-links');
const FIX_ES_LEGAL = process.argv.includes('--fix-es-legal');
const PUBLISH_MISSING_ES = process.argv.includes('--publish-missing-es');
const PUBLISH_EXISTING_ES = process.argv.includes('--publish-existing-es');
const DEBUG_PATH = (() => {
	const i = process.argv.indexOf('--debug-path');
	if (i === -1) return null;
	return process.argv[i + 1] || null;
})();
const DEBUG_LANG = (() => {
	const i = process.argv.indexOf('--debug-lang');
	if (i === -1) return null;
	return process.argv[i + 1] || null;
})();
const LIMIT = 200;

const requireToken = () => {
	if (!DIRECTUS_TOKEN) {
		throw new Error('Directus token is required (set DIRECTUS_TOKEN or DIRECTUS_ADMIN_TOKEN).');
	}
};

const directusFetch = async (path, init = {}) => {
	const url = `${DIRECTUS_URL}${path}`;
	const headers = new Headers(init.headers || {});
	if (DIRECTUS_TOKEN) headers.set('Authorization', `Bearer ${DIRECTUS_TOKEN}`);
	if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
	const res = await fetch(url, { ...init, headers });
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Directus ${res.status} ${path}${text ? `\n${text.slice(0, 500)}` : ''}`);
	}
	return res;
};

const getItems = async (qs) => {
	const res = await directusFetch(`/items/kb_pages?${qs.toString()}`);
	const json = await res.json();
	return Array.isArray(json?.data) ? json.data : [];
};

const patchItem = async (id, payload) => {
	const res = await directusFetch(`/items/kb_pages/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		body: JSON.stringify(payload),
	});
	return res.json();
};

const createItem = async (payload) => {
	const res = await directusFetch(`/items/kb_pages`, {
		method: 'POST',
		body: JSON.stringify(payload),
	});
	return res.json();
};

const normalizePath = (p) => {
	const s = String(p || '').trim();
	if (!s) return '';
	const withSlash = s.startsWith('/') ? s : `/${s}`;
	return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
};

const mapDocsEnglishToSpanishPath = (p) => {
	const path = normalizePath(p);
	if (!path.startsWith('/docs/')) return path;
	const parts = path.split('/').filter(Boolean);
	const seg = parts[1] || '';
	const mapped =
		seg === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: seg === 'laws-procedures'
				? 'leyes-procedimientos'
				: seg === 'public-portal'
					? 'portal-publico'
					: seg === 'getting-started'
						? 'empezar'
						: seg;
	parts[0] = 'es';
	parts[1] = 'docs';
	parts[2] = mapped;
	return `/${parts.join('/')}/`;
};

const mapDocsSpanishToEnglishPath = (p) => {
	const path = normalizePath(p);
	if (!path.startsWith('/es/docs/')) return path;
	const withoutEs = path.replace(/^\/es\//, '/');
	const parts = withoutEs.split('/').filter(Boolean);
	const seg = parts[1] || '';
	const mapped =
		seg === 'propertylist-mls-manual-de-usuario'
			? 'propertylist-mls-user-manual'
			: seg === 'leyes-procedimientos'
				? 'laws-procedures'
				: seg === 'portal-publico'
					? 'public-portal'
					: seg === 'empezar'
						? 'getting-started'
						: seg;
	parts[1] = mapped;
	return `/${parts.join('/')}/`;
};

const canonicalizeEsDocsPath = (p) => {
	const path = normalizePath(p);
	if (!path.startsWith('/es/docs/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'es' || parts[1] !== 'docs') return path;
	const seg = parts[2] || '';
	const mapped =
		seg === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: seg === 'laws-procedures'
				? 'leyes-procedimientos'
				: seg === 'public-portal'
					? 'portal-publico'
					: seg === 'getting-started'
						? 'empezar'
						: seg;
	if (mapped === seg) return path;
	parts[2] = mapped;
	return `/${parts.join('/')}/`;
};

const stripTagsSimple = (html) => String(html || '').replace(/<[^>]+>/g, ' ');

const renderableText = (html) => {
	let out = String(html || '');
	out = out
		.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
		.replace(/<(meta|link)\b[^>]*>/gi, ' ')
		.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
		.replace(
			/<div\b[^>]*class=["'][^"']*(sidebar|widget|comments-area|comment|comments|wp-block-comments)[^"']*["'][\s\S]*?<\/div>/gi,
			' ',
		);
	return stripTagsSimple(out).replace(/\s+/g, ' ').trim();
};

const looksLikeEnglish = (html) => {
	const bodyText = stripTagsSimple(html).slice(0, 4000).toLowerCase();
	const words = bodyText.split(/[^a-záéíóúüñ]+/i).filter(Boolean);
	if (words.length < 20) return false;

	const enStops = new Set([
		'the',
		'and',
		'you',
		'your',
		'to',
		'of',
		'in',
		'for',
		'with',
		'this',
		'that',
		'how',
		'can',
		'will',
		'no',
		'need',
		'account',
		'download',
		'app',
		'simply',
	]);
	const esStops = new Set([
		'el',
		'la',
		'los',
		'las',
		'y',
		'de',
		'del',
		'en',
		'para',
		'con',
		'esta',
		'este',
		'como',
		'puede',
		'puedes',
		'su',
		'tu',
		'descargar',
		'aplicacion',
	]);

	let en = 0;
	let es = 0;
	for (const w of words) {
		if (enStops.has(w)) en++;
		if (esStops.has(w)) es++;
	}
	const hasSpanishDiacriticsInBody = /[áéíóúüñ]/i.test(bodyText);
	return en >= Math.max(8, es * 2 + 2) && !hasSpanishDiacriticsInBody;
};

const hasRenderableBody = (html) => renderableText(html).length >= 80;

const langValuesForFilter = (lang) => {
	const raw = String(lang || '').trim();
	if (!raw) return [];
	const lower = raw.toLowerCase();
	const upper = raw.toUpperCase();
	return Array.from(new Set([raw, lower, upper]));
};

const getByPathLang = async (path, lang) => {
	const qs = new URLSearchParams();
	qs.set('filter[path][_eq]', normalizePath(path));
	qs.set('filter[status][_eq]', 'published');
	qs.set('filter[language][_in]', langValuesForFilter(lang).join(','));
	qs.set('limit', '1');
	qs.set('fields', 'id,status,language,path,title,description,seo_title,seo_description,body');
	const items = await getItems(qs);
	return items[0] || null;
};

const listAllKbPages = async ({ lang, status, prefix }) => {
	const out = [];
	let offset = 0;
	while (true) {
		const qs = new URLSearchParams();
		if (status) qs.set('filter[status][_eq]', status);
		if (lang) qs.set('filter[language][_in]', langValuesForFilter(lang).join(','));
		if (prefix) qs.set('filter[path][_starts_with]', prefix);
		qs.set('sort', 'id');
		qs.set('limit', String(LIMIT));
		qs.set('offset', String(offset));
		qs.set('fields', 'id,status,language,path,title,description,seo_title,seo_description,body');
		const batch = await getItems(qs);
		if (!batch.length) break;
		out.push(...batch);
		if (batch.length < LIMIT) break;
		offset += LIMIT;
	}
	return out;
};

const getAllByPathLangAnyStatus = async (path, lang) => {
	const qs = new URLSearchParams();
	qs.set('filter[path][_eq]', normalizePath(path));
	qs.set('filter[language][_in]', langValuesForFilter(lang).join(','));
	qs.set('sort', '-id');
	qs.set('limit', '25');
	qs.set('fields', 'id,status,language,path,title,description,seo_title,seo_description,body');
	const items = await getItems(qs);
	return items;
};

const scorePageForKeeping = (p) => {
	const statusScore = String(p?.status || '') === 'published' ? 1000 : 0;
	const bodyScore = hasRenderableBody(p?.body) ? Math.min(500, renderableText(p?.body).length / 10) : 0;
	const titleScore = String(p?.title || '').trim() ? 20 : 0;
	return statusScore + bodyScore + titleScore;
};

const pickBestPage = (pages) => {
	let best = null;
	let bestScore = -1;
	for (const p of pages) {
		const s = scorePageForKeeping(p);
		if (s > bestScore) {
			bestScore = s;
			best = p;
		}
	}
	return best;
};

const slugTitleEs = (s) =>
	String(s || '')
		.replace(/[_-]+/g, ' ')
		.split(' ')
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(' ');

const missingEsOverrides = {
	'/es/docs/propertylist-mls-manual-de-usuario/credits/referrals/': {
		title: 'Referidos',
		description: 'Cómo funcionan los referidos y dónde encontrarlos.',
	},
	'/es/docs/leyes-procedimientos/buying-a-property/contractual-obligations/': {
		title: 'Obligaciones contractuales',
		description: 'Principales obligaciones durante la compraventa de una propiedad.',
	},
	'/es/docs/leyes-procedimientos/buying-a-property/obtaining-a-nie/': {
		title: 'Obtener el NIE',
		description: 'Qué es el NIE, cuándo se necesita y cómo solicitarlo.',
	},
	'/es/docs/leyes-procedimientos/buying-a-property/paying-taxes/': {
		title: 'Pago de impuestos',
		description: 'Impuestos habituales en una compraventa y cuándo se pagan.',
	},
	'/es/docs/leyes-procedimientos/buying-a-property/registering-the-property-in-the-land-registry/': {
		title: 'Inscribir la propiedad en el Registro de la Propiedad',
		description: 'Cómo se formaliza e inscribe la compraventa tras la firma.',
	},
	'/es/docs/leyes-procedimientos/building-a-property/completion-and-final-inspections/': {
		title: 'Finalización e inspecciones finales',
		description: 'Revisión final, comprobaciones y cierre de obra antes de la entrega.',
	},
	'/es/docs/leyes-procedimientos/building-a-property/inspections-and-compliance/': {
		title: 'Inspecciones y cumplimiento',
		description: 'Controles y normativa aplicable durante la construcción.',
	},
	'/es/docs/leyes-procedimientos/building-a-property/obtaining-a-licencia-de-obra/': {
		title: 'Obtener una licencia de obra',
		description: 'Trámites básicos para solicitar y obtener licencia de obra.',
	},
	'/es/docs/leyes-procedimientos/renting-a-property/evictions/': {
		title: 'Desahucios',
		description: 'Proceso general de desahucio y puntos clave a considerar.',
	},
	'/es/docs/leyes-procedimientos/renting-a-property/requirements-for-landlords/': {
		title: 'Requisitos para propietarios',
		description: 'Obligaciones y requisitos habituales del arrendador.',
	},
	'/es/docs/leyes-procedimientos/renting-a-property/tenancy-agreements/': {
		title: 'Contratos de arrendamiento',
		description: 'Qué debe incluir un contrato y cómo estructurarlo.',
	},
	'/es/docs/leyes-procedimientos/renting-a-property/types-of-tenancies/': {
		title: 'Tipos de arrendamientos',
		description: 'Diferencias entre alquiler de larga duración, temporada y otros.',
	},
	'/es/docs/leyes-procedimientos/selling-a-property/community-approval-law/': {
		title: 'Ley de aprobación comunitaria',
		description: 'Cuándo se requiere aprobación de la comunidad y cómo gestionarla.',
	},
	'/es/docs/leyes-procedimientos/selling-a-property/marketing-the-property/': {
		title: 'Promocionar la propiedad',
		description: 'Preparación, estrategia y canales para la venta.',
	},
};

const stubEsBody = (title, description, enPath) => {
	const safeTitle = String(title || '').trim() || 'Guía';
	const safeDesc = String(description || '').trim();
	const enHref = enPath ? normalizePath(enPath) : '';
	return `
<h2>${safeTitle}</h2>
${safeDesc ? `<p>${safeDesc}</p>` : `<p>Estamos preparando esta guía en español.</p>`}
${enHref ? `<p>Mientras tanto, puedes consultar la versión en inglés: <a href="${enHref}">${enHref}</a></p>` : ''}
`;
};

const stubEsLegalBody = (title, enPath) => {
	const safeTitle = String(title || '').trim() || 'Aviso legal';
	const enHref = enPath ? normalizePath(enPath) : '';
	return `
<h2>${safeTitle}</h2>
<p>Esta página está pendiente de traducción y revisión legal.</p>
${enHref ? `<p>La versión oficial y vinculante está disponible en inglés: <a href="${enHref}">${enHref}</a></p>` : ''}
<p>Si necesitas una versión en español revisada legalmente, contacta con MLS Support.</p>
`;
};

const rewriteEsBodyLinks = (html, { publishedEsByPath }) => {
	const src = String(html || '');
	if (!src) return src;
	return src
		.replace(/href=(['"])(https?:\/\/info\.propertylist\.es\.?)?(\/docs\/[^'"]*?)\1/gi, (m, q, _origin, href) => {
			const enPath = normalizePath(href);
			const esPath = mapDocsEnglishToSpanishPath(enPath);
			const esCanon = canonicalizeEsDocsPath(esPath);
			if (!publishedEsByPath.has(esCanon)) return m;
			return `href=${q}${esCanon}${q}`;
		})
		.replace(/href=(https?:\/\/info\.propertylist\.es\.?)?(\/docs\/[^\s>]+)/gi, (m, _origin, href) => {
			const enPath = normalizePath(href);
			const esPath = mapDocsEnglishToSpanishPath(enPath);
			const esCanon = canonicalizeEsDocsPath(esPath);
			if (!publishedEsByPath.has(esCanon)) return m;
			return `href=${esCanon}`;
		});
};

const fixEsLegalStubs = async () => {
	const targets = [
		{
			esPath: '/es/docs/propertylist-mls-manual-de-usuario/privacy-policy/',
			enPath: '/docs/propertylist-mls-user-manual/privacy-policy/',
			title: 'Política de privacidad (MLS)',
		},
		{
			esPath: '/es/docs/propertylist-mls-manual-de-usuario/terms-conditions/',
			enPath: '/docs/propertylist-mls-user-manual/terms-conditions/',
			title: 'Términos y condiciones (MLS)',
		},
	];

	let patched = 0;
	for (const t of targets) {
		const esPath = normalizePath(t.esPath);
		const existingAny = await getAllByPathLangAnyStatus(esPath, 'es');
		if (!existingAny.length) continue;
		const best = pickBestPage(existingAny);
		const bestId = String(best?.id || '');
		if (!bestId) continue;
		const nextBody = stubEsLegalBody(t.title, t.enPath);
		if (!APPLY) {
			process.stdout.write(`DRYRUN\tPATCH_ES_LEGAL\t${esPath}\tid=${bestId}\n`);
		} else {
			await patchItem(bestId, { status: 'published', title: t.title, body: nextBody });
			patched++;
			process.stdout.write(`APPLY\tPATCH_ES_LEGAL\t${esPath}\tid=${bestId}\n`);
		}
	}
	return { patched };
};

const canonicalizeEsPaths = async () => {
	const esAll = await listAllKbPages({ lang: 'es', prefix: '/es/docs/' });
	let moved = 0;
	let merged = 0;
	let drafted = 0;

	for (const es of esAll) {
		const currentPath = normalizePath(es.path);
		const canonicalPath = canonicalizeEsDocsPath(currentPath);
		if (canonicalPath === currentPath) continue;

		const collisions = await getAllByPathLangAnyStatus(canonicalPath, 'es');
		if (!collisions.length) {
			if (!APPLY) {
				process.stdout.write(`DRYRUN\tMOVE_ES_PATH\t${currentPath}\t=>\t${canonicalPath}\n`);
			} else {
				await patchItem(es.id, { path: canonicalPath });
				moved++;
				process.stdout.write(`APPLY\tMOVE_ES_PATH\t${currentPath}\t=>\t${canonicalPath}\n`);
			}
			continue;
		}

		const best = pickBestPage([es, ...collisions]);
		const bestId = String(best?.id || '');
		const esId = String(es?.id || '');

		if (bestId && bestId !== esId) {
			const bestRenderable = hasRenderableBody(best?.body);
			const esRenderable = hasRenderableBody(es?.body);
			const patch = {};
			if (!bestRenderable && esRenderable) patch.body = es.body || null;
			if (!String(best?.description || '').trim() && String(es?.description || '').trim()) patch.description = es.description || null;
			if (!String(best?.seo_description || '').trim() && String(es?.seo_description || '').trim()) patch.seo_description = es.seo_description || null;
			if (!String(best?.seo_title || '').trim() && String(es?.seo_title || '').trim()) patch.seo_title = es.seo_title || null;
			if (String(es?.status || '') === 'published' && String(best?.status || '') !== 'published') patch.status = 'published';
			if (Object.keys(patch).length) {
				if (!APPLY) {
					process.stdout.write(`DRYRUN\tMERGE_ES_COLLISION\t${esId}\t=>\t${bestId}\t${canonicalPath}\n`);
				} else {
					await patchItem(bestId, patch);
					merged++;
					process.stdout.write(`APPLY\tMERGE_ES_COLLISION\t${esId}\t=>\t${bestId}\t${canonicalPath}\n`);
				}
			}
		}

		if (String(es?.status || '') === 'published') {
			if (!APPLY) {
				process.stdout.write(`DRYRUN\tDRAFT_ES_COLLISION\t${currentPath}\tid=${esId}\n`);
			} else {
				await patchItem(esId, { status: 'draft' });
				drafted++;
				process.stdout.write(`APPLY\tDRAFT_ES_COLLISION\t${currentPath}\tid=${esId}\n`);
			}
		}
	}

	return { moved, merged, drafted };
};

const createMissingEsFromEn = async () => {
	const enDocs = (await listAllKbPages({ status: 'published', prefix: '/docs/' })).filter((p) => {
		const pPath = normalizePath(p?.path);
		if (!pPath.startsWith('/docs/')) return false;
		if (pPath.startsWith('/docs/_misfiled-es/')) return false;
		const lang = String(p?.language || '').trim().toLowerCase();
		return lang !== 'es';
	});
	const existingEsPathsAnyLang = await listAllKbPages({ prefix: '/es/docs/' });
	const esByPathAny = new Set(existingEsPathsAnyLang.map((p) => normalizePath(p.path)).filter(Boolean));

	let created = 0;
	for (const en of enDocs) {
		const enPath = normalizePath(en.path);
		const esPath = canonicalizeEsDocsPath(mapDocsEnglishToSpanishPath(enPath));
		if (!esPath.startsWith('/es/docs/')) continue;
		if (esByPathAny.has(esPath)) continue;

		const override = missingEsOverrides[esPath] || null;
		const title =
			String(override?.title || '').trim() ||
			String(en.title || '').trim() ||
			slugTitleEs(esPath.split('/').filter(Boolean).slice(-1)[0] || '');
		const description = override?.description ?? (en.description || null);
		const body = stubEsBody(title, description, enPath);
		const payload = {
			status: PUBLISH_MISSING_ES ? 'published' : 'draft',
			language: 'es',
			path: esPath,
			title,
			description,
			seo_title: null,
			seo_description: null,
			body,
		};

		if (!APPLY) {
			process.stdout.write(`DRYRUN\tCREATE_ES\t${esPath}\t<=\t${enPath}\n`);
		} else {
			try {
				await createItem(payload);
				created++;
				process.stdout.write(`APPLY\tCREATE_ES\t${esPath}\t<=\t${enPath}\n`);
			} catch (e) {
				const msg = String(e?.message || '');
				if (msg.includes('RECORD_NOT_UNIQUE') || msg.includes('has to be unique')) {
					process.stdout.write(`SKIP\tCREATE_ES_NOT_UNIQUE\t${esPath}\t<=\t${enPath}\n`);
					continue;
				}
				throw e;
			}
		}
	}
	return { created };
};

const publishExistingEsFromEn = async () => {
	const enDocs = (await listAllKbPages({ status: 'published', prefix: '/docs/' })).filter((p) => {
		const pPath = normalizePath(p?.path);
		if (!pPath.startsWith('/docs/')) return false;
		if (pPath.startsWith('/docs/_misfiled-es/')) return false;
		const lang = String(p?.language || '').trim().toLowerCase();
		return lang !== 'es';
	});
	let published = 0;
	for (const en of enDocs) {
		const enPath = normalizePath(en.path);
		const esPath = canonicalizeEsDocsPath(mapDocsEnglishToSpanishPath(enPath));
		if (!esPath.startsWith('/es/docs/')) continue;
		const existingPublished = await getByPathLang(esPath, 'es');
		if (existingPublished) continue;
		const existingAny = await getAllByPathLangAnyStatus(esPath, 'es');
		if (!existingAny.length) continue;
		const best = pickBestPage(existingAny);
		if (!best) continue;
		const bestId = String(best.id || '');
		if (!bestId) continue;
		if (String(best.status || '') === 'published') continue;
		if (!APPLY) {
			process.stdout.write(`DRYRUN\tPUBLISH_EXISTING_ES\t${esPath}\tid=${bestId}\t<=\t${enPath}\n`);
		} else {
			await patchItem(bestId, { status: 'published' });
			published++;
			process.stdout.write(`APPLY\tPUBLISH_EXISTING_ES\t${esPath}\tid=${bestId}\t<=\t${enPath}\n`);
		}
	}
	return { published };
};

const quarantineEsDocsWrongLanguage = async () => {
	const allEsDocsAnyStatusAnyLang = await listAllKbPages({ prefix: '/es/docs/' });
	let quarantined = 0;
	for (const p of allEsDocsAnyStatusAnyLang) {
		const lang = String(p?.language || '').trim().toLowerCase();
		if (lang === 'es') continue;
		const currentPath = normalizePath(p.path);
		if (!currentPath.startsWith('/es/docs/')) continue;
		const quarantinePath = normalizePath(`/docs/_misfiled-es/${lang || 'unknown'}/${p.id}/`);
		if (!APPLY) {
			process.stdout.write(`DRYRUN\tQUARANTINE_ES_WRONG_LANG\t${currentPath}\tlang=${lang || 'unknown'}\tid=${p.id}\t=>\t${quarantinePath}\n`);
		} else {
			await patchItem(p.id, { status: 'draft', path: quarantinePath });
			quarantined++;
			process.stdout.write(`APPLY\tQUARANTINE_ES_WRONG_LANG\t${currentPath}\tlang=${lang || 'unknown'}\tid=${p.id}\t=>\t${quarantinePath}\n`);
		}
	}
	return { quarantined };
};

const fixEsInBodyLinks = async () => {
	const esPublished = await listAllKbPages({ lang: 'es', status: 'published', prefix: '/es/docs/' });
	const publishedEsByPath = new Set(esPublished.map((p) => normalizePath(p.path)).filter(Boolean));

	let patched = 0;
	for (const es of esPublished) {
		const currentBody = es.body || '';
		if (!currentBody || !/href=(['"])?(https?:\/\/info\.propertylist\.es\.?)?\/docs\//i.test(currentBody)) continue;
		const nextBody = rewriteEsBodyLinks(currentBody, { publishedEsByPath });
		if (nextBody === currentBody) continue;
		if (!APPLY) {
			process.stdout.write(`DRYRUN\tPATCH_ES_LINKS\t${normalizePath(es.path)}\n`);
		} else {
			await patchItem(es.id, { body: nextBody });
			patched++;
			process.stdout.write(`APPLY\tPATCH_ES_LINKS\t${normalizePath(es.path)}\n`);
		}
	}
	return { patched };
};

const mainRepairEnFromEsMisfiled = async () => {
	requireToken();
	const esDocs = await listAllKbPages({ lang: 'es', status: 'published', prefix: '/es/docs/' });

	let considered = 0;
	let updatedEn = 0;
	let createdEn = 0;
	let draftedEs = 0;

	for (const es of esDocs) {
		const esPath = normalizePath(es.path);
		const enPath = mapDocsSpanishToEnglishPath(esPath);
		if (!enPath.startsWith('/docs/')) continue;

		const esBody = es.body || '';
		if (!looksLikeEnglish(esBody)) continue;
		if (!hasRenderableBody(esBody)) continue;

		considered++;

		const en = await getByPathLang(enPath, 'en');
		const enNeedsBody = !en?.body || !hasRenderableBody(en.body);

		if (!en) {
			if (!APPLY) {
				process.stdout.write(`DRYRUN\tCREATE_EN\t${enPath}\t<=\t${esPath}\n`);
			} else {
				await createItem({
					status: 'published',
					language: 'en',
					path: enPath,
					title: es.title,
					description: es.description || null,
					seo_title: es.seo_title || null,
					seo_description: es.seo_description || null,
					body: es.body || null,
				});
				createdEn++;
				process.stdout.write(`APPLY\tCREATE_EN\t${enPath}\t<=\t${esPath}\n`);
			}
		} else if (enNeedsBody) {
			if (!APPLY) {
				process.stdout.write(`DRYRUN\tPATCH_EN\t${enPath}\t<=\t${esPath}\n`);
			} else {
				await patchItem(en.id, {
					body: es.body || null,
					description: en.description || es.description || null,
					seo_description: en.seo_description || es.seo_description || null,
				});
				updatedEn++;
				process.stdout.write(`APPLY\tPATCH_EN\t${enPath}\t<=\t${esPath}\n`);
			}
		}

		if (DRAFT_ES) {
			if (!APPLY) {
				process.stdout.write(`DRYRUN\tDRAFT_ES\t${esPath}\n`);
			} else {
				await patchItem(es.id, { status: 'draft' });
				draftedEs++;
				process.stdout.write(`APPLY\tDRAFT_ES\t${esPath}\n`);
			}
		}
	}

	process.stdout.write(
		`done\tconsidered=${considered}\tcreatedEn=${createdEn}\tupdatedEn=${updatedEn}\tdraftedEs=${draftedEs}\n`,
	);
};

const main = async () => {
	requireToken();

	if (DEBUG_PATH) {
		const qs = new URLSearchParams();
		qs.set('filter[path][_eq]', normalizePath(DEBUG_PATH));
		if (DEBUG_LANG) qs.set('filter[language][_in]', langValuesForFilter(DEBUG_LANG).join(','));
		qs.set('sort', '-id');
		qs.set('limit', '50');
		qs.set('fields', 'id,status,language,path,title,description,seo_title,seo_description');
		const items = await getItems(qs);
		process.stdout.write(`${JSON.stringify({ ok: true, count: items.length, items }, null, 2)}\n`);
		return;
	}

	if (FIX_ES_LEGAL) {
		const res = await fixEsLegalStubs();
		process.stdout.write(`done\tfix_es_legal\tpatched=${res.patched}\n`);
		return;
	}

	if (QUARANTINE_ES_WRONG_LANG) {
		const res = await quarantineEsDocsWrongLanguage();
		process.stdout.write(`done\tquarantine_es_wrong_lang\tquarantined=${res.quarantined}\n`);
		return;
	}

	if (CANONICALIZE_ES) {
		const res = await canonicalizeEsPaths();
		process.stdout.write(`done\tcanonicalize_es\tmoved=${res.moved}\tmerged=${res.merged}\tdrafted=${res.drafted}\n`);
		return;
	}

	if (CREATE_MISSING_ES) {
		const res = await createMissingEsFromEn();
		process.stdout.write(`done\tcreate_missing_es\tcreated=${res.created}\n`);
		return;
	}

	if (PUBLISH_EXISTING_ES) {
		const res = await publishExistingEsFromEn();
		process.stdout.write(`done\tpublish_existing_es\tpublished=${res.published}\n`);
		return;
	}

	if (FIX_ES_LINKS) {
		const res = await fixEsInBodyLinks();
		process.stdout.write(`done\tfix_es_links\tpatched=${res.patched}\n`);
		return;
	}

	await mainRepairEnFromEsMisfiled();
};

await main();
