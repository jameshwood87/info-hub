import fs from 'node:fs/promises';
import path from 'node:path';

type Store = {
	version: 1;
	weeks: Record<string, Record<string, number>>;
	totals: Record<string, number>;
};

const VAR_DIR = (process.env.INFO_HUB_VAR_DIR as string | undefined) || path.join(process.cwd(), 'var');
const STORE_PATH = path.join(VAR_DIR, 'weekly-views.json');
const MAX_WEEKS = 10;

let loaded = false;
let store: Store = { version: 1, weeks: {}, totals: {} };
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

const normalisePath = (p: string) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0]!.split('#')[0]!;
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const weekKeyForDate = (d: Date) => {
	const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const day = dt.getUTCDay();
	const diff = (day + 6) % 7;
	dt.setUTCDate(dt.getUTCDate() - diff);
	return dt.toISOString().slice(0, 10);
};

const nowWeekKey = () => weekKeyForDate(new Date());

const ensureLoaded = async () => {
	if (loaded) return;
	loaded = true;
	try {
		const raw = await fs.readFile(STORE_PATH, 'utf8');
		const json = JSON.parse(raw) as any;
		if (json && json.version === 1 && json.weeks && typeof json.weeks === 'object') {
			const totals = json.totals && typeof json.totals === 'object' ? (json.totals as Record<string, number>) : {};
			store = { version: 1, weeks: json.weeks as Record<string, Record<string, number>>, totals };
		}
	} catch {
		store = { version: 1, weeks: {}, totals: {} };
	}

	const nextWeeks: Record<string, Record<string, number>> = {};
	for (const [weekKey, week] of Object.entries(store.weeks || {})) {
		if (!week || typeof week !== 'object') continue;
		const out: Record<string, number> = {};
		for (const [rawPath, rawCount] of Object.entries(week)) {
			const p = normalisePath(rawPath);
			if (!p || p === '/') continue;
			const n = Number(rawCount || 0);
			if (!Number.isFinite(n) || n <= 0) continue;
			out[p] = (out[p] || 0) + n;
		}
		if (Object.keys(out).length) nextWeeks[weekKey] = out;
	}
	store.weeks = nextWeeks;

	const nextTotals: Record<string, number> = {};
	for (const [rawPath, rawCount] of Object.entries(store.totals || {})) {
		const p = normalisePath(rawPath);
		if (!p || p === '/') continue;
		const n = Number(rawCount || 0);
		if (!Number.isFinite(n) || n <= 0) continue;
		nextTotals[p] = (nextTotals[p] || 0) + n;
	}
	store.totals = nextTotals;
};

const pruneWeeks = () => {
	const keys = Object.keys(store.weeks).sort((a, b) => b.localeCompare(a));
	for (const k of keys.slice(MAX_WEEKS)) delete store.weeks[k];
};

const flushSoon = () => {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushing = flush().catch(() => undefined);
	}, 1500);
};

const flush = async () => {
	await ensureLoaded();
	pruneWeeks();
	await fs.mkdir(VAR_DIR, { recursive: true });
	const tmp = `${STORE_PATH}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
	await fs.rename(tmp, STORE_PATH);
};

export const recordWeeklyView = async (pathname: string) => {
	await ensureLoaded();
	const p = normalisePath(pathname);
	if (!p || p === '/' || !p.startsWith('/')) return;
	const key = nowWeekKey();
	const week = store.weeks[key] || (store.weeks[key] = {});
	week[p] = (week[p] || 0) + 1;
	store.totals[p] = (store.totals[p] || 0) + 1;
	flushSoon();
};

export const getWeeklyTopPaths = async (opts: { prefix: string; limit: number; weekKey?: string }) => {
	await ensureLoaded();
	if (flushing) await flushing.catch(() => undefined);

	const prefix = String(opts.prefix || '');
	const limit = Math.max(1, Math.min(50, Number(opts.limit) || 5));
	const key = String(opts.weekKey || nowWeekKey());
	const week = store.weeks[key] || {};
	const entries = Object.entries(week)
		.filter(([p]) => (prefix ? p.startsWith(prefix) : true))
		.sort((a, b) => (b[1] || 0) - (a[1] || 0));
	return entries.slice(0, limit).map(([p]) => p);
};

export const getRecentViewCounts = async (paths: string[]) => {
	await ensureLoaded();
	if (flushing) await flushing.catch(() => undefined);
	const wanted = new Set(paths.map((p) => String(p || '').trim()).filter(Boolean));
	const wantedEntries = Array.from(wanted).map((req) => {
		const canon = normalisePath(req);
		const alt = canon.endsWith('/') ? canon.slice(0, -1) : canon;
		const keys = Array.from(new Set([canon, alt].filter((k) => k && k.startsWith('/') && k !== '/')));
		return { req, keys };
	});
	const counts: Record<string, number> = {};
	for (const { req } of wantedEntries) counts[req] = 0;
	for (const week of Object.values(store.weeks)) {
		for (const { req, keys } of wantedEntries) {
			for (const k of keys) counts[req] += Number((week as any)[k] || 0);
		}
	}
	return counts;
};

export const getTotalViewCounts = async (paths: string[]) => {
	await ensureLoaded();
	if (flushing) await flushing.catch(() => undefined);
	const wanted = new Set(paths.map((p) => String(p || '').trim()).filter(Boolean));
	const counts: Record<string, number> = {};
	for (const req of wanted) {
		const canon = normalisePath(req);
		const alt = canon.endsWith('/') ? canon.slice(0, -1) : canon;
		const a = canon && canon !== '/' ? Number(store.totals[canon] || 0) : 0;
		const b = alt && alt !== canon && alt !== '/' ? Number(store.totals[alt] || 0) : 0;
		counts[req] = a + b;
	}
	return counts;
};
