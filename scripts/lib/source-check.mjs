// source-check.mjs - opens every outside source a blog draft links to and checks that the
// figures written next to each link appear on that page (the fact-check idea from the
// claude-blog skill suite). Also lists figures that sit in a paragraph with no link and no
// named data source. Warnings only: the approval email shows them, James decides.
//
//   const r = await sourceCheck(html);
//   r.links   = [{ url, host, result: 'ok'|'broken'|'blocked'|'unreachable'|'pdf'|'not_checked', http, figures: [{ figure, found }] }]
//   r.uncited = ['...figure in its sentence...']

const OWN_HOST = /(^|\.)propertylist\.es$|(^|\.)estate-agency\.co$/i;
const NO_CONTENT_CHECK = /(^|\.)(google\.[a-z.]+|goo\.gl|pexels\.com|unsplash\.com|youtube\.com|youtu\.be|wa\.me|whatsapp\.com|facebook\.com|instagram\.com|linkedin\.com)$/i;
// a paragraph that names its source counts as sourced, link or not
const ATTRIBUTED = /PropertyList|Price Oracle|\bOracle\b|\bMLS\b|notar|registro notarial|nuestros datos|our data|our listings|nuestros anuncios|\bBOE\b|\bBOJA\b|\bINE\b|Eurostat|Banco de Espa[ñn]a|Bank of Spain|Registradores|Catastro|Agencia Tributaria|Hacienda|Ministerio|Ministry|Junta de Andaluc|\bIRAV\b|Tribunal Supremo|Supreme Court|Constitutional Court|Tribunal Constitucional|Congress|Congreso/i;
const FIGURE = /(?:€|EUR)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s?(?:€|EUR\b|euros?\b)|\b\d{1,3}(?:[.,]\d{1,2})?\s?%|\b\d{1,3}(?:[.,]\d{3})+\b/gi;

const decode = (s) => String(s || '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/&#8364;/g, '€');
const strip = (h) => decode(String(h || '').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the number inside a figure, written the ways a source page might write it
function variants(figure) {
  const core = (String(figure).match(/\d[\d.,]*\d|\d/) || [''])[0];
  if (!core) return [];
  const out = new Set([core]);
  if (/^\d{1,3}([.,]\d{3})+$/.test(core)) {
    out.add(core.replace(/[.,]/g, ''));
    out.add(core.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.')));
  } else if (/^\d+[.,]\d{1,2}$/.test(core)) {
    out.add(core.replace('.', ',')).add(core.replace(',', '.'));
  }
  return [...out];
}

const found = (pageText, figure) => variants(figure).some((v) => new RegExp(`(?<![\\d.,])${esc(v)}(?![\\d])`).test(pageText));

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropertyListSourceCheck/1.0; +https://info.propertylist.es/)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(15000),
    });
    const type = String(res.headers.get('content-type') || '');
    if (res.status === 401 || res.status === 403 || res.status === 429) return { result: 'blocked', http: res.status };
    if (res.status >= 400) return { result: 'broken', http: res.status };
    if (/pdf/i.test(type) || /\.pdf($|\?)/i.test(url)) return { result: 'pdf', http: res.status };
    const buf = await res.arrayBuffer();
    return { result: 'ok', http: res.status, text: strip(new TextDecoder('utf-8').decode(buf.slice(0, 3_000_000))) };
  } catch (e) {
    return { result: 'unreachable', http: 0 };
  }
}

export async function sourceCheck(html, { maxLinks = 15 } = {}) {
  const blocks = [...String(html || '').matchAll(/<(p|li|td|th|h[2-4]|figcaption|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), html: m[2] }));
  const byUrl = new Map(); // url -> { url, host, figures:Set }
  const uncited = [];
  for (const b of blocks) {
    const text = strip(b.html);
    const figures = [...new Set(text.match(FIGURE) || [])].map((f) => f.trim());
    const links = [...b.html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"#]+)[^"]*"/gi)].map((m) => decode(m[1]));
    const outside = links.filter((u) => { try { return !OWN_HOST.test(new URL(u).hostname); } catch { return false; } });
    for (const u of outside) {
      const host = new URL(u).hostname.replace(/^www\./, '');
      if (!byUrl.has(u)) byUrl.set(u, { url: u, host, figures: new Set() });
      for (const f of figures) byUrl.get(u).figures.add(f);
    }
    if ((b.tag === 'p' || b.tag === 'li') && figures.length && !outside.length && !links.length && !ATTRIBUTED.test(text)) {
      const f = figures[0];
      const i = text.indexOf(f);
      uncited.push(`...${text.slice(Math.max(0, i - 90), i + f.length + 60).trim()}...`);
    }
  }
  const out = [];
  for (const item of [...byUrl.values()].slice(0, maxLinks)) {
    let host;
    try { host = new URL(item.url).hostname; } catch { host = item.host; }
    if (NO_CONTENT_CHECK.test(host)) { out.push({ url: item.url, host: item.host, result: 'not_checked', http: 0, figures: [] }); continue; }
    const page = await fetchText(item.url);
    const figures = page.result === 'ok' ? [...item.figures].slice(0, 8).map((figure) => ({ figure, found: found(page.text, figure) })) : [...item.figures].slice(0, 8).map((figure) => ({ figure, found: null }));
    out.push({ url: item.url, host: item.host, result: page.result, http: page.http, figures });
  }
  return { links: out, uncited: uncited.slice(0, 6), totalLinks: byUrl.size };
}
