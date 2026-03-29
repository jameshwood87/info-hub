import type { APIRoute } from 'astro';
import { assertAdmin, assertCsrf } from '../../../../lib/adminAuth';
import { assertAllowedPath, normalisePath, writeAudit } from '../../../../lib/adminContent';
import { adminListKbPagesByPrefix, adminUpdateKbPage } from '../../../../lib/directus';
import { addPrefixRedirect } from '../../../../lib/kbRedirects';
import { renameTreePathPrefix, reorderTreeNode } from '../../../../lib/kbTreeOrder';

const json = (status: number, body: any) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const scopeForPath = (p: string) => {
	const path = normalisePath(p);
	if (path.startsWith('/docs/') || path.startsWith('/es/docs/')) return 'docs' as const;
	if (path.startsWith('/blog/') || path.startsWith('/general-information/')) return 'blog' as const;
	return null;
};

const derivedParentPath = (nodePath: string) => {
	const p = normalisePath(nodePath);
	if (!p) return '';
	const parts = p.split('/').filter(Boolean);
	if (parts.length <= 1) return '';
	return `/${parts.slice(0, -1).join('/')}/`;
};

const lastSeg = (p: string) => {
	const path = normalisePath(p);
	const parts = path.split('/').filter(Boolean);
	return parts.length ? parts[parts.length - 1]! : '';
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const session = assertAdmin(request);
		assertCsrf(request, session);

		let body: any = null;
		try {
			body = await request.json();
		} catch {
			return json(400, { ok: false, error: 'invalid_json' });
		}

		const nodePathRaw = String(body?.nodePath || '');
		const toParentPathRaw = String(body?.toParentPath || '');
		const toIndex = Number(body?.toIndex || 0);

		const scope = scopeForPath(nodePathRaw);
		if (!scope) return json(400, { ok: false, error: 'invalid_scope' });

		const nodePath = assertAllowedPath(scope, nodePathRaw);
		const toParentPath = assertAllowedPath(scope, toParentPathRaw);
		if (nodePath.startsWith('/es/docs/') || toParentPath.startsWith('/es/docs/')) {
			return json(403, { ok: false, error: 'readonly_language' });
		}
		const derivedParent = derivedParentPath(nodePath);
		if (!derivedParent) return json(400, { ok: false, error: 'cannot_move_root' });

		const seedIn = body?.seed && typeof body.seed === 'object' ? body.seed : null;
		const seed = (() => {
			if (!seedIn) return undefined;
			const out: Record<string, string[]> = {};
			const pick = (parent: string) => {
				const k1 = parent;
				const k2 = normalisePath(parent);
				const raw = (seedIn[k1] || seedIn[k2]) as any;
				if (!Array.isArray(raw) || !raw.length) return;
				out[normalisePath(parent)] = raw.map((p: any) => assertAllowedPath(scope, String(p || ''))).filter(Boolean);
			};
			pick(derivedParent);
			pick(toParentPath);
			return Object.keys(out).length ? out : undefined;
		})();

		if (toParentPath.startsWith(nodePath)) return json(400, { ok: false, error: 'cannot_move_into_descendant' });

		const probe = await adminListKbPagesByPrefix({ prefix: nodePath, limit: 1, status: 'any' }).catch(() => []);
		if (!probe.length) return json(404, { ok: false, error: 'not_found' });

		const treeResult = await reorderTreeNode({
			nodePath,
			derivedParentPath: derivedParent,
			toParentPath,
			toIndex: Number.isFinite(toIndex) ? toIndex : 0,
			seed,
		});

		const shouldRewritePath = derivedParent !== toParentPath;
		const rename = await (async () => {
			if (!shouldRewritePath) return null;
			const seg = lastSeg(nodePath);
			if (!seg) return null;
			const newNodePath = normalisePath(`${toParentPath}${seg}/`);
			if (!newNodePath || newNodePath === nodePath) return null;

			const moving: Array<{ id: string; path: string }> = [];
			for (let offset = 0; offset < 200000; offset += 500) {
				const batch = await adminListKbPagesByPrefix({ prefix: nodePath, limit: 500, offset, status: 'any' }).catch(() => []);
				for (const it of batch) moving.push({ id: String(it.id), path: normalisePath(it.path) });
				if (batch.length < 500) break;
			}
			const movingIds = new Set(moving.map((m) => m.id));

			const plan = moving.map((m) => {
				const rest = m.path.startsWith(nodePath) ? m.path.slice(nodePath.length) : '';
				const next = normalisePath(`${newNodePath}${rest}`);
				return { id: m.id, from: m.path, to: next };
			});

			const toPaths = new Set<string>();
			for (const p of plan) {
				if (!p.to) throw Object.assign(new Error('invalid_target_path'), { status: 400 });
				if (toPaths.has(p.to)) throw Object.assign(new Error('target_path_collision'), { status: 409 });
				toPaths.add(p.to);
			}

			const existingTarget: Array<{ id: string; path: string }> = [];
			for (let offset = 0; offset < 200000; offset += 500) {
				const batch = await adminListKbPagesByPrefix({ prefix: newNodePath, limit: 500, offset, status: 'any' }).catch(() => []);
				for (const it of batch) existingTarget.push({ id: String(it.id), path: normalisePath(it.path) });
				if (batch.length < 500) break;
			}
			for (const ex of existingTarget) {
				if (!toPaths.has(ex.path)) continue;
				if (!movingIds.has(ex.id)) throw Object.assign(new Error('target_path_taken'), { status: 409 });
			}

			plan.sort((a, b) => a.from.length - b.from.length);
			for (const p of plan) {
				await adminUpdateKbPage(p.id, { path: p.to });
			}

			await renameTreePathPrefix({ fromPrefix: nodePath, toPrefix: newNodePath }).catch(() => undefined);
			await addPrefixRedirect(nodePath, newNodePath).catch(() => undefined);

			return { fromPrefix: nodePath, toPrefix: newNodePath, movedCount: plan.length };
		})().catch((e: any) => {
			throw Object.assign(e instanceof Error ? e : new Error(String(e || 'error')), {
				status: typeof e?.status === 'number' ? e.status : 500,
			});
		});

		await writeAudit({
			action: 'kb_tree.reorder',
			userId: session.userId,
			path: nodePath,
			ip: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || clientAddress || '',
			details: { ...treeResult, ...(rename ? { rename } : {}) },
		}).catch(() => undefined);

		const result = rename ? { ...treeResult, nodePath: rename.toPrefix } : treeResult;
		return json(200, { ok: true, result, rename });
	} catch (e: any) {
		const status = typeof e?.status === 'number' ? e.status : 500;
		return json(status, { ok: false, error: status === 500 ? 'server_error' : String(e?.message || 'error') });
	}
};
