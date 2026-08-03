// Live platform stats from the propertylist.es portal, so the info-hub homepage
// KPI counters always match the portal exactly instead of drifting hardcoded numbers.
//
// Source: https://propertylist.es/portal/bootstrap (public JSON). Relevant keys:
//   listings_count  -> active listings   ("Anuncios inmobiliarios")
//   agents_count    -> registered agencies ("Inmobiliarias registradas")  [key name is misleading]
//   employees_count -> individual agents  ("Agentes inmobiliarios")

export type PortalStats = {
	listings: number;
	agencies: number;
	agents: number;
};

// Last-known-good values (2026-08-03) used only if the portal is unreachable,
// so the homepage never renders an empty/broken stat.
const FALLBACK: PortalStats = { listings: 6167, agencies: 945, agents: 1319 };

const TTL_MS = 60 * 60 * 1000; // refresh at most hourly
let cache: { v: PortalStats; at: number } | null = null;

export async function getPortalStats(): Promise<PortalStats> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.v;
	try {
		const res = await fetch('https://propertylist.es/portal/bootstrap', {
			headers: { Accept: 'application/json', 'User-Agent': 'info-hub' },
			signal: AbortSignal.timeout(4000),
		});
		if (res.ok) {
			const j: any = await res.json();
			const pick = (n: unknown, fb: number) => {
				const v = Number(n);
				return Number.isFinite(v) && v > 0 ? Math.round(v) : fb;
			};
			const v: PortalStats = {
				listings: pick(j?.listings_count, FALLBACK.listings),
				agencies: pick(j?.agents_count, FALLBACK.agencies),
				agents: pick(j?.employees_count, FALLBACK.agents),
			};
			cache = { v, at: Date.now() };
			return v;
		}
	} catch {
		// fall through
	}
	// On failure: prefer a previous good value; otherwise fallback without poisoning
	// the cache so the next request retries.
	if (cache) return cache.v;
	return FALLBACK;
}

// Format a live count as a safe marketing figure that rounds DOWN and adds "+",
// e.g. 6210 -> "6,200+", 922 -> "920+", 1290 -> "1,200+". Never overstates; grows on its own.
export function statPlus(n: number, lang: 'en' | 'es' | 'de' = 'en'): string {
	if (!Number.isFinite(n) || n <= 0) return '0';
	const mag = Math.pow(10, Math.max(1, Math.floor(Math.log10(n)) - 1));
	const floored = Math.floor(n / mag) * mag;
	const sep = lang === 'en' ? ',' : '.';
	return String(floored).replace(/\B(?=(\d{3})+(?!\d))/g, sep) + '+';
}
