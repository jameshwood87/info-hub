import type { APIRoute } from 'astro';
import { assertAdmin } from '../../../lib/adminAuth';
import { getKbLifecycleSnapshot } from '../../../lib/adminContent';
import { adminListKbPagesByPrefix, mapDocsEnglishToSpanishPath, mapDocsSpanishToEnglishPath } from '../../../lib/directus';
import { getKbTreeOrderSnapshot, sortPathsWithOrder } from '../../../lib/kbTreeOrder';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const normalisePath = (p: string) => {
	const s = String(p || '').trim();
	if (!s) return '';
	return s.startsWith('/') ? (s.endsWith('/') ? s : `${s}/`) : `/${s.endsWith('/') ? s : `${s}/`}`;
};

const titleFromSeg = (seg: string) => {
	const s = String(seg || '')
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!s) return '';
	return s
		.split(' ')
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
		.join(' ');
};

const manualOrderWeight = (node: { seg: string; title: string; path: string }): number => {
	const mlsManualPath = '/docs/propertylist-mls-user-manual/';
	const s = `${node.seg} ${node.title}`.toLowerCase();
	if (node.path === mlsManualPath) return 0;
	if (/\bgetting\b|\bstart\b|\bsetup\b|\bonboarding\b/.test(s)) return 10;
	if (/\bdashboard\b|\boverview\b|\bhome\b/.test(s)) return 20;
	if (/\bsearch\b|\bsearching\b|\bproperties\b/.test(s)) return 30;
	if (/\blistings?\b|\bproperty alerts?\b|\balerts?\b/.test(s)) return 40;
	if (/\bleads?\b|\benquir(y|ies)\b|\bpipeline\b|\bsales\b/.test(s)) return 50;
	if (/\bcontacts?\b|\bclients?\b/.test(s)) return 60;
	if (/\bcalendar\b|\bappointments?\b|\bviewings?\b|\btasks?\b/.test(s)) return 70;
	if (/\breports?\b|\bstatistics\b|\banalytics\b/.test(s)) return 80;
	if (/\brequests?\b/.test(s)) return 90;
	if (/\bsecurity\b|\bpermissions?\b|\busers?\b|\bverified\b|\bagency\b|\bcompany\b|\bstaff\b|\baccount\b/.test(s)) return 100;
	if (/\bai\b|\bautomation\b|\bintegrations?\b/.test(s)) return 110;
	if (/\btechnical\b|\bapi\b/.test(s)) return 120;
	if (/\bvideo\b|\btutorials?\b/.test(s)) return 130;
	if (/\badditional\b|\bresources?\b/.test(s)) return 140;
	return 500;
};

const bestRootPrefixForPath = (p: string, prefixes: string[]) => {
	const path = normalisePath(p);
	let best = '';
	for (const pref of prefixes) {
		if (path.startsWith(pref) && pref.length > best.length) best = pref;
	}
	return best;
};

const derivedParentForPath = (p: string, rootPrefix: string) => {
	const path = normalisePath(p);
	if (!path || !rootPrefix || !path.startsWith(rootPrefix)) return '';
	if (path === rootPrefix) return '';
	const rest = path.slice(rootPrefix.length);
	const parts = rest.split('/').filter(Boolean);
	if (!parts.length) return '';
	if (parts.length === 1) return rootPrefix;
	return `${rootPrefix}${parts.slice(0, -1).join('/')}/`;
};

