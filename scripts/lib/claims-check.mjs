// claims-check.mjs - checks what a blog draft says about PropertyList against the claims
// ledger (claims-ledger.mjs). One model call; the result goes in the approval email as
// warnings, it never blocks. Same model and credentials as the generator.
//
//   const r = await claimsCheck({ title, body, ledger });
//   r.issues = [{ quote, verdict: 'contradicts' | 'not_in_ledger', why, fix }], or r.error

const strip = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function claimsCheck({ title = '', body = '', ledger = '' } = {}) {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  const base = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
  if (!key) return { issues: [], error: 'no OPENAI_API_KEY, claims check skipped' };
  const text = strip(body).slice(0, 16000);
  const prompt = `You check a blog draft for statements about PropertyList itself (its prices, credits, what is free or paid, which features exist, how many agents, agencies or listings it has, how agencies are admitted, and any superlative about it).

LEDGER (the only facts that are true about PropertyList):
${ledger}

DRAFT TITLE: ${title}
DRAFT TEXT:
${text}

List every sentence in the draft that states something about PropertyList and is either contradicted by the ledger or not covered by it. Ignore statements about the property market, the law or other companies. Quote the draft exactly, at most 200 characters per quote. Return JSON only: {"issues":[{"quote":"...","verdict":"contradicts" or "not_in_ledger","why":"one short sentence","fix":"a corrected sentence, or remove"}]}. Return {"issues":[]} when there is nothing to report.`;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_completion_tokens: 6000 }),
      signal: AbortSignal.timeout(150000),
    });
    const raw = await res.text();
    if (!res.ok) return { issues: [], error: `claims check model call failed (${res.status})` };
    const content = JSON.parse(raw).choices?.[0]?.message?.content || '{}';
    const out = JSON.parse(content);
    const issues = (Array.isArray(out.issues) ? out.issues : [])
      .filter((i) => i && i.quote && (i.verdict === 'contradicts' || i.verdict === 'not_in_ledger'))
      .map((i) => ({ quote: String(i.quote).slice(0, 220), verdict: i.verdict, why: String(i.why || '').slice(0, 240), fix: String(i.fix || '').slice(0, 240) }))
      .slice(0, 12);
    return { issues };
  } catch (e) {
    return { issues: [], error: `claims check failed: ${String(e && e.message || e).slice(0, 120)}` };
  }
}
