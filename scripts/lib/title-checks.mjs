// title-checks.mjs - what a model-written search title must pass before ctr-experiments.mjs
// puts it live with nobody approving it (James, 24-09-26: "it should be based on facts and
// stats"). The page data picks the page and judges the result; the words come from a model,
// which once wrote Spanish titles on English pages for weeks and presented a repealed rent
// cap as current. So every set is checked, cheapest first:
//   1. length (search title up to 60 characters, description 70 to 160, title up to 110)
//   2. written in the page's language
//   3. no number that is not already in the page's visible text
//   4. the blog lint's hard rules, PropertyList wording rules and sensational framing
//   5. every statement backed by the page's own text (one model call)
//   6. the retired-laws list (one model call)
//   7. the PropertyList facts list (claims-check.mjs, one model call)
// The model calls only run when 1 to 4 pass. A check that cannot run counts as a fail.
// Check 5 keeps the wording to what the page says; it cannot catch a page that is itself
// wrong (24-09-26: the ITP docs page says inheritances and gifts pay ITP; they pay ISD).
import { shortTextProblems } from './blog-lint.mjs';
import { legalCurrencyBlock } from './legal-currency.mjs';
import { claimsCheck } from './claims-check.mjs';

const EN = /(?<![\p{L}\p{N}])(the|and|of|in|your|what|how|to|for|guide|with|is|do|does|can|spain|spanish|after|now|rules|tax|when|who|buy|buying|sell|rent)(?![\p{L}\p{N}])/giu;
const ES = /(?<![\p{L}\p{N}])(de|la|el|y|que|qué|como|cómo|en|para|del|los|las|guía|una|un|es|cuánto|cuanto|españa|tras|ahora|normas|impuesto|cuándo|quién|comprar|vender|alquiler)(?![\p{L}\p{N}])/giu;
const count = (re, s) => (String(s || '').match(re) || []).length;
export const textLang = (s) => { const e = count(EN, s), x = count(ES, s); return e > x ? 'en' : x > e ? 'es' : '?'; };

const NUM = /\d[\d.,]*\d|\d/g;
const digits = (t) => String(t).replace(/\D/g, '');
export const stripHtml = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Numbers compare by their digits, so 2,500 matches 2.500 and 2500; 8/2026 is 8 and 2026.
export function numbersNotOnPage(texts, pageText) {
  const onPage = new Set((String(pageText || '').match(NUM) || []).map(digits));
  const missing = [];
  for (const t of texts.join(' ').match(NUM) || []) if (!onPage.has(digits(t))) missing.push(t);
  return [...new Set(missing)];
}

export async function groundingCheck(texts, pageText, aiJson) {
  const out = await aiJson([{ role: 'user', content: `PAGE TEXT:
${String(pageText || '').slice(0, 12000)}

NEW SEARCH WORDING FOR THIS PAGE:
${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Check every factual statement in the new wording against the page text. A statement passes only if the page text says it; being plausible or generally true is not enough. A description of what the page covers ("how rent updates work now") is not a factual statement. Return JSON {"ok": true if every statement is supported, "unsupported": ["each unsupported statement, with what the page says instead if anything"]}` }]);
  const unsupported = Array.isArray(out && out.unsupported) ? out.unsupported.map(String).filter(Boolean) : [];
  return { ok: Boolean(out && out.ok === true && !unsupported.length), unsupported };
}

export async function retiredLawCheck(texts, aiJson) {
  const out = await aiJson([{ role: 'user', content: `${legalCurrencyBlock()}

These texts will be shown in Google results for a page about Spanish property:
${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Does any of them present a law listed above as no longer in force as if it were current, or state something that contradicts the CURRENT POSITION list? Laws the lists do not mention are outside this check. Return JSON {"ok": true or false, "why": "one sentence"}` }]);
  return { ok: out && out.ok === true, why: String((out && out.why) || '') };
}

// fields: { title?, seo_title?, seo_description? } (only the ones that would change)
// opts.lengths = false skips the length limits (an undo restores wording that predates them)
export async function checkTitleSet({ lang, fields, pageText, ledger, aiJson, lengths = true }) {
  const problems = [];
  const vals = Object.entries(fields).filter(([, v]) => String(v || '').trim());
  if (!vals.length) return { ok: false, problems: ['nothing to check'] };
  if (lengths) {
    if (fields.seo_title && fields.seo_title.length > 60) problems.push(`search title is ${fields.seo_title.length} characters, over 60`);
    if (fields.seo_description && (fields.seo_description.length > 160 || fields.seo_description.length < 70)) problems.push(`description is ${fields.seo_description.length} characters, outside 70 to 160`);
    if (fields.title && fields.title.length > 110) problems.push(`title is ${fields.title.length} characters, over 110`);
  }
  const all = vals.map(([, v]) => v).join('\n');
  const got = textLang(all);
  if (got !== lang) problems.push(`written in ${got === '?' ? 'an unclear language' : got === 'es' ? 'Spanish' : 'English'}, the page is ${lang === 'es' ? 'Spanish' : 'English'}`);
  const missing = numbersNotOnPage(vals.map(([, v]) => v), pageText);
  if (missing.length) problems.push(`numbers that are not on the page: ${missing.join(', ')}`);
  for (const [k, v] of vals) for (const p of shortTextProblems(v)) problems.push(`${k}: ${p}`);
  if (problems.length) return { ok: false, problems };

  const grounded = await groundingCheck(vals.map(([, v]) => v), pageText, aiJson).catch((e) => ({ ok: false, unsupported: [`the check could not run (${e.message})`] }));
  if (!grounded.ok) problems.push(`not on the page: ${grounded.unsupported.join('; ') || 'failed'}`);
  const law = await retiredLawCheck(vals.map(([, v]) => v), aiJson).catch((e) => ({ ok: false, why: `the check could not run (${e.message})` }));
  if (!law.ok) problems.push(`retired laws: ${law.why || 'failed'}`);
  const claims = await claimsCheck({ title: fields.seo_title || fields.title || '', body: vals.map(([, v]) => `<p>${v}</p>`).join(''), ledger });
  if (claims.error) problems.push(`facts list: the check could not run (${claims.error})`);
  else for (const i of claims.issues || []) problems.push(`facts list: ${i.verdict}: "${i.quote}"`);
  // the model's reasons reach James's email: plain hyphens only
  return { ok: problems.length === 0, problems: problems.map((p) => p.replace(/\s*[—–]\s*/g, ' - ')) };
}
