import { listKbPagesByPrefix } from '../lib/directus';
import { canonicalAreaPath } from '../lib/areaProvince';
import { listPrefixRedirects } from '../lib/kbRedirects';

export const prerender = false;

const origin = 'https://info.propertylist.es';

type Alt = { hreflang: string; href: string };

const asLastMod = (iso: string | null | undefined) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
};

const escapeXml = (s: string) =>
  String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const buildUrlEntry = (loc: string, lastmod: string | null, alternates?: Alt[]) => {
  const safeLoc = escapeXml(loc);
  const safeLastMod = lastmod ? escapeXml(lastmod) : null;
  const links = (alternates || [])
    .map((a) => `<xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`)
    .join('');
  return `<url><loc>${safeLoc}</loc>${safeLastMod ? `<lastmod>${safeLastMod}</lastmod>` : ''}${links}</url>`;
};

// Directus stores generator-written blog paths WITHOUT a trailing slash and
// WordPress-era ones WITH; every comparison must normalise or ES twins vanish.
const withSlash = (p: string) => (p && !p.endsWith('/') ? `${p}/` : p);

const normaliseEsDocsPath = (p: string) => {
  const path = String(p || '');
  if (!path.startsWith('/es/docs/')) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'es' || parts[1] !== 'docs') return path;
  const root = parts[2] || '';
  const mappedRoot =
    root === 'propertylist-mls-user-manual'
      ? 'propertylist-mls-manual-de-usuario'
      : root === 'mls-manual-de-usuario'
        ? 'propertylist-mls-manual-de-usuario'
      : root === 'laws-procedures'
        ? 'leyes-procedimientos'
        : root === 'public-portal'
          ? 'portal-publico'
          : root === 'getting-started'
            ? 'empezar'
            : root;
  parts[2] = mappedRoot;
  if (mappedRoot === 'propertylist-mls-manual-de-usuario') {
    const sub = parts[3] || '';
    if (sub === 'getting-started') parts[3] = 'empezar';
  }
  return `/${parts.join('/')}/`;
};

const toSpanishPath = (p: string) => {
  const path = String(p || '');
  if (path.startsWith('/neighbourhood/')) {
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'neighbourhood' && parts.length === 4) {
      const slug = parts[3] || '';
      if (slug) return `/es/barrios/${slug}/`;
    }
  }
  const mapPairs: Array<{ en: string; es: string }> = [
    { en: '/general-information/', es: '/es/informacion-general/' },
    { en: '/blog/', es: '/es/blog/' },
    { en: '/community/', es: '/es/comunidad/' },
    { en: '/laws/', es: '/es/leyes/' },
    { en: '/neighbourhood/', es: '/es/barrios/' },
    { en: '/andalucia/', es: '/es/andalucia/' },
    { en: '/pricing/', es: '/es/precios/' },
    { en: '/referrals/', es: '/es/referidos/' },
    { en: '/whats-on/', es: '/es/que-hacer/' },
    { en: '/search', es: '/es/search' },
  ];
  for (const pair of mapPairs) {
    if (path.startsWith(pair.en)) return `${pair.es}${path.slice(pair.en.length)}`;
  }
  if (!path.startsWith('/docs/')) return `/es${path.startsWith('/') ? path : `/${path}`}`;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'docs') return `/es/${parts.join('/')}/`;
  const seg = parts[1] || '';
  const mapped =
    seg === 'propertylist-mls-user-manual'
      ? 'propertylist-mls-manual-de-usuario'
      : seg === 'mls-manual-de-usuario'
        ? 'propertylist-mls-manual-de-usuario'
      : seg === 'laws-procedures'
        ? 'leyes-procedimientos'
        : seg === 'public-portal'
          ? 'portal-publico'
          : seg === 'getting-started'
            ? 'empezar'
            : seg;
  parts[1] = mapped;
  if (mapped === 'propertylist-mls-manual-de-usuario') {
    const sub = parts[2] || '';
    if (sub === 'getting-started') parts[2] = 'empezar';
  }
  return `/es/${parts.join('/')}/`;
};

