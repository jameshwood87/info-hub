import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf, assertRole } from '../../../../lib/adminAuth';
import {
	assertAllowedPath,
	assertLanguageMatchesPath,
	getKbLifecycleSnapshot,
	popExpiredTrash,
	sanitiseKbWrite,
	snapshotVersion,
	validateKbWrite,
	writeAudit,
} from '../../../../lib/adminContent';
import { getKbMeta, setKbMeta } from '../../../../lib/adminMeta';
import {
	adminCreateKbPage,
	adminDeleteKbPage,
	adminGetKbPageById,
	adminGetKbPageByPathLang,
	adminListKbPagesByPrefix,
	mapDocsEnglishToSpanishPath,
	mapDocsSpanishToEnglishPath,
	type KbPageWrite,
} from '../../../../lib/directus';
import { canTranslateWithDeepL, deeplTranslate, deeplTranslateHtml } from '../../../../lib/deepl';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const mapError = (e: any) => {
	const status = typeof e?.status === 'number' ? e.status : 500;
	const raw = String(e?.message || 'server_error');
	if (raw === 'Directus admin token not configured') return { status: 500, error: 'directus_admin_token_missing' };
	if (raw.startsWith('Directus request failed: 401')) return { status: 502, error: 'directus_unauthorized' };
	if (raw.startsWith('Directus request failed: 403')) return { status: 502, error: 'directus_forbidden' };
	return { status, error: status === 500 ? 'server_error' : raw };
};

const mapNeighbourhoodEnglishToSpanishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/neighbourhood/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return path;
	if (parts.length === 4 && parts[1] === 'andalucia' && parts[2] === 'malaga') {
		const slug = parts[3] || '';
		if (slug) return `/es/barrios/${slug}/`;
	}
	return path;
};

const mapNeighbourhoodSpanishToEnglishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/es/barrios/')) return path;
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'es' || parts[1] !== 'barrios') return path;
	const slug = parts[2] || '';
	if (!slug) return path;
	return `/neighbourhood/andalucia/malaga/${slug}/`;
};

const mapAreaEnglishToSpanishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/andalucia/')) return path;
	return `/es${path.startsWith('/') ? path : `/${path}`}`;
};

