import { listKbPagesByPrefix } from '../lib/directus';
import { canonicalAreaPath } from '../lib/areaProvince';
import { listPrefixRedirects } from '../lib/kbRedirects';
import dePilot from '../data/de-pilot.json';

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
      if (!isStub(String(d.body || ''))) set.add(normaliseEsDocsPath(String(d.path || '')));
    }
    if (data.length < 200) break;
    page++;
  }
  return set;
};

export async function GET() {
  const staticPaths = [
    '/',
    '/about-us/',
    '/faq/',
    '/docs/',
    '/blog/',
    '/community/',
    '/developers/',
    '/neighbourhood/',
    '/laws/',
    '/pricing/',
    '/referrals/',
    '/whats-on/',
    '/whats-on/marbella/',
    '/whats-on/estepona/',
    '/whats-on/malaga/',
    '/search',
    '/website-builder/',
    '/features/',
    '/mobile-app/',
    '/request-new-features/',
    '/es/solicitar-funciones/',
    '/ai-property-search/',
    '/costa-del-sol/',
    '/launch/',
    '/free/',
    '/xml-feed-import/',
    '/what-is-my-property-worth/',
    '/es/gratis/',
    '/es/importar-feed-xml/',
    '/es/cuanto-vale-mi-propiedad/',
    '/es/lanza-tu-agencia/',
    '/es/costa-del-sol/',
    '/es/busqueda-ia/',
    '/instant-listing/',
    '/instant-renovation/',
    '/instant-content/',
    '/instant-brochure/',
    '/rentals/',
    '/pipelines/',
    '/nurture/',
    '/verify-your-agency/',
    '/report-a-problem/',
    '/es/',
    '/es/sobre-nosotros/',
    '/es/preguntas-frecuentes/',
    '/es/constructor-de-webs/',
    '/es/docs/',
    '/es/informacion-general/',
    '/es/comunidad/',
    '/es/barrios/',
    '/es/leyes/',
    '/es/precios/',
    '/es/referidos/',
    '/es/que-hacer/',
    '/es/que-hacer/marbella/',
    '/es/que-hacer/estepona/',
    '/es/que-hacer/malaga/',
    '/es/funciones/',
    '/es/app-movil/',
    '/es/listado-instantaneo/',
    '/es/renovacion-instantanea/',
    '/es/contenido-instantaneo/',
    '/es/folleto-instantaneo/',
    '/es/alquileres/',
    '/es/promotores/',
    '/es/pipelines/',
    '/es/nurture/',
    '/es/verifica-tu-agencia/',
    '/es/reportar-un-problema/',
    '/es/search',
  ];

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

  // German pilot pages (self-contained /de/ section)
  push('/de/', null, [
    { hreflang: 'de', href: `${origin}/de/` },
    { hreflang: 'en', href: `${origin}/` },
    { hreflang: 'es', href: `${origin}/es/` },
    { hreflang: 'x-default', href: `${origin}/` },
  ]);
  for (const [dePath, e] of Object.entries(dePilot as Record<string, { hreflang?: { en?: string; es?: string } }>)) {
    const alts: Alt[] = [{ hreflang: 'de', href: `${origin}${dePath}` }];
    if (e?.hreflang?.en) alts.push({ hreflang: 'en', href: `${origin}${e.hreflang.en}` });
    if (e?.hreflang?.es) alts.push({ hreflang: 'es', href: `${origin}${e.hreflang.es}` });
    if (e?.hreflang?.en) alts.push({ hreflang: 'x-default', href: `${origin}${e.hreflang.en}` });
    push(dePath, null, alts);
  }

  try {
    const realEsSet = await fetchRealEsPaths();

    const addPrefix = async (prefix: string, lang: 'en' | 'es') => {
      const items = await listKbPagesByPrefix({ prefix, lang, limit: 500 });
      for (const it of items) {
        const lastmod = asLastMod(it.date_updated || it.date_created);
        const p0 = String(it.path || '');
        const p1 = lang === 'en' ? applyPrefixRedirect(p0) : normaliseEsDocsPath(p0);
        const p = lang === 'en' ? canonicalNeighbourhoodPath(p1) : p1;
        if (lang === 'en') {
          const es = applyPrefixRedirect(applyStaticRedirectAliases(normaliseEsDocsPath(toSpanishPath(p))));
          if (realEsSet.has(es)) {
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
        } else if (realEsSet.has(p)) {
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
  } catch {}

  const body = urls
    .sort((a, b) => a.loc.localeCompare(b.loc))
    .map((u) => buildUrlEntry(u.loc, u.lastmod, altsByLoc.get(u.loc)))
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
