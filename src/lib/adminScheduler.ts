import { adminGetKbPageById, adminUpdateKbPage, listKbPagesByPrefix } from './directus';
import { getKbMetaSnapshot, listDueScheduled, setKbMeta } from './adminMeta';
import { writeAudit } from './adminContent';
import { refreshKbStatsForKeyWithSnapshot } from '../pages/api/update-area-stats';

let lastRunMs = 0;
let running: Promise<void> | null = null;

export const runPublishScheduler = async (opts?: { minIntervalMs?: number }) => {
	const minIntervalMs = Math.max(0, Number(opts?.minIntervalMs) || 60_000);
	const now = Date.now();
	if (running) return running;
	if (now - lastRunMs < minIntervalMs) return;

	running = (async () => {
		try {
			lastRunMs = Date.now();
			const due = await listDueScheduled(Date.now());
			for (const item of due) {
				const page = await adminGetKbPageById(item.id).catch(() => null);
				if (!page) {
					await setKbMeta(item.id, { scheduledAt: null });
					continue;
				}
				if (String(page.status || '') !== 'published') {
					await adminUpdateKbPage(item.id, { status: 'published' as any });
					await writeAudit({
						action: 'kb_pages.scheduled_publish',
						userId: 'scheduler',
						kbPageId: item.id,
						path: page.path,
						details: { scheduledAt: item.scheduledAt },
					}).catch(() => undefined);
				}
				await setKbMeta(item.id, { scheduledAt: null });
			}
		} finally {
			running = null;
		}
	})();

	return running;
};

let lastAreaStatsRunMs = 0;
let runningAreaStats: Promise<void> | null = null;

const STATS_CACHE_DAYS = 90;
const STATS_CACHE_MS = STATS_CACHE_DAYS * 24 * 60 * 60 * 1000;

const isDueAreaStats = (v: any, nowMs: number) => {
	const dueAt = typeof v?.areaStatsDueAt === 'string' ? Date.parse(v.areaStatsDueAt) : NaN;
	if (Number.isFinite(dueAt) && dueAt <= nowMs) return true;
	const updatedAt = typeof v?.areaStatsUpdatedAt === 'string' ? Date.parse(v.areaStatsUpdatedAt) : NaN;
	if (Number.isFinite(updatedAt) && nowMs - updatedAt > STATS_CACHE_MS) return true;
	if (!Number.isFinite(dueAt) && !Number.isFinite(updatedAt)) return true;
	return false;
};

export const runAreaStatsScheduler = async (opts?: { minIntervalMs?: number; limit?: number }) => {
	const minIntervalMs = Math.max(0, Number(opts?.minIntervalMs) || 60_000);
	const limit = Math.max(1, Math.min(200, Number(opts?.limit) || 30));
	const now = Date.now();
	if (runningAreaStats) return runningAreaStats;
	if (now - lastAreaStatsRunMs < minIntervalMs) return;

	runningAreaStats = (async () => {
		try {
			lastAreaStatsRunMs = Date.now();
			const snapshot = await getKbMetaSnapshot();
			const dueKeys = Object.entries(snapshot)
				.filter(([k]) => {
					const key = String(k || '');
					if (!key) return false;
					if (key.startsWith('/')) return key.startsWith('/andalucia/') || key.startsWith('/es/andalucia/');
					return true;
				})
				.filter(([, v]) => isDueAreaStats(v, now))
				.slice(0, limit)
				.map(([k]) => String(k || ''))
				.filter(Boolean);

			const nextDue = new Date(now + STATS_CACHE_MS).toISOString();
			const nowIso = new Date(now).toISOString();

			for (const key of dueKeys) {
				if (key.startsWith('/')) {
					await setKbMeta(key, { areaStatsUpdatedAt: nowIso, areaStatsDueAt: nextDue });
					continue;
				}
				const page = await adminGetKbPageById(key).catch(() => null);
				if (!page) continue;
				const p = String(page.path || '');
				if (!p.startsWith('/andalucia/') && !p.startsWith('/es/andalucia/')) continue;
				await setKbMeta(key, { areaStatsUpdatedAt: nowIso, areaStatsDueAt: nextDue });
				await writeAudit({
					action: 'kb_meta.area_stats_refresh',
					userId: 'scheduler',
					kbPageId: key,
					path: p,
					details: { dueAt: nextDue },
				}).catch(() => undefined);
			}
		} finally {
			runningAreaStats = null;
		}
	})();

	return runningAreaStats;
};

let lastNeighbourhoodStatsRunMs = 0;
let runningNeighbourhoodStats: Promise<void> | null = null;
let cachedNeighbourhoodPages: { atMs: number; pages: Array<{ id: string; path: string }> } | null = null;

