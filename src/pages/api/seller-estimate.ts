import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { areaMarketSummary } from '../../lib/marketData';

// Indicative market guide for a seller's own property. Deliberately NOT a valuation:
// a "tasacion" is a regulated valuation performed by a licensed sociedad de tasacion
// (Orden ECO/805/2003). Everything here is an estimate derived from market data, and the
// wording in the response and on the page must stay that way.
//
// No personal data is handled by this endpoint - it takes property facts only, so the
// visitor can see real numbers before deciding whether to give us an email address.

// The MCP returns a generic nationwide fallback for locations it cannot match (an unknown
// place name still comes back with ~4,400 listings and a plausible price per m2). For a
// seller-facing number that is unacceptable, so only areas we actually publish are accepted.
let allowedAreas: Set<string> | null = null;
const loadAreas = async () => {
	if (allowedAreas) return allowedAreas;
	const set = new Set<string>();
	try {
		const d = JSON.parse(await fs.readFile('/opt/info-hub/var/admin/finder-counts.json', 'utf8'));
		for (const a of d.areas || []) {
			if (a?.name) set.add(String(a.name).toLowerCase());
			if (a?.slug) set.add(String(a.slug).toLowerCase());
		}
	} catch {}
	allowedAreas = set;
	return set;
};

const json = (body: Record<string, unknown>, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// best-effort in-process rate limit: 20 estimates per IP per hour
const recent = new Map<string, number[]>();
const allow = (ip: string) => {
	const now = Date.now();
	const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
	if (list.length >= 20) return false;
	list.push(now);
	recent.set(ip, list);
	return true;
};
const clientIpOf = (request: Request, clientAddress?: string) =>
	String(request.headers.get('cf-connecting-ip') || clientAddress || 'unknown');

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!allow(clientIpOf(request, clientAddress))) return json({ ok: false, error: 'rate_limited' }, 429);

	let b: any = {};
	try {
		b = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid_json' }, 400);
	}

	const area = String(b?.area || '').trim().slice(0, 60);
	const builtSqm = Number(b?.builtSqm);
	if (!area) return json({ ok: false, error: 'no_area' }, 400);

	const allowed = await loadAreas();
	if (allowed.size && !allowed.has(area.toLowerCase())) {
		return json({ ok: true, enough: false, area, reason: 'unsupported_area' });
	}
	if (!Number.isFinite(builtSqm) || builtSqm < 20 || builtSqm > 2000) return json({ ok: false, error: 'bad_sqm' }, 400);

	const sale = await areaMarketSummary(area, 'for-sale').catch(() => null);
	if (!sale) return json({ ok: false, error: 'no_data', area }, 200);

	const oracleSqm = sale.oracle?.verified ? sale.oracle.verifiedPricePerSqm : null;
	const askingSqm = sale.medianPricePerSqm;
	const basis = oracleSqm ? 'registered' : askingSqm ? 'asking' : null;
	const perSqm = oracleSqm || askingSqm;

	// Too thin to say anything responsible. Say so plainly rather than invent a number.
	if (!perSqm || sale.totalListings < 8) {
		return json({
			ok: true,
			enough: false,
			area: sale.location || area,
			listings: sale.totalListings,
		});
	}

	const mid = Math.round(perSqm * builtSqm);
	const round = (n: number) => Math.round(n / 5000) * 5000;

	return json({
		ok: true,
		enough: true,
		area: sale.location || area,
		builtSqm,
		basis, // 'registered' = notary-verified completed sales, 'asking' = what sellers ask
		perSqm: Math.round(perSqm),
		low: round(mid * 0.9),
		high: round(mid * 1.1),
		listings: sale.totalListings,
		medianPrice: sale.medianPrice,
		oracle: {
			verified: Boolean(sale.oracle?.verified),
			sampleSize: sale.oracle?.sampleSize ?? null,
			periodEnd: sale.oracle?.periodEnd ?? null,
			attestationUrl: sale.oracle?.attestationUrl ?? null,
		},
	});
};
