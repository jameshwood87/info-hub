// ctr-stats.mjs - how a search-title test is judged (24-09-26).
//
// Before: the 28 days up to the day before the change. After: the 28 days that start on the
// 4th day after it, once Google has recrawled the page. The page's click rate after is
// compared with what it would have been had it moved like the untouched content pages over
// the same weeks (the control), with a two-proportion z-test: z of 1.64 or more either way
// (95% one-sided) is a clear change. Under 100 appearances on either side, or fewer than 10
// clicks in play, is too little to judge. Too little data and no clear difference both keep
// the new title; only a clear loss is undone.

export const DAY = 86400000;
export const iso = (t) => new Date(t).toISOString().slice(0, 10);

export function windows(appliedIso) {
  const a = new Date(appliedIso);
  const d0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return {
    before: { start: iso(d0 - 28 * DAY), end: iso(d0 - DAY) },
    after: { start: iso(d0 + 3 * DAY), end: iso(d0 + 30 * DAY) },
  };
}

// rowsBefore / rowsAfter: [{ path, clicks, impressions }]; include(path) picks the control
// pages. Only pages with appearances in both windows count, so a page that is new in one
// window cannot move the rate. Fewer than 10 such pages, or under 1,000 appearances on either
// side, gives factor 1, so one volatile page cannot swing a verdict.
export function controlFactor(rowsBefore, rowsAfter, include) {
  const after = new Map(rowsAfter.filter((r) => include(r.path)).map((r) => [r.path, r]));
  let cb = 0, ib = 0, ca = 0, ia = 0, pages = 0;
  for (const r of rowsBefore) {
    if (!include(r.path) || !after.has(r.path)) continue;
    const x = after.get(r.path);
    cb += r.clicks; ib += r.impressions; ca += x.clicks; ia += x.impressions; pages++;
  }
  const ok = pages >= 10 && ib >= 1000 && ia >= 1000 && cb > 0 && ca > 0;
  const factor = ok ? (ca / ia) / (cb / ib) : 1;
  return { factor: +factor.toFixed(3), pages, before: { clicks: cb, impressions: ib }, after: { clicks: ca, impressions: ia }, used: ok };
}

export function judge(b, a, factor = 1) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if ((b.impressions || 0) < 100 || (a.impressions || 0) < 100) return { verdict: 'too_little_data' };
  const p1 = (b.clicks / b.impressions) * f;
  const p2 = a.clicks / a.impressions;
  const expected = +(p1 * a.impressions).toFixed(1);
  if (b.clicks + a.clicks < 10) return { verdict: 'too_little_data', expected };
  const pool = Math.min(Math.max((b.clicks * f + a.clicks) / (b.impressions + a.impressions), 1e-6), 1 - 1e-6);
  const z = (p2 - p1) / Math.sqrt(pool * (1 - pool) * (1 / b.impressions + 1 / a.impressions));
  const lift = p1 > 0 ? +(p2 / p1 - 1).toFixed(3) : null;
  return { verdict: z >= 1.64 ? 'better' : z <= -1.64 ? 'worse' : 'no_clear_difference', z: +z.toFixed(2), lift, expected };
}
