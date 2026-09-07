import fs from 'node:fs';

// The map JSON is rebuilt nightly by cron, but these pages used to load it with
// `await import(...)`. Node's ESM cache resolves a dynamic import once per process and
// never re-reads the file, and info-hub can run for days between deploys - the data cron
// has no restart step, and the systemd path watcher only fires on dist/server/entry.mjs,
// which the cron never writes. The result was a map showing whatever was baked in at the
// last deploy while its own "Rebuilt" stamp asserted it was current.
//
// Read from disk instead, and re-parse only when the file has actually changed. On a read
// failure we keep serving the last good copy rather than blanking the page.

const DIR = '/opt/info-hub/public/map';
const cache = new Map<string, { mtimeMs: number; value: unknown }>();

export const readMapJson = <T = any>(file: string): T | null => {
	const full = `${DIR}/${file}`;
	try {
		const { mtimeMs } = fs.statSync(full);
		const hit = cache.get(file);
		if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;
		const value = JSON.parse(fs.readFileSync(full, 'utf8'));
		cache.set(file, { mtimeMs, value });
		return value as T;
	} catch {
		return (cache.get(file)?.value as T) ?? null;
	}
};