const applyStaticRedirectAliases = (pRaw: string) => {
  const raw = String(pRaw || '');
  const aliases: Array<{ from: string; to: string }> = [
    {
      from: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/new-page/',
      to: '/es/docs/propertylist-mls-manual-de-usuario/managing-your-leads/',
    },
  ];
  for (const r of aliases) {
    if (!raw.startsWith(r.from)) continue;
    return `${r.to}${raw.slice(r.from.length)}`;
  }
  return raw;
};

const canonicalNeighbourhoodPath = (p: string) => {
  const path = String(p || '');
  if (!path.startsWith('/neighbourhood/')) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'neighbourhood') return path;
  if (parts.length >= 4) return path;
  if (parts.length !== 2) return path;
  const slug = parts[1] || '';
  if (!slug || slug === 'andalucia' || slug === 'spain') return path;
  return canonicalAreaPath(slug);
};

// Set of REAL (published, non-placeholder) ES page paths, normalised, used to
// emit hreflang only for genuine pairs and to avoid listing phantom ES URLs.
const fetchRealEsPaths = async (): Promise<Set<string>> => {
  const base = (process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
  const token = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
  const isStub = (b: string) => /abrir en ingl[eé]s/i.test(b) && /(pr[oó]ximamente|traducci[oó]n en curso)/i.test(b);
  const set = new Set<string>();
  let page = 1;
  for (;;) {
    const res = await fetch(
      `${base}/items/kb_pages?filter[status][_eq]=published&filter[language][_eq]=es&fields=path,body&limit=200&page=${page}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    ).catch(() => null);
    if (!res || !res.ok) break;
    const data = (((await res.json()) as any)?.data as Array<{ path?: string; body?: string }>) || [];
    for (const d of data) {
      if (!isStub(String(d.body || ''))) set.add(withSlash(normaliseEsDocsPath(String(d.path || ''))));
    }
    if (data.length < 200) break;
    page++;
  }
  return set;
};

export async function GET() {
  // Static page routes are DERIVED from the files in src/pages rather than
  // hand-listed. A hand-maintained list silently drops any new page: the
  // report-a-scam pages sat outside the sitemap for a month that way, and
  // /search + /es/search were listed without their trailing slash, so both
  // entries were 301s. import.meta.glob is resolved at build time, so this
  // list can no longer drift from the routes that actually exist.
  //
  // Only pages that are deliberately not indexable belong in the exclude set.
  // If you add a noindex or gated page, add it here too.
  const SITEMAP_EXCLUDE = new Set([
    '/about/', // redirect stub -> /about-us/
    '/copilot/', // redirect stub -> /coagent/
    '/es/copiloto/', // redirect stub -> /es/coagent/
    '/film-test/', // redirect stub -> /what-we-do/
    '/360walkthrough/', // redirect stub -> /360-walkthrough/
    '/activate/',
    '/es/activar/', // noindex: dormant-agent activation
    '/agents-survey/',
    '/es/encuesta-agentes/',
    '/nl/agenten-enquete/', // noindex: roadmap survey
    '/your-setup/', // noindex: draft, pending review and its ES twin
    '/es/tu-configuracion/', // noindex: draft, pending review
  ]);

  const derivedStaticPaths = Object.keys(import.meta.glob('./**/*.astro'))
    .map((file) => {
      const r = file.replace(/^\./, '').replace(/\.astro$/, '').replace(/\/index$/, '');
      return `${r}/`;
    })
    .filter((r) => !r.includes('[')) // dynamic routes are enumerated from Directus below
    .filter((r) => !r.startsWith('/admin/'))
    .filter((r) => r !== '/404/')
    .filter((r) => !SITEMAP_EXCLUDE.has(r))
    .sort();

  const staticPaths = derivedStaticPaths;

  const urls: Array<{ loc: string; lastmod: string | null }> = [];
  const seen = new Set<string>();
  const altsByLoc = new Map<string, Alt[]>();

  const prefixRedirects = (await listPrefixRedirects().catch(() => []))
    .map((r) => ({ from: String(r?.from || ''), to: String(r?.to || '') }))
    .filter((r) => r.from && r.to)
    .sort((a, b) => b.from.length - a.from.length);
  const applyPrefixRedirect = (pRaw: string) => {
    const raw = String(pRaw || '');
    if (!raw.startsWith('/')) return raw;
    const u = raw.split('#');
    const beforeHash = u[0] || '';
    const hash = u.length > 1 ? `#${u.slice(1).join('#')}` : '';
    const q = beforeHash.split('?');
    const pathOnly = q[0] || '';
    const query = q.length > 1 ? `?${q.slice(1).join('?')}` : '';
    const pn = pathOnly.replace(/\/{2,}/g, '/');
    const withSlash = pn.endsWith('/') || /\/[^/]+\.[a-z0-9]{1,8}$/i.test(pn) ? pn : `${pn}/`;
    for (const r of prefixRedirects) {
      if (!withSlash.startsWith(r.from)) continue;
      const rest = withSlash.slice(r.from.length);
      const next = `${r.to}${rest}`;
      return `${next}${query}${hash}`;
    }
    return `${withSlash}${query}${hash}`;
  };

  const push = (path: string, lastmod: string | null, alternates?: Alt[]) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const loc = `${origin}${cleanPath}`;
    if (alternates && alternates.length && !altsByLoc.has(loc)) altsByLoc.set(loc, alternates);
    if (seen.has(loc)) return;
    seen.add(loc);
    urls.push({ loc, lastmod });
  };

  for (const p of staticPaths) push(p, null);

  // Legacy Directus comparison articles outside the enumerated prefixes. They
  // target the money query "best MLS CRM property portal in Spain", earn search
  // landings and convert, so they are listed explicitly with their pair.
  {
    const en = '/estate-agents/what-is-the-best-mls-crm-property-portal-in-spain/';
    const es = '/es/agentes-inmobiliarios/cual-es-el-mejor-portal-inmobiliario-mls-crm-en-espana/';
    const alts: Alt[] = [
      { hreflang: 'en', href: `${origin}${en}` },
      { hreflang: 'es', href: `${origin}${es}` },
      { hreflang: 'x-default', href: `${origin}${en}` },
    ];
    push(en, null, alts);
    push(es, null, alts);
  }


  try {
    const realEsSet = await fetchRealEsPaths();

    const addPrefix = async (prefix: string, lang: 'en' | 'es') => {
      const items = await listKbPagesByPrefix({ prefix, lang, limit: 500 });
      for (const it of items) {
        const lastmod = asLastMod(it.date_updated || it.date_created);
        const p0 = String(it.path || '');
        const p1 = lang === 'en' ? applyPrefixRedirect(p0) : normaliseEsDocsPath(p0);
        // ES paths must carry the trailing slash the site canonicalises to, or the
        // slashless Directus form is listed as a second URL that 301s.
        const p = lang === 'en' ? canonicalNeighbourhoodPath(p1) : withSlash(p1);
        if (lang === 'en') {
          const es = applyPrefixRedirect(applyStaticRedirectAliases(normaliseEsDocsPath(toSpanishPath(p))));
          if (realEsSet.has(withSlash(es))) {
            const alts: Alt[] = [
              { hreflang: 'en', href: `${origin}${p}` },
              { hreflang: 'es', href: `${origin}${es}` },
              { hreflang: 'x-default', href: `${origin}${p}` },
            ];
            push(p, lastmod, alts);
            push(es, lastmod, alts);
          } else {
            push(p, lastmod);
          }
        } else if (realEsSet.has(withSlash(p))) {
          push(p, lastmod);
        }
      }
    };

    await addPrefix('/docs/', 'en');
    await addPrefix('/general-information/', 'en');
    await addPrefix('/blog/', 'en');
    await addPrefix('/neighbourhood/', 'en');
    await addPrefix('/andalucia/', 'en');
    await addPrefix('/es/docs/', 'es');
    // Spanish blog + general-information have TRANSLATED slugs that toSpanishPath()
    // cannot derive from the EN twin, so they must be walked directly (dedupe is in push).
    await addPrefix('/es/blog/', 'es');
    await addPrefix('/es/informacion-general/', 'es');
  } catch {}

  const body = urls
    .sort((a, b) => a.loc.localeCompare(b.loc))
    .map((u) => buildUrlEntry(u.loc, u.lastmod, altsByLoc.get(u.loc)))
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
