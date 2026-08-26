// Publish gate for generated blog posts. Returns { ok, errors, warnings, regulatory }.
// Built after the 11-08-26 audit found live posts with unfilled template
// placeholders ("X month", "Y percent"), a repealed decree described as current
// law for three months, and headlines asserting national bans no source shows.
//
// HARD errors block publishing outright. WARNINGS go in the approval email so
// James sees them before he clicks approve. "regulatory" flags a post that
// touches law or policy: those always require approval, never auto-publish.

const stripHtml = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// text that must never reach a reader
const HARD_PATTERNS = [
  [/\b[XYZ] (month|months|percent|per cent|year|years|days?|weeks?|euros?|€)\b/i, 'unfilled template placeholder (X month / Y percent)'],
  [/\bexceeds [XYZ]\b/i, 'unfilled template placeholder'],
  [/\[(TODO|TBD|INSERT|CITATION NEEDED|PLACEHOLDER)[^\]]*\]/i, 'editorial placeholder left in text'],
  // case-sensitive on purpose: 'todo' is an ordinary Spanish word, and the
  // insensitive version blocked any Spanish body containing it (26-08-26)
  [/\bTODO\b|\bTBD\b|\bLOREM IPSUM\b/, 'TODO/TBD/lorem left in text'],
  [/-\s*-\s*(corrected|corregido):/i, 'model self-correction artifact left in text'],
  [/\{\{[^}]+\}\}/, 'unrendered template variable {{...}}'],
  [/�/, 'invalid UTF-8 replacement character'],
  [/[—–]/, 'em/en dash (house rule: plain hyphens only)'],
];

// law and policy signals -> "regulatory" (approval required)
const REG_PATTERNS = [
  /\b(decree|decreto|real decreto|RDL|RD \d|ley|law\b|regulation|reglamento|BOE|BOJA|BOP\b|tribunal|court|sentencia|ruling|fine|fines|multa|sanction|penalt|tax\b|IRPF|IVA|VAT|IBI|ITP|plusval|licen[cs]e|licencia|registro|registration|moratorium|moratoria|ban\b|prohib|zona tensionada|stressed (market )?zone|housing (law|decree|act)|ley de vivienda|LAU|LPH|congress|congreso|parliament|ministry|ministerio|junta de andaluc)/i,
];

// legal claims should cite an instrument or primary source somewhere
const INSTRUMENT_ID = /\b(Ley|Law|Real Decreto(-ley)?|RDL|RD|Decreto|Reglamento|Regulation|Directive|Directiva|STS|Sentencia|Orden)\s*(\(EU\)\s*)?\d{1,4}\/\d{2,4}\b/i;
const PRIMARY_HOST = /(boe\.es|juntadeandalucia\.es|ine\.es|eur-lex\.europa\.eu|europa\.eu|agenciatributaria|hacienda\.gob|mivau\.gob|transportes\.gob|lamoncloa\.gob|poderjudicial\.es|congreso\.es|malaga\.eu|marbella\.es)/i;

// sensational framing that needs a named source in the body
const SENSATIONAL = /\b(breaking|urgent|shock|bombshell|will (lose|ban|end|abolish)|to be banned|is banned|now illegal)\b/i;

export function lintBlogPost({ title = '', body = '', bodyEs = '' } = {}) {
  const errors = [], warnings = [];
  const text = stripHtml(body), textEs = stripHtml(bodyEs), t = `${title} ${text}`;

  for (const [re, why] of HARD_PATTERNS) {
    for (const [label, s] of [['EN', `${title}\n${text}`], ['ES', textEs]]) {
      if (s && re.test(s)) errors.push(`${label}: ${why}: "${(s.match(re) || [''])[0]}"`);
    }
  }
  // empty link text like <a ...>()</a> or "(Estepona)"-only anchors
  if (/<a [^>]*>\s*\(\s*\)\s*<\/a>/i.test(body)) errors.push('EN: anchor with empty parentheses as its text');
  if (/<a [^>]*>\s*\([^)]{2,30}\)\s*<\/a>/i.test(body)) warnings.push('EN: anchor whose only text is a bracketed word, reads as a broken placeholder');

  const regulatory = REG_PATTERNS.some((re) => re.test(t));
  if (regulatory) {
    if (!INSTRUMENT_ID.test(t)) warnings.push('regulatory post cites NO legal instrument by number (e.g. Ley 12/2023, RD 1312/2024, STS 620/2026)');
    if (!PRIMARY_HOST.test(body)) warnings.push('regulatory post links NO primary source (boe.es, BOJA, ine.es, eur-lex, ministry)');
    if (/\b(has been mandatory since|is now in force|is in force|entra en vigor|está en vigor|ya está en vigor)\b/i.test(t)) warnings.push('present-tense "in force" claim: confirm it has not been repealed or annulled (RDL 8/2026 and RD 1312/2024 NRU both were)');
    if (/\b(draft|proposed|plans to|planea|proyecto de|borrador|anteproyecto)\b/i.test(t) && /\b(must|obliga|required|deberá|have to)\b/i.test(t)) warnings.push('mixes a proposal/draft with obligation language: make sure readers cannot mistake a proposal for law');
  }
  if (SENSATIONAL.test(title)) {
    warnings.push(`sensational headline ("${(title.match(SENSATIONAL) || [''])[0]}"): the body must name the source, date and instrument or the headline is a claim we cannot back`);
  }
  // unsourced big statistics in the title
  const bigNum = title.match(/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/);
  if (bigNum && !PRIMARY_HOST.test(body)) warnings.push(`headline statistic "${bigNum[0]}" with no primary source linked in the body: attribute it (who measured, when, from what base)`);
  // AI tells the audit named
  const triads = (text.match(/\b(three|tres) (main |key |practical |)?(things|steps|reasons|dynamics|consequences|checks|routes)\b/gi) || []).length;
  if (triads >= 3) warnings.push(`${triads} "three X" triad constructions: reads as machine-written`);
  if (/\b(in conclusion|it is important to note|let'?s dive in|in today'?s fast-paced|navigate the complexities|unlock|game-changer)\b/i.test(text)) warnings.push('stock AI phrasing found (in conclusion / it is important to note / dive in / navigate the complexities)');
  if (/\bsome jurisdictions\b/i.test(text)) warnings.push('"some jurisdictions" in a single-jurisdiction article');
  if (text.length < 1500) warnings.push('very short body');

  return { ok: errors.length === 0, errors, warnings, regulatory };
}
