import fs from 'node:fs/promises';
import path from 'node:path';

// Generic day-keyed event counters (CTA clicks, AI-crawler hits...).
// Same persistence pattern as weeklyViews: in-memory store, debounced flush.
// Shape: days["YYYY-MM-DD"][path][kind] = count

type Store = { version: 1; days: Record<string, Record<string, Record<string, number>>> };

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const STORE_PATH = path.join(VAR_DIR, 'event-stats.json');
const MAX_DAYS = 60;

let loaded = false;
let store: Store = { version: 1, days: {} };
let flushTimer: NodeJS.Timeout | null = null;

const dayKey = () => new Date().toISOString().slice(0, 10);

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw || !raw.startsWith('/')) return '';
	const noQuery = raw.split('?')[0]!.split('#')[0]!.replace(/\/{2,}/g, '/');
	const out = noQuery.endsWith('/') ? noQuery : `${noQuery}/`;
	return out.length > 300 ? '' : out;
};

const ensureLoaded = async () => {
	if (loaded) return;
	loaded = true;
	try {
		const json = JSON.parse(await fs.readFile(STORE_PATH, 'utf8')) as Store;
		if (json && json.version === 1 && json.days) store = json;
	} catch {
		store = { version: 1, days: {} };
	}
};

const flushSoon = () => {
	if (flushTimer) return;
	flushTimer = setTimeout(async () => {
		flushTimer = null;
		try {
			// prune old days
			const keys = Object.keys(store.days).sort();
			while (keys.length > MAX_DAYS) delete store.days[keys.shift() as string];
			const tmp = `${STORE_PATH}.tmp`;
			await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
			await fs.rename(tmp, STORE_PATH);
		} catch {
			/* best effort */
		}
	}, 4000);
};

export const recordEvent = async (kind: string, pathname: string) => {
	const p = normalisePath(pathname);
	const k = String(kind || '').slice(0, 60);
	if (!p || !k) return;
	await ensureLoaded();
	const day = (store.days[dayKey()] ||= {});
	const byPath = (day[p] ||= {});
	byPath[k] = (byPath[k] || 0) + 1;
	flushSoon();
};

/** Sum counts per path per kind over the last N days. Optional kind prefix filter. */
export const getEventTotals = async (days = 28, kindPrefix = ''): Promise<Record<string, Record<string, number>>> => {
	await ensureLoaded();
	const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
	const out: Record<string, Record<string, number>> = {};
	for (const [d, byPath] of Object.entries(store.days)) {
		if (d < cutoff) continue;
		for (const [p, kinds] of Object.entries(byPath)) {
			for (const [k, n] of Object.entries(kinds)) {
				if (kindPrefix && !k.startsWith(kindPrefix)) continue;
				((out[p] ||= {})[k] = (out[p][k] || 0) + n);
			}
		}
	}
	return out;
};

/** Grand totals per kind over the last N days (for digests). */
export const getKindTotals = async (days = 28): Promise<Record<string, number>> => {
	const byPath = await getEventTotals(days);
	const out: Record<string, number> = {};
	for (const kinds of Object.values(byPath)) for (const [k, n] of Object.entries(kinds)) out[k] = (out[k] || 0) + n;
	return out;
};
