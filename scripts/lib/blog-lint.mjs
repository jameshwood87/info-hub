// Publish gate for generated blog posts. Returns { ok, errors, warnings, regulatory }.
// Built after the 11-08-26 audit found live posts with unfilled template
// placeholders ("X month", "Y percent"), a repealed decree described as current
// law for three months, and headlines asserting national bans no source shows.
//
// HARD errors block publishing outright. WARNINGS go in the approval email so
// James sees them before he clicks approve. "regulatory" flags a post that
// touches law or policy: those always require approval, never auto-publish.

const stripHtml = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Quoted examples are not placeholders. The pool post (kb 1929, 20-09-26) warned that you
// cannot claim "a pool adds X percent" without comparables, the lint blocked it, and it
// was published through the admin button with no record. The placeholder rules below now
// skip text inside quotation marks, and match only a capital X, Y or Z: case-insensitive
// matching also caught Spanish "y" (and) before a euro amount. A straight quote opens only
// after a non-letter and closes only before one, so an inch mark (a 55" TV) or an apostrophe
// cannot hide the unquoted text that follows it.
const QUOTED = /(?<![\p{L}\p{N}])"[^"\n]{1,200}"(?![\p{L}\p{N}])|“[^”\n]{1,200}”|«[^»\n]{1,200}»|‘(?:[^’\n]|’(?=[\p{L}\p{N}])){1,200}’(?![\p{L}\p{N}])/gu;
const unquote = (s) => String(s || '').replace(QUOTED, ' ');

// text that must never reach a reader ({ unquoted: true } = checked with quoted spans removed)
const HARD_PATTERNS = [
  [/\b[XYZ] (?:[Mm]onths?|[Pp]ercent|[Pp]er cent|[Yy]ears?|[Dd]ays?|[Ww]eeks?|[Ee]uros?)\b|\b[XYZ] €(?!\s?\d)/, 'unfilled template placeholder (X month / Y percent)', { unquoted: true }],
  [/\b[Ee]xceeds [XYZ]\b/, 'unfilled template placeholder', { unquoted: true }],
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

// PropertyList wording the claims ledgers ban (scripts/lib/claims-ledger.mjs). Warnings,
// not errors: the approval email shows them and James decides.
const PL_WORDING = [
  [/\bfree forever\b|\bgratis para siempre\b|\bpara siempre gratis\b/i, 'says "free forever", which the ledger bans: say "free"'],
  [/\bverified (agents?|agenc(?:y|ies)|listings?|properties)\b|\bagentes verificados\b|\bagencias verificadas\b|\banuncios verificados\b|\binmuebles verificados\b/i, 'says "verified" about agents or listings: the ledger wording is "registered agents"'],
  [/\bunlimited (listings?|users?|team|seats?|staff|agents?|properties)\b|\b(anuncios|usuarios|agentes|inmuebles) ilimitad[oa]s\b/i, 'says "unlimited" listings or users: no ledger entry confirms it'],
  [/\b1 credit\s*(=|equals|is)\s*(€\s?1\b|1\s?(€|euros?)\b)|\b1 cr[eé]dito\s*(=|equivale a|es)\s*(€\s?1\b|1\s?(€|euros?)\b)/i, 'says "1 credit = 1 euro": one credit costs about 1 euro, EUR 0.80 to 1 plus IVA by pack'],
  [/\bSpain'?s first\b|\bthe only (platform|MLS|portal)\b|\bel (único|primer) (portal|MLS)\b|\bla única plataforma\b/i, 'superlative about PropertyList with no proof on file'],
  [/\b(PropertyList|our|nuestr[oa]s?)\b[^.]{0,60}\b(valuations?|tasaci[oó]n(?:es)?)\b/i, 'calls a PropertyList product a valuation or tasación, banned in Spain-facing copy'],
];

export function lintBlogPost({ title = '', body = '', bodyEs = '' } = {}) {
  const errors = [], warnings = [];
  const text = stripHtml(body), textEs = stripHtml(bodyEs), t = `${title} ${text}`;

  for (const [re, why, opts] of HARD_PATTERNS) {
    for (const [label, raw] of [['EN', `${title}\n${text}`], ['ES', textEs]]) {
      const s = opts && opts.unquoted ? unquote(raw) : raw;
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
  for (const [re, why] of PL_WORDING) {
    const m = `${title} ${text} ${textEs}`.match(re);
    if (m) warnings.push(`${why}: "${m[0]}"`);
  }
  if (text.length < 1500) warnings.push('very short body');

  return { ok: errors.length === 0, errors, warnings, regulatory };
}
