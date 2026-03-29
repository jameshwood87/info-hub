import fs from 'node:fs';
import path from 'node:path';

const cache: Record<string, string | undefined> = {};
let loaded = false;
let envMap: Record<string, string> = {};

const parseEnv = (src: string) => {
	const out: Record<string, string> = {};
	for (const lineRaw of String(src || '').split(/\r?\n/)) {
		const line = lineRaw.trim();
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		let k = line.slice(0, idx).trim();
		let v = line.slice(idx + 1).trim();
		if (/^export\s+/i.test(k)) k = k.replace(/^export\s+/i, '').trim();
		if (!k) continue;
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		out[k] = v;
	}
	return out;
};

const load = () => {
	if (loaded) return;
	loaded = true;
	const candidates = [
		path.join(process.cwd(), '.env'),
		'/opt/info-hub/.env',
		'/opt/info-hub.new/.env',
		path.join(process.cwd(), '..', '.env'),
	];
	for (const p of candidates) {
		try {
			if (!fs.existsSync(p)) continue;
			const src = fs.readFileSync(p, 'utf8');
			envMap = { ...envMap, ...parseEnv(src) };
		} catch {}
	}
};

export const getServerEnv = (name: string) => {
	const key = String(name || '').trim();
	if (!key) return undefined;
	if (Object.prototype.hasOwnProperty.call(cache, key) && typeof cache[key] === 'string') return cache[key];
	const v1 = (import.meta as any).env?.[key];
	if (typeof v1 === 'string' && v1.trim()) return (cache[key] = v1.trim());
	const v2 = (process as any)?.env?.[key];
	if (typeof v2 === 'string' && v2.trim()) return (cache[key] = v2.trim());
	load();
	const v3 = envMap[key];
	if (typeof v3 === 'string' && v3.trim()) return (cache[key] = v3.trim());
	return undefined;
};
