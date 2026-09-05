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

// Last-known-good values (2026-09-05) used only if the portal is unreachable,
// so the homepage never renders an empty/broken stat.
const FALLBACK: PortalStats = { listings: 6493, agencies: 995, agents: 1388 };

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

// Format a live count as a safe marketing figure that rounds DOWN to the nearest 10 and adds "+",
// e.g. 6493 -> "6,490+", 995 -> "990+", 1388 -> "1,380+". Never overstates; grows on its own,
// and stays within 9 of the exact figure the stats strip shows (2026-09-05, was two significant digits).
export function statPlus(n: number, lang: 'en' | 'es' | 'de' | 'fr' | 'sv' | 'ru' = 'en'): string {
	if (!Number.isFinite(n) || n <= 0) return '0';
	const floored = Math.floor(n / 10) * 10;
	// English groups thousands with a comma, Spanish and German with a full
	// stop, and French, Swedish and Russian with a space. The space is
	// non-breaking so a figure never wraps in half at the end of a line.
	const sep = lang === 'en' ? ',' : lang === 'fr' || lang === 'sv' || lang === 'ru' ? '\u00a0' : '.';
	return String(floored).replace(/\B(?=(\d{3})+(?!\d))/g, sep) + '+';
}