const NEIGHBOURHOOD_STATS_VERSION = 3;

const isDueNeighbourhoodStats = (v: any, nowMs: number) => {
	const dueAt = typeof v?.neighbourhoodStatsDueAt === 'string' ? Date.parse(v.neighbourhoodStatsDueAt) : NaN;
	if (Number.isFinite(dueAt) && dueAt <= nowMs) return true;
	const updatedAt = typeof v?.neighbourhoodStatsUpdatedAt === 'string' ? Date.parse(v.neighbourhoodStatsUpdatedAt) : NaN;
	if (Number.isFinite(updatedAt) && nowMs - updatedAt > STATS_CACHE_MS) return true;
	if (!Number.isFinite(dueAt) && !Number.isFinite(updatedAt)) return true;
	return false;
};

export const runNeighbourhoodStatsScheduler = async (opts?: { minIntervalMs?: number; limit?: number; keyHint?: string }) => {
	const minIntervalMs = Math.max(0, Number(opts?.minIntervalMs) || 60_000);
	const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 25));
	const keyHintRaw = String(opts?.keyHint || '').trim();
	const keyHint = keyHintRaw ? (keyHintRaw.endsWith('/') ? keyHintRaw : `${keyHintRaw}/`) : '';
	const now = Date.now();
	if (runningNeighbourhoodStats) return runningNeighbourhoodStats;
	if (now - lastNeighbourhoodStatsRunMs < minIntervalMs) return;

	runningNeighbourhoodStats = (async () => {
		try {
			lastNeighbourhoodStatsRunMs = Date.now();
			const snapshot = await getKbMetaSnapshot();

			const shouldReload =
				!cachedNeighbourhoodPages || !cachedNeighbourhoodPages.pages.length || now - cachedNeighbourhoodPages.atMs > 30 * 60 * 1000;
			if (shouldReload) {
				const [en, es] = await Promise.all([
					listKbPagesByPrefix({ prefix: '/neighbourhood/', lang: 'en', limit: 500 }).catch(() => []),
					listKbPagesByPrefix({ prefix: '/es/barrios/', lang: 'es', limit: 500 }).catch(() => []),
				]);
				const pages = [...en, ...es]
					.map((p: any) => ({ id: String(p?.id || '').trim(), path: String(p?.path || '').trim() }))
					.filter((p) => p.id && (p.path.startsWith('/neighbourhood/') || p.path.startsWith('/es/barrios/')));
				const uniq = new Map<string, { id: string; path: string }>();
				for (const p of pages) uniq.set(p.id, p);
				cachedNeighbourhoodPages = { atMs: now, pages: Array.from(uniq.values()).sort((a, b) => a.path.localeCompare(b.path)) };
			}

			const hintPage =
				keyHint && (keyHint.startsWith('/neighbourhood/') || keyHint.startsWith('/es/barrios/'))
					? cachedNeighbourhoodPages?.pages.find((p) => p.path === keyHint) || null
					: null;

			let updatedCount = 0;
			if (hintPage) {
				const r = await refreshKbStatsForKeyWithSnapshot(hintPage.id, snapshot as any, { nowMs: now, force: true });
				if (r.ok && r.updated) updatedCount += 1;
			} else if (keyHint && (keyHint.startsWith('/neighbourhood/') || keyHint.startsWith('/es/barrios/'))) {
				const r = await refreshKbStatsForKeyWithSnapshot(keyHint, snapshot as any, { nowMs: now, force: true });
				if (r.ok && r.updated) updatedCount += 1;
			}

			const duePages = (cachedNeighbourhoodPages?.pages || []).filter((p) => {
				if (!p?.id) return false;
				if (hintPage && p.id === hintPage.id) return false;
				const v: any = (snapshot as any)[p.id] || {};
				const needsVersionRefresh = Number(v?.neighbourhoodStatsVersion || 0) < NEIGHBOURHOOD_STATS_VERSION;
				const wantsListingsRefresh =
					typeof v?.neighbourhoodStats?.listingCount === 'number' &&
					Number(v.neighbourhoodStats.listingCount) > 0 &&
					(!Array.isArray(v?.neighbourhoodListings) || v.neighbourhoodListings.length === 0);
				return needsVersionRefresh || wantsListingsRefresh || isDueNeighbourhoodStats(v, now);
			});

			for (const p of duePages) {
				const r = await refreshKbStatsForKeyWithSnapshot(p.id, snapshot as any, { nowMs: now });
				if (r.ok && r.updated) updatedCount += 1;
				if (updatedCount >= limit) break;
			}
		} finally {
			runningNeighbourhoodStats = null;
		}
	})();

	return runningNeighbourhoodStats;
};