export const GET: APIRoute = async ({ request, clientAddress }) => {
	try {
		assertAdmin(request);

		const url = new URL(request.url);
		const prefixes = (url.searchParams.get('prefixes') || '')
			.split(',')
			.map((s) => normalisePath(s))
			.filter(Boolean);
		const parentRaw = url.searchParams.get('parent') || '';
		const parent = parentRaw ? normalisePath(parentRaw) : '';
		const lang = (url.searchParams.get('lang') || '').trim() as any;
		const status = (url.searchParams.get('status') || 'any').trim() as any;
		const bucket = (url.searchParams.get('bucket') || 'active').trim();
		const requestedCap = Number(url.searchParams.get('cap') || 5000);
		const cap = Math.max(1, Math.min(20000, Number.isFinite(requestedCap) ? requestedCap : 5000));

		if (!prefixes.length) return json(400, { ok: false, error: 'missing_prefixes' });

		const effectivePrefixes = prefixes.slice();
		if (parent && !effectivePrefixes.some((p) => parent.startsWith(p))) return json(400, { ok: false, error: 'parent_outside_prefixes' });

		const order = await getKbTreeOrderSnapshot();
		const lifecycle = await getKbLifecycleSnapshot().catch(() => ({ archived: {}, trashed: {} } as any));
		const archived = lifecycle && lifecycle.archived ? lifecycle.archived : {};
		const trashed = lifecycle && lifecycle.trashed ? lifecycle.trashed : {};
		const items: Array<{ id: string; path: string; title: string; status: string; language: string }> = [];

		for (const prefix of effectivePrefixes) {
			let offset = 0;
			while (items.length < cap) {
				const batch = await adminListKbPagesByPrefix({
					prefix,
					lang: lang === 'en' || lang === 'es' ? lang : undefined,
					status,
					limit: Math.min(500, cap - items.length),
					offset,
				});
				for (const it of batch) {
					const id = String((it as any).id || '');
					if (bucket === 'active' && (archived[id] || trashed[id])) continue;
					if (bucket === 'archived' && !archived[id]) continue;
					if (bucket === 'trash' && !trashed[id]) continue;
					items.push({
						id,
						path: normalisePath(String((it as any).path || '')),
						title: String((it as any).title || ''),
						status: String((it as any).status || ''),
						language: String((it as any).language || ''),
					});
				}
				offset += batch.length;
				if (batch.length < 500) break;
			}
		}

		const byPath = new Map<string, (typeof items)[number]>();
		for (const it of items) {
			if (it.path && !byPath.has(it.path)) byPath.set(it.path, it);
		}

		const nodesByPath = new Map<
			string,
			{
				path: string;
				seg: string;
				title: string;
				hasPage: boolean;
				pageId: string | null;
				hasChildren: boolean;
				rootPrefix: string;
			}
		>();

		const ensureNode = (rootPrefix: string, nodePath: string, seg: string) => {
			const p = normalisePath(nodePath);
			if (!p) return null;
			const existing = nodesByPath.get(p) || null;
			if (existing) return existing;
			const created = {
				path: p,
				seg,
				title: titleFromSeg(seg) || seg,
				hasPage: false,
				pageId: null,
				hasChildren: false,
				rootPrefix,
			};
			nodesByPath.set(p, created);
			return created;
		};

		for (const prefix of effectivePrefixes) {
			const p = normalisePath(prefix);
			ensureNode(p, p, p.split('/').filter(Boolean).slice(-1)[0] || '');
		}

		const seedChildFolders = (rootPrefix: string, folders: string[]) => {
			const root = normalisePath(rootPrefix);
			if (!root) return;
			for (const f of folders) {
				const p = normalisePath(f);
				if (!p.startsWith(root)) continue;
				const seg = p.split('/').filter(Boolean).slice(-1)[0] || '';
				ensureNode(root, p, seg);
			}
		};

		if (effectivePrefixes.includes('/docs/')) {
			seedChildFolders('/docs/', [
				'/docs/propertylist-mls-user-manual/',
				'/docs/public-portal/',
				'/docs/developers/',
				'/docs/property-services/',
				'/docs/laws-procedures/',
			]);
		}
		if (effectivePrefixes.includes('/es/docs/')) {
			seedChildFolders('/es/docs/', [
				'/es/docs/propertylist-mls-manual-de-usuario/',
				'/es/docs/portal-publico/',
				'/es/docs/developers/',
				'/es/docs/property-services/',
				'/es/docs/leyes-procedimientos/',
				'/es/docs/legal/',
			]);
		}

		for (const it of byPath.values()) {
			const p = it.path;
			const rootPrefix = bestRootPrefixForPath(p, effectivePrefixes);
			if (!rootPrefix) continue;
			if (!p.startsWith(rootPrefix)) continue;

			const rest = p.slice(rootPrefix.length);
			const parts = rest.split('/').filter(Boolean);
			let acc = rootPrefix;
			let parentSeg = '';
			for (const seg of parts) {
				parentSeg = seg;
				acc = `${acc}${seg}/`;
				ensureNode(rootPrefix, acc, seg);
			}

			const self = ensureNode(rootPrefix, p, parentSeg);
			if (self) {
				self.hasPage = true;
				self.pageId = it.id || null;
				self.title = it.title || self.title;
			}
		}

		const parentOf = (childPath: string) => {
			const p = normalisePath(childPath);
			const rootPrefix = nodesByPath.get(p)?.rootPrefix || bestRootPrefixForPath(p, effectivePrefixes);
			if (rootPrefix === '/es/docs/') {
				const canon = normalisePath(mapDocsSpanishToEnglishPath(p));
				const explicitCanon = order.parentOverride[canon] ? normalisePath(order.parentOverride[canon]!) : '';
				const canonParent = explicitCanon || derivedParentForPath(canon, '/docs/');
				const esParent = canonParent ? normalisePath(mapDocsEnglishToSpanishPath(canonParent)) : '';
				return esParent && esParent.startsWith('/es/docs/') ? esParent : '';
			}
			const explicit = order.parentOverride[p] ? normalisePath(order.parentOverride[p]!) : '';
			if (explicit) return explicit;
			return rootPrefix ? derivedParentForPath(p, rootPrefix) : '';
		};

		const kidsByParent = new Map<string, string[]>();
		for (const node of nodesByPath.values()) {
			const p = node.path;
			const parentPath = parentOf(p);
			if (!parentPath) continue;
			const arr = kidsByParent.get(parentPath) || [];
			arr.push(p);
			kidsByParent.set(parentPath, arr);
		}

		for (const [p, kids] of kidsByParent.entries()) {
			const parentNode = nodesByPath.get(p);
			if (parentNode && kids.length) parentNode.hasChildren = true;
		}

		const base = parent ? normalisePath(parent) : '';
		if (!base) return json(400, { ok: false, error: 'missing_parent' });

		const childPaths = kidsByParent.get(base) || [];
		const orderForParent = (() => {
			if (base.startsWith('/es/docs/')) {
				const canonBase = normalisePath(mapDocsSpanishToEnglishPath(base));
				const list = Array.isArray(order.parentChildren[canonBase]) ? order.parentChildren[canonBase]! : [];
				return list
					.map((p) => normalisePath(mapDocsEnglishToSpanishPath(String(p || ''))))
					.filter((p) => p && p.startsWith('/es/docs/'));
			}
			return Array.isArray(order.parentChildren[base]) ? order.parentChildren[base]! : [];
		})();

		const fallbackCompare = (a: string, b: string) => {
			const na = nodesByPath.get(a);
			const nb = nodesByPath.get(b);
			const at = na?.title || titleFromSeg(na?.seg || '') || String(na?.seg || '');
			const bt = nb?.title || titleFromSeg(nb?.seg || '') || String(nb?.seg || '');
			const canonBase = base.startsWith('/es/docs/') ? normalisePath(mapDocsSpanishToEnglishPath(base)) : base;
			if (canonBase === '/docs/propertylist-mls-user-manual/') {
				const aw = manualOrderWeight({ seg: na?.seg || '', title: at, path: a });
				const bw = manualOrderWeight({ seg: nb?.seg || '', title: bt, path: b });
				if (aw !== bw) return aw - bw;
			}
			return String(at).localeCompare(String(bt));
		};

		const sorted = sortPathsWithOrder({ parentPath: base, paths: childPaths, order: orderForParent, fallbackCompare }).ordered;
		const nodes = sorted
			.map((p) => nodesByPath.get(p))
			.filter(Boolean)
			.map((n) => ({
				path: n!.path,
				seg: n!.seg,
				title: n!.title,
				hasPage: n!.hasPage,
				pageId: n!.pageId,
				hasChildren: n!.hasChildren,
				parentPath: base,
			}));

		return json(200, { ok: true, parent: base, nodes });
	} catch (e: any) {
		const status = typeof e?.status === 'number' ? e.status : 500;
		return json(status, { ok: false, error: status === 500 ? 'server_error' : String(e?.message || 'error') });
	}
};