const mapAreaSpanishToEnglishPath = (p: string) => {
	const path = String(p || '');
	if (!path.startsWith('/es/andalucia/')) return path;
	return path.replace(/^\/es\//, '/');
};

const makeSpanishTranslationPlaceholderBody = (enPath: string) =>
	`<h2>Traducción en curso</h2><p>Estamos preparando la versión en español de esta página.</p><p>Mientras tanto, puedes ver la versión en inglés: <a href="${enPath}">Abrir en inglés</a>.</p>`;

const legacyLawsProceduresPages = () => {
	const base = '/docs/laws-procedures/';
	const definitions = [
		{
			seg: 'listing-a-property-what-to-know',
			title: 'Listing a Property (What to know)',
			desc: 'What to know before listing a property in Andalusia.',
			children: [
				{ seg: 'estate-agents', title: 'Estate Agents' },
				{ seg: 'owners', title: 'Owners' },
			],
		},
		{
			seg: 'buying-a-property',
			title: 'Buying a Property',
			desc: 'Guides for buyers: checks, contracts, and timelines.',
			children: [
				{ seg: 'verifying-documents-and-debts', title: 'Verifying documents and debts' },
				{ seg: 'legal-requirements', title: 'Legal requirements' },
				{ seg: 'obtaining-a-nie', title: 'Obtaining a NIE' },
				{ seg: 'paying-taxes', title: 'Paying taxes' },
				{ seg: 'registering-the-property-in-the-land-registry', title: 'Registering the Property in the Land Registry' },
			],
		},
		{
			seg: 'selling-a-property',
			title: 'Selling a Property',
			desc: 'Guides for sellers: paperwork, process, and costs.',
			children: [
				{ seg: 'the-selling-process', title: 'The selling process' },
				{ seg: 'marketing-the-property', title: 'Marketing the property' },
				{ seg: 'signing-a-contract-and-reservation', title: 'Signing a contract & reservation' },
				{ seg: 'costs', title: 'Costs' },
				{ seg: 'taxes', title: 'Taxes' },
			],
		},
		{
			seg: 'renovating-a-property',
			title: 'Renovating a Property',
			desc: 'Renovations, rules, compliance, and practical steps.',
			children: [
				{ seg: 'planning-permission', title: 'Planning permission' },
				{ seg: 'obtaining-a-licencia-de-obra', title: 'Obtaining a licencia de obra (building permit).' },
				{ seg: 'cost-calculations', title: 'Cost Calculations' },
				{ seg: 'hiring-a-contractor', title: 'Hiring a contractor' },
				{ seg: 'taxes-for-renovating', title: 'Taxes for Renovating' },
			],
		},
		{
			seg: 'building-a-property',
			title: 'Building a Property',
			desc: 'New builds, permits, regulations, and project planning.',
			children: [
				{ seg: 'obtaining-permits-and-approvals', title: 'Obtaining permits and approvals' },
				{ seg: 'inspections-and-compliance', title: 'Inspections and compliance' },
				{ seg: 'planning-and-design', title: 'Planning and design' },
				{ seg: 'construction-and-completion', title: 'Construction and completion' },
				{ seg: 'construction-standards', title: 'Construction standards' },
				{ seg: 'completion-and-final-inspections', title: 'Completion and final inspections' },
			],
		},
		{
			seg: 'renting-a-property',
			title: 'Renting a Property',
			desc: 'Rentals, landlord obligations, tenant rights, and taxes.',
			children: [
				{ seg: 'long-term', title: 'Long Term' },
				{ seg: 'types-of-tenancies', title: 'Types of tenancies' },
				{ seg: 'tenancy-agreements', title: 'Tenancy agreements' },
				{ seg: 'evictions', title: 'Evictions' },
				{ seg: 'short-term-holiday', title: 'Short Term/Holiday' },
				{ seg: 'community-approval-law', title: 'Community Approval Law' },
				{ seg: 'landlords', title: 'Landlords' },
				{ seg: 'requirements-for-landlords', title: 'Requirements for Landlords' },
				{ seg: 'taxes-for-landlords', title: 'Taxes for Landlords' },
			],
		},
		{
			seg: 'traspaso-business-transfer',
			title: 'Traspaso (Business Transfer)',
			desc: 'Business transfers (traspaso): how it works and what to check.',
			children: [
				{ seg: 'understanding-the-traspaso-concept', title: 'Understanding the Traspaso concept' },
				{ seg: 'essentials-of-a-traspaso-agreement', title: 'Essentials of a Traspaso Agreement' },
				{ seg: 'tax-implications-of-a-traspaso', title: 'Tax Implications of a Traspaso' },
				{ seg: 'additional-considerations', title: 'Additional Considerations' },
				{ seg: 'contractual-obligations', title: 'Contractual obligations' },
			],
		},
		{
			seg: 'property-taxes-in-andalucia',
			title: 'Property Taxes in Andalucía',
			desc: 'Taxes and ongoing costs for owning property.',
			children: [
				{ seg: 'impuesto-sobre-bienes-inmuebles-ibi', title: 'Impuesto sobre Bienes Inmuebles (IBI)' },
				{ seg: 'impuesto-sobre-transmisiones-patrimoniales-itp', title: 'Impuesto sobre Transmisiones Patrimoniales (ITP)' },
				{ seg: 'impuesto-sobre-el-valor-anadido-iva', title: 'Impuesto sobre el Valor Añadido (IVA)' },
				{ seg: 'impuesto-sobre-construcciones-instalaciones-y-obras-icio', title: 'Impuesto sobre Construcciones, Instalaciones y Obras (ICIO)' },
			],
		},
		{
			seg: 'inheritance-laws-in-andalucia',
			title: 'Inheritance Laws in Andalucía',
			desc: 'Inheritance basics: legal steps and common pitfalls.',
			children: [
				{ seg: 'inheritance-tax-impuesto-sobre-sucesiones-y-donaciones', title: 'Inheritance Tax (Impuesto sobre Sucesiones y Donaciones)' },
				{ seg: 'forced-heirship-rules-legitima', title: 'Forced Heirship Rules (Legítima)' },
				{ seg: 'wills-and-testaments', title: 'Wills and Testaments' },
				{ seg: 'intestate-succession-intestacy', title: 'Intestate Succession (Intestacy)' },
			],
		},
		{
			seg: 'property-insurance-in-andalucia',
			title: 'Property Insurance in Andalucía',
			desc: 'Insurance types, coverage, and what to ask for.',
			children: [
				{ seg: 'types-of-property-insurance', title: 'Types of Property Insurance' },
				{ seg: 'factors-influencing-premiums', title: 'Factors Influencing Premiums' },
				{ seg: 'shopping-for-insurance', title: 'Shopping for Insurance' },
				{ seg: 'additional-considerations', title: 'Additional Considerations' },
			],
		},
	] as const;

	const pages: KbPageWrite[] = [];
	for (const def of definitions) {
		const path = `${base}${def.seg}/`;
		let body = '';
		if (def.seg === 'listing-a-property-what-to-know') {
			body = `
<h2>Before you start</h2>
<ul>
  <li>Gather the key facts: location, size, bedroom/bathroom count, and price.</li>
  <li>Prepare high-quality photos and a clear description of what makes the property stand out.</li>
  <li>Check any legal/administrative requirements relevant to your listing type and situation.</li>
</ul>

<h2>Estate Agents</h2>
<p>If you are listing on behalf of an owner, align on pricing strategy, marketing plan, and which documents you need before you publish.</p>
<ul>
  <li>Confirm the owner’s authorisation and agreed terms.</li>
  <li>Verify key property details and any constraints that affect marketing.</li>
  <li>Ensure your listing copy is accurate, consistent, and easy to scan.</li>
</ul>
<p><a href="${base}listing-a-property-what-to-know/estate-agents/">Read: Estate Agents</a></p>

<h2>Owners</h2>
<p>If you are listing your own property, aim for clarity and completeness. Buyers move faster when the information is trustworthy and easy to verify.</p>
<ul>
  <li>Be transparent about condition, fees, and any restrictions.</li>
  <li>Highlight practical details: parking, orientation, community rules, and nearby amenities.</li>
  <li>Keep photos current and representative of the property.</li>
</ul>
<p><a href="${base}listing-a-property-what-to-know/owners/">Read: Owners</a></p>
`;
		} else {
			const childrenList = def.children.map((c) => `<li><a href="${base}${def.seg}/${c.seg}/">${c.title}</a></li>`).join('');
			body = `
            <h2>${def.title}</h2>
            <p>${def.desc}</p>
            <ul>${childrenList}</ul>
        `;
		}

		pages.push({
			status: 'published',
			language: 'en',
			path,
			title: def.title,
			description: def.desc,
			body,
			seo_title: `${def.title} • Laws & Procedures`,
			seo_description: def.desc,
		});

		for (const child of def.children) {
			const childPath = `${base}${def.seg}/${child.seg}/`;
			let childBody = '';
			if (def.seg === 'listing-a-property-what-to-know' && child.seg === 'estate-agents') {
				childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Estate Agents</h2>
<p>If you are listing on behalf of an owner, align on pricing strategy, marketing plan, and which documents you need before you publish.</p>
<ul>
  <li>Confirm the owner’s authorisation and agreed terms.</li>
  <li>Verify key property details and any constraints that affect marketing.</li>
  <li>Ensure your listing copy is accurate, consistent, and easy to scan.</li>
</ul>
`;
			} else if (def.seg === 'listing-a-property-what-to-know' && child.seg === 'owners') {
				childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Owners</h2>
<p>If you are listing your own property, aim for clarity and completeness. Buyers move faster when the information is trustworthy and easy to verify.</p>
<ul>
  <li>Be transparent about condition, fees, and any restrictions.</li>
  <li>Highlight practical details: parking, orientation, community rules, and nearby amenities.</li>
  <li>Keep photos current and representative of the property.</li>
</ul>
`;
			}

			if (def.seg === 'inheritance-laws-in-andalucia') {
				if (child.seg === 'inheritance-tax-impuesto-sobre-sucesiones-y-donaciones') {
					childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Inheritance Tax (Impuesto sobre Sucesiones y Donaciones)</h2>
<p>Andalucía boasts some of the most favourable inheritance tax rates in Spain. Here’s a breakdown of the key points:</p>
<h3>High Allowances</h3>
<p>Inheritance between Group I beneficiaries (spouse, children, descendants) often benefits from a high tax-free allowance, reaching €1 million per heir in some cases. This significantly reduces the overall inheritance tax burden.</p>
<h3>Progressive Tax Rates</h3>
<p>The remaining inheritance amount exceeding the allowance is subject to progressive tax rates. These rates typically start lower than other regions in Spain.</p>
<h3>Seeking Professional Guidance</h3>
<p>Consulting a qualified inheritance lawyer and tax advisor familiar with Andalucian law is highly recommended. They can provide personalized advice based on your specific circumstances, including:</p>
<ul>
<li><strong>Tax Planning Strategies:</strong> They can help you minimize inheritance tax liabilities by exploring available exemptions and deductions.</li>
</ul>
`;
				} else if (child.seg === 'forced-heirship-rules-legitima') {
					childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Forced Heirship Rules (Legítima)</h2>
<p>Andalucian inheritance law follows a system of legal heirs, categorized into three groups:</p>
<ul>
<li><strong>Group I:</strong> Spouses, children, and descendants (grandchildren, great-grandchildren).</li>
<li><strong>Group II:</strong> Parents and ascendants (grandparents, great-grandparents).</li>
<li><strong>Group III:</strong> Siblings and their descendants (nieces, nephews, etc.).</li>
</ul>
<p>The inheritance is distributed according to the following hierarchy:</p>
<ul>
<li><strong>Spouses:</strong> The surviving spouse generally inherits a usufruct (usufructo) on the entire estate, granting them the right to use and enjoy the property but not to sell it. Ownership rights are then distributed among the remaining heirs.</li>
<li><strong>Children and Descendants:</strong> If there’s no surviving spouse, children inherit the property in equal shares.</li>
<li><strong>Parents and Ascendants:</strong> In the absence of a spouse and descendants, parents inherit the estate.</li>
</ul>
<p>Important Note: It’s crucial to remember that these are general guidelines. A will can be used to alter the distribution of assets, though certain portions (known as “legítima” or forced heirship) must still be reserved for legal heirs.</p>
`;
				} else if (child.seg === 'wills-and-testaments') {
					childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Wills and Testaments</h2>
<p>Making a Spanish will (testamento) is highly advisable for foreigners owning property in Andalucía. It simplifies the inheritance process and allows you to specify how you want your Spanish assets to be distributed, within the limits of the law.</p>
<p>If you are a non-resident, you can apply your national law to your inheritance by stating this clearly in your will (Brussels IV regulation). However, this does not exempt you from Spanish inheritance tax.</p>
`;
				} else if (child.seg === 'intestate-succession-intestacy') {
					childBody = `
<p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
<h2>Intestate Succession (Intestacy)</h2>
<p>If a person dies without a valid will, the rules of intestate succession apply. In Spain, the law dictates the order of heirs, prioritising descendants, then ascendants, then the spouse, and finally collateral relatives.</p>
<p>Navigating intestacy can be complex and time-consuming, involving declarations of heirs and additional bureaucracy. Having a will is the best way to avoid this.</p>
`;
				} else {
					childBody = `
            <p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
            <h2>${child.title}</h2>
            <p>Guide for ${child.title}.</p>
        `;
				}
			} else if (!childBody) {
				childBody = `
            <p><a href="${base}${def.seg}/">← Back to ${def.title}</a></p>
            <h2>${child.title}</h2>
            <p>Guide for ${child.title}.</p>
        `;
			}

			pages.push({
				status: 'published',
				language: 'en',
				path: childPath,
				title: child.title,
				description: `${child.title} - Guide.`,
				body: childBody,
				seo_title: `${child.title} • ${def.title}`,
				seo_description: `Guide for ${child.title}.`,
			});
		}
	}

	return pages;
};

const ensureLegacyLawsProceduresSeeded = async () => {
	const base = '/docs/laws-procedures/';
	const existing = new Set<string>();
	let offset = 0;
	while (true) {
		const batch = await adminListKbPagesByPrefix({ prefix: base, lang: 'en', status: 'any', limit: 500, offset });
		for (const it of batch) existing.add(String((it as any).path || ''));
		offset += batch.length;
		if (batch.length < 500) break;
		if (offset >= 20000) break;
	}

	const desired = legacyLawsProceduresPages();
	for (const page of desired) {
		if (existing.has(page.path)) continue;
		await adminCreateKbPage(sanitiseKbWrite(page)).catch(() => undefined);
	}
};

export const GET: APIRoute = async ({ request, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		const url = new URL(request.url);
		const prefixes = (url.searchParams.get('prefixes') || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const lang = (url.searchParams.get('lang') || '').trim() as any;
		const status = (url.searchParams.get('status') || 'any').trim() as any;
		const bucket = (url.searchParams.get('bucket') || 'active').trim();
		const requestedLimit = Number(url.searchParams.get('limit') || 200);
		const limit = Math.max(1, Math.min(20000, Number.isFinite(requestedLimit) ? requestedLimit : 200));

		if (!prefixes.length) return json(400, { ok: false, error: 'missing_prefixes' });

		if (prefixes.some((p) => String(p || '').startsWith('/docs/'))) {
			await ensureLegacyLawsProceduresSeeded().catch(() => undefined);
		}

		const popped = await popExpiredTrash().catch(() => ({ expired: [] as any[] }));
		if (popped.expired && popped.expired.length) {
			const results: Array<{ id: string; ok: boolean; error?: string }> = [];
			for (const it of popped.expired) {
				const id = String(it?.id || '');
				if (!id) continue;
				try {
					const existing = await adminGetKbPageById(id).catch(() => null);
					if (!existing) {
						results.push({ id, ok: true });
						continue;
					}
					await snapshotVersion(existing, 'system').catch(() => undefined);
					await adminDeleteKbPage(id);
					results.push({ id, ok: true });
				} catch (e: any) {
					results.push({ id, ok: false, error: String(e?.message || 'error') });
				}
			}
			await writeAudit({
				action: 'kb_pages.purge.auto',
				userId: 'system',
				ip: '',
				details: { results },
			}).catch(() => undefined);
		}

		const byPath = new Map<string, any>();
		for (const prefix of prefixes) {
			let offset = 0;
			let collectedForPrefix = 0;
			const pageSize = Math.min(500, limit);
			while (collectedForPrefix < limit) {
				const batch = await adminListKbPagesByPrefix({
					prefix,
					lang: lang === 'en' || lang === 'es' ? lang : undefined,
					status,
					limit: Math.min(pageSize, limit - collectedForPrefix),
					offset,
				});

				for (const item of batch) {
					if (!byPath.has(item.path)) byPath.set(item.path, item);
				}

				collectedForPrefix += batch.length;
				offset += batch.length;
				if (batch.length < pageSize) break;
			}
		}

		const lifecycle = await getKbLifecycleSnapshot().catch(() => ({ archived: {}, trashed: {} } as any));
		const archived = lifecycle && lifecycle.archived ? lifecycle.archived : {};
		const trashed = lifecycle && lifecycle.trashed ? lifecycle.trashed : {};

		const filteredItems = [...byPath.values()]
			.map((it) => {
				const id = String(it.id || '');
				const arch = archived[id] || null;
				const tr = trashed[id] || null;
				return {
					...it,
					archivedAt: arch?.at || null,
					trashedAt: tr?.at || null,
					trashUntil: tr?.until || null,
					prevStatus: (arch || tr)?.prevStatus || null,
				};
			})
			.filter((it) => {
				const id = String(it.id || '');
				const isArchived = Boolean(archived[id]);
				const isTrashed = Boolean(trashed[id]);
				if (bucket === 'archived') return isArchived && !isTrashed;
				if (bucket === 'trash') return isTrashed;
				if (bucket === 'all') return true;
				return !isArchived && !isTrashed;
			});

		await writeAudit({
			action: 'kb_pages.list',
			userId: session.userId,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { prefixes, lang: lang || null, status: status || null, bucket: bucket || null, limit },
		}).catch(() => undefined);

		return json(200, { ok: true, items: filteredItems });
	} catch (e: any) {
		const { status, error } = mapError(e);
		return json(status, { ok: false, error });
	}
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const session = assertAdmin(request);
	assertCsrf(request, session);
	assertRole(session, ['admin', 'editor']);


	let body: any = null;
	try {
		body = await request.json();
	} catch {
		return json(400, { ok: false, error: 'invalid_json' });
	}

	const scope = String(body?.scope || '');
	if (scope !== 'blog' && scope !== 'docs' && scope !== 'neighbourhood' && scope !== 'area')
		return json(400, { ok: false, error: 'invalid_scope' });

	const input = body?.page as KbPageWrite | undefined;
	if (!input) return json(400, { ok: false, error: 'missing_page' });

	try {
		validateKbWrite(input);
		const path = assertAllowedPath(scope, input.path);
		const sanitised = sanitiseKbWrite({ ...input, path });
		assertLanguageMatchesPath(scope, sanitised.language, sanitised.path);

		const existing = await adminGetKbPageByPathLang(sanitised.path, sanitised.language as any).catch(() => null);
		if (existing)
			return json(409, {
				ok: false,
				error: 'path_exists',
				existingId: existing.id,
				existingStatus: existing.status,
				existingLanguage: existing.language,
			});
		const created = await adminCreateKbPage(sanitised);

		let translation: null | { ok: boolean; id?: string; path?: string; language?: string; error?: string } = null;
		const autoTranslateEnabled = String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES') || '').trim() !== '0';
		const autoPublishTranslation = String(readEnv('INFO_HUB_AUTO_TRANSLATE_ES_PUBLISH') || '').trim() === '1';
		const isSupportedScope = scope === 'docs' || scope === 'neighbourhood' || scope === 'area';
		const sourceLang = created.language === 'es' ? 'es' : 'en';
		if (isSupportedScope && sourceLang === 'en') {
			const targetLang = 'es' as const;
			const enPath =
				scope === 'docs'
					? created.path.startsWith('/es/docs/')
						? mapDocsSpanishToEnglishPath(created.path)
						: created.path
					: scope === 'neighbourhood'
						? created.path.startsWith('/es/barrios/')
							? mapNeighbourhoodSpanishToEnglishPath(created.path)
							: created.path
						: created.path.startsWith('/es/andalucia/')
							? mapAreaSpanishToEnglishPath(created.path)
							: created.path;
			const targetPath =
				scope === 'docs'
					? enPath.startsWith('/docs/')
						? mapDocsEnglishToSpanishPath(enPath)
						: mapDocsEnglishToSpanishPath(created.path)
					: scope === 'neighbourhood'
						? mapNeighbourhoodEnglishToSpanishPath(enPath)
						: mapAreaEnglishToSpanishPath(enPath);

			if (targetPath && targetPath !== created.path) {
				try {
					const existingTarget = await adminGetKbPageByPathLang(targetPath, targetLang).catch(() => null);
					if (existingTarget) {
						translation = { ok: true, id: existingTarget.id, path: existingTarget.path, language: existingTarget.language };
					} else {
						const translated = await (async () => {
							if (!autoTranslateEnabled) return null;
							if (!canTranslateWithDeepL()) return null;
							const title = created.title ? await deeplTranslate(created.title, { html: false }) : '';
							const description = created.description ? await deeplTranslate(String(created.description || ''), { html: false }) : null;
							const seoTitle = created.seo_title ? await deeplTranslate(String(created.seo_title || ''), { html: false }) : null;
							const seoDesc = created.seo_description ? await deeplTranslate(String(created.seo_description || ''), { html: false }) : null;
							const body = created.body ? await deeplTranslateHtml(String(created.body || '')) : null;
							return { title, description, seoTitle, seoDesc, body };
						})().catch(() => null);

						const status = autoPublishTranslation ? (created.status as any) : ('draft' as any);
						const createdTranslation = await adminCreateKbPage(
							sanitiseKbWrite({
								status,
								language: targetLang as any,
								path: targetPath,
								title: translated?.title || created.title,
								description: translated?.description ?? null,
								body: translated?.body ?? (translated ? null : makeSpanishTranslationPlaceholderBody(enPath)),
								seo_title: translated?.seoTitle ?? null,
								seo_description: translated?.seoDesc ?? null,
							})
						);

						const meta = await getKbMeta(created.id).catch(() => null as any);
						if (meta && meta.docCategory) {
							await setKbMeta(createdTranslation.id, { docCategory: meta.docCategory }).catch(() => undefined);
						}

						translation = { ok: true, id: createdTranslation.id, path: createdTranslation.path, language: createdTranslation.language };
						await writeAudit({
							action: 'kb_pages.translation.create',
							userId: session.userId,
							kbPageId: createdTranslation.id,
							path: createdTranslation.path,
							ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
							details: { sourceId: created.id, sourcePath: created.path, sourceLanguage: created.language },
						}).catch(() => undefined);
					}
				} catch (e: any) {
					translation = { ok: false, error: String(e?.message || 'error') };
				}
			}
		}

		await writeAudit({
			action: 'kb_pages.create',
			userId: session.userId,
			kbPageId: created.id,
			path: created.path,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { scope, status: created.status, language: created.language },
		});
		return json(200, { ok: true, item: created, translation });
	} catch (e: any) {
		const status = typeof e?.status === 'number' ? e.status : 500;
		const message = status === 500 ? 'server_error' : String(e?.message || 'error');
		return json(status, { ok: false, error: message });
	}
};
