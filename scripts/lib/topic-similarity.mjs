// Near-duplicate check for blog topics (James, 28-09-26: "skip any idea too close to something published in the last
// two months"). Plain word overlap on English titles, no AI. Stop words and the words nearly every post shares (Costa
// del Sol, property, price, live MLS, 2026...) are dropped, and plurals and -ing/-ed/-e endings are folded so "shared
// listings" and "share a listing" meet. A topic is too close when it shares at least 3 words with a recent title and
// either 30% of all their words or 60% of the shorter title's words.
// Calibrated 28-09-26 on the 42 English posts of the previous 120 days: it flags the swimming-pool repeat (18-09 and
// 22-09), the two first Housing Law fines posts (10-07 and 14-07) and the two listing-sharing posts (26-09 and 27-09),
// and passes related angles such as the tourist licence map versus how to get a licence. The monthly What's On diaries
// also match each other, by design; they come from whats-on-monthly-post.mjs, which does not use this check.
export const RECENT_DAYS = 60;

const STOP = new Set(('a an the and or of in on at to for from by with without into over under vs versus what which who whom ' +
  'how why when where does do did is are was were be can could should would will you your our we it its this that these ' +
  'those than then there their much many more most very just still also about after before per each every any all new now ' +
  'today 2024 2025 2026 2027 guide complete step steps using use live mls price prices priced pricing oracle data costa del ' +
  'sol spain spanish andalucia malaga property properties home homes house houses town towns market markets el la las los ' +
  'de y en').split(' '));

const fold = (w) => {
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
};

export function topicWords(text) {
  const out = new Set();
  const plain = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ');
  for (const raw of plain.split(' ')) {
    if (raw.length < 2 || STOP.has(raw) || /^\d{1,2}$/.test(raw)) continue;
    const w = fold(raw);
    if (w.length >= 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

export function topicSimilarity(a, b) {
  const A = topicWords(a);
  const B = topicWords(b);
  const shared = [...A].filter((w) => B.has(w));
  const union = new Set([...A, ...B]).size || 1;
  return { shared, jaccard: shared.length / union, overlap: shared.length / (Math.min(A.size, B.size) || 1) };
}

export const isTooClose = (sim) => sim.shared.length >= 3 && (sim.jaccard >= 0.3 || sim.overlap >= 0.6);

// English blog posts created in the last `days` days that are live or waiting for James's approval.
export async function recentBlogTitles({ directusUrl, token, days = RECENT_DAYS }) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const url = `${directusUrl}/items/kb_pages?filter[path][_starts_with]=/blog/&filter[language][_eq]=en` +
    `&filter[status][_in]=published,draft&filter[date_created][_gte]=${encodeURIComponent(since)}&fields=title,path,date_created&limit=-1`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Directus ${r.status}`);
  return ((await r.json()).data || []).filter((x) => x && x.title)
    .map((x) => ({ title: String(x.title), path: String(x.path || ''), date: String(x.date_created || '').slice(0, 10) }));
}

// The closest post the topic is too close to, or null.
export function closestRecent(topic, posts) {
  let best = null;
  for (const post of posts || []) {
    const sim = topicSimilarity(topic, post.title);
    if (isTooClose(sim) && (!best || sim.jaccard + sim.overlap > best.sim.jaccard + best.sim.overlap)) best = { post, sim };
  }
  return best;
}
