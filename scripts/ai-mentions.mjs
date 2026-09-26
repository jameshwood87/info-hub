#!/usr/bin/env node
// ai-mentions.mjs - weekly AI mention checker (GEO).
//
// Asks ChatGPT, Claude, Gemini and Perplexity a fixed question set through
// OpenRouter, with each vendor's own web search, and records who each answer
// names and links. Answers about PropertyList are checked against the claims
// ledger, answers on legal topics against the legal-currency list, and a
// summary is emailed the same way as the page-2 audit.
// Plan approved by James 25-09-26 (Documents/Claude Code/PropertyList/
// ai-mention-checker-plan-25-09-26.md). Questions: scripts/ai-mentions-questions.json.
//
//   node scripts/ai-mentions.mjs --dry-run     task list and cost estimate, no calls
//   node scripts/ai-mentions.mjs --pilot       1 run, cheaper and flagship models side by side
//   node scripts/ai-mentions.mjs --email       the weekly run: 3 runs, cheaper models
//   options: --runs N  --tier cheap|flagship|both  --only q01,q33  --assistants chatgpt,claude
//            --no-judge  --label name  --concurrency N  --reserve USD (overrides AI_MENTIONS_RESERVE)
//
// Spend guards (both checked before every call):
//   AI_MENTIONS_RESERVE      stop before the OpenRouter balance drops under this (default 10 USD),
//                            so the blog and the other crons on the same account keep running
//   AI_MENTIONS_MONTHLY_CAP  stop once this checker has spent this much in the month (default 100 USD)
// AI_MENTIONS_API_KEY is used if set (a dedicated OpenRouter key), otherwise OPENAI_API_KEY.
// Gemini goes to Google directly (AI_MENTIONS_GEMINI_KEY, an AI Studio key): through
// OpenRouter Gemini silently answers without searching (tested 26-09-26). No key, no Gemini.

import fs from 'node:fs';
import path from 'node:path';
import { claimsLedgerBlock, liveCounts } from './lib/claims-ledger.mjs';
import { legalCurrencyBlock } from './lib/legal-currency.mjs';

const ROOT = '/opt/info-hub';
const ENV = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (ENV.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const OUT = path.join(ROOT, 'var/ai-mentions');
const QFILE = path.join(ROOT, 'scripts/ai-mentions-questions.json');
const BASE = 'https://openrouter.ai/api/v1'; // plugins and web_search_options are OpenRouter features
const KEY = cfg('AI_MENTIONS_API_KEY') || cfg('OPENAI_API_KEY');
const GEMINI_KEY = cfg('AI_MENTIONS_GEMINI_KEY');
// Google's published Gemini Flash prices (checked 25-09-26). The search fee is counted
// even inside Google's free monthly allowance, so the spend guard errs high.
const GEMINI_PRICE = { in: 0.75e-6, out: 3.75e-6, search: 0.014 };

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PILOT = flag('pilot');
const DRY = flag('dry-run');
const SEND_EMAIL = flag('email');
const JUDGE = !flag('no-judge');
const RUNS = Math.max(1, Number(opt('runs', PILOT ? 1 : 3)) || 1);
const TIER = opt('tier', PILOT ? 'both' : 'cheap');
const ONLY = opt('only', '') ? new Set(opt('only').split(',')) : null;
const ONLY_A = opt('assistants', '') ? new Set(opt('assistants').split(',')) : null;
const LABEL = (opt('label', PILOT ? 'pilot' : 'weekly') || 'weekly').replace(/[^a-z0-9-]/gi, '');
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 5)) || 5);
const RESERVE = Number(opt('reserve', '') || cfg('AI_MENTIONS_RESERVE') || 10);
const MONTHLY_CAP = Number(cfg('AI_MENTIONS_MONTHLY_CAP') || 100);

// Cheaper tier runs every week. Flagship models run in the pilot only, to check
// the cheaper ones cite the same sites. Models checked on OpenRouter 25-09-26.
const ASSISTANTS = [
  { key: 'chatgpt', name: 'ChatGPT', cheap: 'openai/gpt-5.6-luna', flagship: 'openai/gpt-5.6-sol' },
  { key: 'claude', name: 'Claude', cheap: 'anthropic/claude-haiku-4.5', flagship: 'anthropic/claude-sonnet-5' },
  { key: 'gemini', name: 'Gemini', cheap: 'direct:gemini-3.8-flash', flagship: null },
  { key: 'perplexity', name: 'Perplexity', cheap: 'perplexity/sonar', flagship: null },
];
const JUDGE_MODEL = 'google/gemini-3.8-flash';
// Per-answer cost estimate for --dry-run only, light and heavy case from the plan
// (1 search and 5k tokens read, or 2 searches and 40k read). Real runs use usage.cost.
const EST = {
  'openai/gpt-5.6-luna': [0.0123, 0.0293], 'openai/gpt-5.6-sol': [0.031, 0.111],
  'anthropic/claude-haiku-4.5': [0.0205, 0.0655], 'anthropic/claude-sonnet-5': [0.031, 0.111],
  'direct:gemini-3.8-flash': [0.0219, 0.0621], 'perplexity/sonar': [0.0073, 0.0103], judge: [0.002, 0.004],
};
const COUNTRY = { ES: 'Spain', DE: 'Germany', FR: 'France', SE: 'Sweden', PT: 'Portugal' };
const GROUPS = { A: 'Agents choosing tools', B: 'Buyers looking for property', C: 'Topics the hub covers', D: 'About PropertyList' };
const LANGS = { en: 'English', es: 'Spanish', de: 'German', fr: 'French', sv: 'Swedish', pt: 'Portuguese' };

// ---------------------------------------------------------------- detection
// Case matters: Apple's "property list" (plist) format is a common false match.
// "Property List" as two words only counts in a property context in the same sentence.
const NAMED_US = [
  /\bPropertyList\b/, /\bPropertylist\b/, /\bproperty ?list\.es\b/i,
  /\bProperty List\b(?=[^.\n]{0,100}(Spain|Espa|estate|inmobili|agenc|agent|MLS|portal|Immobil))/,
];
const isOurs = (h) => h === 'propertylist.es' || h.endsWith('.propertylist.es');
const isMicrosite = (h) => h.endsWith('.estate-agency.co');
const COMPETITORS = [
  ['Idealista', /\bidealista\b/i], ['Fotocasa', /\bfotocasa\b/i], ['Habitaclia', /\bhabitaclia\b/i],
  ['pisos.com', /\bpisos\.com\b/i], ['Yaencontre', /\byaencontre\b/i], ['Milanuncios', /\bmilanuncios\b/i],
  ['Kyero', /\bkyero\b/i], ['thinkSPAIN', /\bthink ?spain\b/i], ['Rightmove', /\brightmove\b/i],
  ['A Place in the Sun', /\ba place in the sun\b/i], ['Green-Acres', /\bgreen-?acres\b/i],
  ['Spainhouses', /\bspainhouses\b/i], ['Properstar', /\bproperstar\b/i],
  ['ImmoScout24', /\bimmo ?scout ?24\b|\bimmobilienscout/i], ['Immowelt', /\bimmowelt\b/i],
  ['SeLoger', /\bseloger\b/i], ['Imovirtual', /\bimovirtual\b/i], ['Casa Sapo', /\bcasa\.sapo\b|\bsapo casa\b/i],
  ['Hemnet', /\bhemnet\b/i], ['Resales Online', /\bresales[- ]online\b/i], ['Inmovilla', /\binmovilla\b/i],
  ['Witei', /\bwitei\b/i], ['Sooprema', /\bsooprema\b/i],
];

const host = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const cleanUrl = (u) => String(u || '').trim().replace(/[.,;:!?)\]]+$/, '');
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const ddmmyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
const iso = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ---------------------------------------------------------------- tasks
const questions = readJson(QFILE, { questions: [] }).questions.filter((q) => !ONLY || ONLY.has(q.id));
const tiers = TIER === 'both' ? ['cheap', 'flagship'] : [TIER];
const skipped = [];
const active = ASSISTANTS.filter((a) => {
  if (ONLY_A && !ONLY_A.has(a.key)) return false;
  if (a.cheap.startsWith('direct:gemini') && !GEMINI_KEY) { skipped.push(`${a.name} skipped: no AI_MENTIONS_GEMINI_KEY (through OpenRouter it answers without searching)`); return false; }
  return true;
});
const tasks = [];
for (let run = 1; run <= RUNS; run++) {
  for (const q of questions) {
    for (const a of active) {
      for (const tier of tiers) {
        const model = a[tier];
        if (model) tasks.push({ q, a, tier, model, run });
      }
    }
  }
}
if (!questions.length || !tasks.length) { console.error('ai-mentions: nothing to do (check --only / --assistants)'); process.exit(1); }

const judgeable = (t) => JUDGE && (t.q.group === 'C' || t.q.group === 'D');
const estimate = () => {
  const lo = tasks.reduce((s, t) => s + (EST[t.model]?.[0] ?? 0.03) + (judgeable(t) ? EST.judge[0] : 0), 0);
  const hi = tasks.reduce((s, t) => s + (EST[t.model]?.[1] ?? 0.1) + (judgeable(t) ? EST.judge[1] : 0), 0);
  return [lo, hi];
};

if (DRY) {
  const byModel = {};
  for (const t of tasks) byModel[t.model] = (byModel[t.model] || 0) + 1;
  const [lo, hi] = estimate();
  console.log(`ai-mentions dry run: ${questions.length} questions x ${RUNS} run(s), tier ${TIER}, ${tasks.length} answers, judge ${JUDGE ? 'on' : 'off'}`);
  for (const s of skipped) console.log(`  ${s}`);
  if (!cfg('AI_MENTIONS_API_KEY')) console.log('  no AI_MENTIONS_API_KEY: using the blog\'s OpenRouter key (OPENAI_API_KEY)');
  for (const [m, n] of Object.entries(byModel)) console.log(`  ${m}: ${n}`);
  console.log(`  estimated cost ${usd(lo)} to ${usd(hi)}; reserve ${usd(RESERVE)}, monthly cap ${usd(MONTHLY_CAP)}`);
  process.exit(0);
}
if (!KEY || !KEY.startsWith('sk-or-')) { console.error('ai-mentions: no OpenRouter key (AI_MENTIONS_API_KEY or OPENAI_API_KEY must be an sk-or- key)'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- spend guard
const now = new Date();
const MONTH = iso(now).slice(0, 7);
const SPEND_FILE = path.join(OUT, 'spend.json');
const spendLog = readJson(SPEND_FILE, {});
const monthBefore = Number(spendLog[MONTH] || 0);
let spent = 0; // everything this run, for the monthly cap
let spentOR = 0; // the OpenRouter part, for the balance reserve
let reserved = 0; // heavy-case estimates for calls in flight, released when each call settles
let reservedOR = 0;
let stopReason = null;
let balance = null;
let lastBalanceCheck = 0;
let refreshing = null;

async function fetchBalance() {
  try {
    const r = await fetch(`${BASE}/credits`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const b = Number(j?.data?.total_credits) - Number(j?.data?.total_usage);
    return Number.isFinite(b) ? b : null;
  } catch { return null; }
}
// One balance read at a time, even with several workers asking.
function refreshBalance() {
  if (!refreshing) {
    refreshing = fetchBalance().then((b) => { balance = b; lastBalanceCheck = spentOR; }).finally(() => { refreshing = null; });
  }
  return refreshing;
}
// Reserve the heavy-case cost before a call and settle the real cost after, so
// concurrent workers can never pass the cap or the reserve on the same totals.
async function guard(next, viaOpenRouter = true) {
  // Re-read the balance every 2 USD, since the blog and other crons spend from it too.
  if (viaOpenRouter && (balance === null || spentOR - lastBalanceCheck > 2)) await refreshBalance();
  // From here to the reservation there is no await, so no other worker can interleave.
  if (stopReason) return false;
  if (monthBefore + spent + reserved + next > MONTHLY_CAP) { stopReason = `monthly cap reached (${usd(monthBefore + spent)} of ${usd(MONTHLY_CAP)} this month)`; return false; }
  if (viaOpenRouter) {
    if (balance === null) { stopReason = 'could not read the OpenRouter balance'; return false; }
    const left = balance - (spentOR - lastBalanceCheck) - reservedOR;
    if (left - next < RESERVE) { stopReason = `OpenRouter balance too low (${usd(left)} left, ${usd(RESERVE)} kept back for the blog and other crons)`; return false; }
    reservedOR += next;
  }
  reserved += next;
  return true;
}
function settle(next, actual, viaOpenRouter = true) {
  reserved -= next; spent += actual;
  if (viaOpenRouter) { reservedOR -= next; spentOR += actual; }
}
const saveSpend = () => { spendLog[MONTH] = Math.round((monthBefore + spent) * 10000) / 10000; fs.writeFileSync(SPEND_FILE, JSON.stringify(spendLog, null, 2)); };
// A killed run still records what it spent (calls in flight count at their heavy estimate).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { spent += reserved; saveSpend(); console.log(`ai-mentions: ${sig}, spend saved (${usd(spent)} this run)`); process.exit(143); });
}

// ---------------------------------------------------------------- API
async function call(body) {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://info.propertylist.es', 'X-Title': 'PropertyList AI mention checker' },
        body: JSON.stringify({ ...body, usage: { include: true } }),
        signal: AbortSignal.timeout(180000),
      });
      const txt = await res.text();
      let j = null;
      try { j = JSON.parse(txt); } catch { /* handled below */ }
      if (res.ok && j && !j.error) {
        const cost = Number(j.usage?.cost);
        return { ok: true, j, ms: Date.now() - t0, cost: Number.isFinite(cost) ? cost : null };
      }
      last = `HTTP ${res.status} ${(j?.error?.message || txt).slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) return { ok: false, error: last, ms: Date.now() - t0, cost: 0 };
    } catch (e) {
      last = String(e?.message || e).slice(0, 300);
    }
    await sleep(3000 * attempt * attempt);
  }
  return { ok: false, error: last, cost: 0 };
}

function extract(j) {
  const msg = j.choices?.[0]?.message || {};
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p?.text || '').join('') : '';
  const cited = new Set();
  for (const a of msg.annotations || []) { const u = a?.url_citation?.url || a?.url; if (u) cited.add(cleanUrl(u)); }
  for (const c of j.citations || []) { const u = typeof c === 'string' ? c : c?.url; if (u) cited.add(cleanUrl(u)); }
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'<]+/g)) cited.add(cleanUrl(m[0]));
  const searched = (j.search_results || []).map((s) => cleanUrl(s?.url)).filter(Boolean);
  return { text, cited: [...cited].filter((u) => host(u)), searched };
}

async function askOpenRouter(t) {
  const body = {
    model: t.model,
    messages: [
      { role: 'system', content: `The user is in ${COUNTRY[t.q.country] || 'Spain'}.` },
      { role: 'user', content: t.q.text },
    ],
    max_tokens: 4000,
    web_search_options: { search_context_size: 'low', user_location: { type: 'approximate', approximate: { country: t.q.country } } },
  };
  if (!t.model.startsWith('perplexity/')) body.plugins = [{ id: 'web', engine: 'native' }];
  const r = await call(body);
  if (!r.ok) return { ok: false, error: r.error, ms: r.ms ?? null };
  const { text, cited, searched } = extract(r.j);
  return {
    ok: true, text, cited, searched, ms: r.ms,
    // No cost in the reply: count the heavy estimate so the spend guard stays honest.
    cost: r.cost ?? (EST[t.model]?.[1] ?? 0.1), costKnown: r.cost !== null,
    usage: { prompt: r.j.usage?.prompt_tokens ?? null, completion: r.j.usage?.completion_tokens ?? null },
  };
}

// Gemini grounding returns vertexaisearch redirect links; follow one hop to the real
// page, falling back to the chunk title (usually the site's domain).
async function resolveGrounding(w) {
  if (!w?.uri) return null;
  if (!/vertexaisearch\.cloud\.google\.com/.test(w.uri)) return cleanUrl(w.uri);
  try {
    const r = await fetch(w.uri, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const loc = r.headers.get('location');
    if (loc && host(loc)) return cleanUrl(loc);
  } catch { /* fall through */ }
  return w.title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(w.title.trim()) ? `https://${w.title.trim()}/` : null;
}

async function askGemini(t) {
  const model = t.model.slice('direct:'.length);
  const body = {
    systemInstruction: { parts: [{ text: `The user is in ${COUNTRY[t.q.country] || 'Spain'}.` }] },
    contents: [{ role: 'user', parts: [{ text: t.q.text }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 4000 },
  };
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.candidates?.length) {
        const cand = j.candidates[0];
        const text = (cand.content?.parts || []).map((p) => p?.text || '').join('');
        const gm = cand.groundingMetadata || {};
        const urls = await Promise.all((gm.groundingChunks || []).map((c) => resolveGrounding(c.web)));
        const cited = new Set(urls.filter((u) => u && host(u)));
        for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'<]+/g)) if (host(m[0])) cited.add(cleanUrl(m[0]));
        const u = j.usageMetadata || {};
        const searches = (gm.webSearchQueries || []).length;
        const cost = (u.promptTokenCount || 0) * GEMINI_PRICE.in + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * GEMINI_PRICE.out + (searches ? GEMINI_PRICE.search : 0);
        return { ok: true, text, cited: [...cited], searched: gm.webSearchQueries || [], ms: Date.now() - t0, cost, costKnown: false, usage: { prompt: u.promptTokenCount ?? null, completion: u.candidatesTokenCount ?? null } };
      }
      last = `HTTP ${res.status} ${JSON.stringify(j?.error || j || {}).slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) return { ok: false, error: last, ms: Date.now() - t0 };
    } catch (e) {
      last = String(e?.message || e).slice(0, 300);
    }
    await sleep(3000 * attempt * attempt);
  }
  return { ok: false, error: last, ms: null };
}

async function ask(t) {
  const { q } = t;
  const r = t.model.startsWith('direct:') ? await askGemini(t) : await askOpenRouter(t);
  const base = { id: q.id, group: q.group, lang: q.lang, market: q.market, country: q.country, assistant: t.a.key, tier: t.tier, model: t.model, run: t.run, ms: r.ms ?? null };
  if (!r.ok) return { ...base, ok: false, error: r.error, cost: 0 };
  const { text, cited, searched } = r;
  const domains = [...new Set(cited.map(host).filter(Boolean))];
  const ourUrls = cited.filter((u) => isOurs(host(u)));
  const flags = []; // filled by the judge (groups C and D)
  return {
    ...base, ok: true, text,
    named: NAMED_US.some((re) => re.test(text)),
    linked: ourUrls.length > 0,
    ourUrls,
    microsite: domains.some(isMicrosite),
    cited, domains, searched,
    usedWeb: cited.length > 0,
    competitors: COMPETITORS.filter(([, re]) => re.test(text)).map(([n]) => n),
    cost: r.cost, costKnown: r.costKnown, usage: r.usage,
    flags,
  };
}

async function judge(ans, facts) {
  const body = {
    model: JUDGE_MODEL, temperature: 0, max_tokens: 800, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You audit an AI assistant\'s answer against a fact sheet. List only statements in the answer that contradict the fact sheet, or that present a law the fact sheet lists as no longer in force as if it were current law. Ignore anything the fact sheet does not cover and ignore omissions. Reply with JSON only: {"issues":[{"quote":"exact words from the answer, under 25 words","why":"one plain sentence"}]}. Reply {"issues":[]} when there is nothing to report.' },
      { role: 'user', content: `FACT SHEET\n${facts}\n\nANSWER TO AUDIT\n${ans.text.slice(0, 12000)}` },
    ],
  };
  const r = await call(body);
  if (!r.ok) return { cost: r.cost || 0, issues: null, error: r.error };
  const raw = r.j.choices?.[0]?.message?.content || '';
  let issues = null;
  try { issues = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).issues; } catch { /* unparseable */ }
  return { cost: r.cost ?? EST.judge[1], issues: Array.isArray(issues) ? issues.filter((i) => i?.quote) : null, error: Array.isArray(issues) ? null : 'judge reply not JSON' };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !stopReason) { const it = items[i++]; await fn(it); }
  }));
}

// ---------------------------------------------------------------- run
const [estLo, estHi] = estimate();
console.log(`ai-mentions: ${LABEL}, ${tasks.length} answers (${questions.length} q x ${RUNS} run(s), tier ${TIER}), estimate ${usd(estLo)}-${usd(estHi)}`);
const answers = [];
let judgeCost = 0;
let judgeErrors = 0;
const perCall = (m) => EST[m]?.[1] ?? 0.1;

try {
  await pool(tasks, CONCURRENCY, async (t) => {
    const viaOR = !t.model.startsWith('direct:');
    const next = perCall(t.model);
    if (!(await guard(next, viaOR))) return;
    const ans = await ask(t);
    settle(next, ans.cost || 0, viaOR);
    answers.push(ans);
    if (answers.length % 25 === 0) console.log(`ai-mentions: ${answers.length}/${tasks.length} answers, ${usd(spent)} spent`);
  });

  if (JUDGE && !stopReason) {
    const counts = await liveCounts();
    const ledger = claimsLedgerBlock(counts);
    const legal = legalCurrencyBlock();
    const toJudge = answers.filter((a) => a.ok && (a.group === 'C' || (a.group === 'D' && (a.named || a.linked))));
    await pool(toJudge, CONCURRENCY, async (a) => {
      if (!(await guard(EST.judge[1]))) return;
      const facts = a.group === 'D' ? `${ledger}\n\n${legal}` : legal;
      const r = await judge(a, facts);
      settle(EST.judge[1], r.cost); judgeCost += r.cost;
      if (r.issues === null) { judgeErrors++; return; }
      for (const i of r.issues) a.flags.push({ kind: a.group === 'D' ? 'brand' : 'law', source: 'judge', quote: String(i.quote).slice(0, 220), why: String(i.why || '').slice(0, 220) });
    });
  }
} finally {
  saveSpend();
}

// ---------------------------------------------------------------- summarise
const ok = answers.filter((a) => a.ok);
const failed = answers.filter((a) => !a.ok);
const main = ok.filter((a) => a.tier === (tiers.includes('cheap') ? 'cheap' : tiers[0]));
const rate = (list) => ({
  answers: list.length,
  named: pct(list.filter((x) => x.named).length, list.length),
  linked: pct(list.filter((x) => x.linked).length, list.length),
  visible: pct(list.filter((x) => x.named || x.linked).length, list.length),
  web: pct(list.filter((x) => x.usedWeb).length, list.length), // answers that cited any web source
});
const groupBy = (list, key) => {
  const m = {};
  for (const x of list) (m[x[key]] ||= []).push(x);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, rate(v)]));
};
const domainCounts = (list) => {
  const m = {};
  for (const a of list) for (const d of a.domains) m[d] = (m[d] || 0) + 1;
  return Object.entries(m).sort((x, y) => y[1] - x[1]);
};

const summary = {
  date: iso(now), label: LABEL, runs: RUNS, tier: TIER, questions: questions.length,
  answers: answers.length, ok: ok.length, failed: failed.length,
  overall: rate(main),
  byAssistant: groupBy(main, 'assistant'),
  byGroup: groupBy(main, 'group'),
  byLang: groupBy(main, 'lang'),
  byMarket: groupBy(main, 'market'),
  topDomains: domainCounts(main).slice(0, 15),
  costTotal: Math.round(spent * 10000) / 10000,
  costJudge: Math.round(judgeCost * 10000) / 10000,
  costUnknown: ok.filter((a) => !a.costKnown).length,
  costPerAnswer: Object.fromEntries(Object.entries(ok.reduce((m, a) => { (m[a.model] ||= []).push(a.cost); return m; }, {}))
    .map(([m, v]) => [m, Math.round((v.reduce((s, c) => s + c, 0) / v.length) * 100000) / 100000])),
  monthSpend: Math.round((monthBefore + spent) * 10000) / 10000,
  balanceAfter: await fetchBalance(),
  stopReason,
};

// Where we are missing: questions with no PropertyList mention or link in any
// answer, ranked by how often other sites were cited. Groups A and B first.
const byQ = {};
for (const a of main) (byQ[a.id] ||= []).push(a);
summary.missing = Object.entries(byQ)
  .filter(([, v]) => !v.some((a) => a.named || a.linked))
  .map(([id, v]) => ({ id, group: v[0].group, text: questions.find((q) => q.id === id)?.text, cited: domainCounts(v).slice(0, 3) }))
  .filter((m) => m.cited.length)
  .sort((x, y) => (x.group > y.group ? 1 : x.group < y.group ? -1 : 0) || y.cited[0][1] - x.cited[0][1])
  .slice(0, 5);

// Pilot: do the flagship models name and cite the same things as the cheaper ones?
if (tiers.length > 1) {
  summary.tierComparison = {};
  for (const a of ASSISTANTS.filter((x) => x.flagship)) {
    const pairs = [];
    for (const q of questions) {
      const c = ok.filter((x) => x.assistant === a.key && x.id === q.id && x.tier === 'cheap');
      const f = ok.filter((x) => x.assistant === a.key && x.id === q.id && x.tier === 'flagship');
      if (!c.length || !f.length) continue;
      const cd = new Set(c.flatMap((x) => x.domains)), fd = new Set(f.flatMap((x) => x.domains));
      const inter = [...cd].filter((d) => fd.has(d)).length, union = new Set([...cd, ...fd]).size;
      pairs.push({ sameVisibility: c.some((x) => x.named || x.linked) === f.some((x) => x.named || x.linked), overlap: union ? inter / union : 1 });
    }
    summary.tierComparison[a.key] = {
      questions: pairs.length,
      sameVisibility: pct(pairs.filter((p) => p.sameVisibility).length, pairs.length),
      domainOverlap: pairs.length ? Math.round((100 * pairs.reduce((s, p) => s + p.overlap, 0)) / pairs.length) : 0,
      cheap: rate(ok.filter((x) => x.assistant === a.key && x.tier === 'cheap')),
      flagship: rate(ok.filter((x) => x.assistant === a.key && x.tier === 'flagship')),
    };
  }
}

// History and trend: weekly runs only.
const HIST_FILE = path.join(OUT, 'history.json');
const history = readJson(HIST_FILE, []).filter((h) => h.date !== summary.date || h.label !== LABEL);
const prior = history.filter((h) => h.label === 'weekly').sort((x, y) => (x.date < y.date ? -1 : 1));
if (LABEL === 'weekly' && !stopReason) {
  history.push({ date: summary.date, label: LABEL, overall: summary.overall, byAssistant: summary.byAssistant, cost: summary.costTotal });
  fs.writeFileSync(HIST_FILE, JSON.stringify(history, null, 2));
}
const lastWeek = prior[prior.length - 1] || null;
const avg = (arr, get) => (arr.length ? Math.round((10 * arr.reduce((s, h) => s + (get(h) || 0), 0)) / arr.length) / 10 : null);
// A change counts only when this week and last week sit on the same side of the
// average of the weeks before them, by 5 points or more.
// Needs 4 earlier weekly runs: last week plus at least 3 before it for the average.
function held(get) {
  if (prior.length < 4) return null;
  const base = avg(prior.slice(-5, -1), get);
  const a = get(summary), b = get(lastWeek);
  if (a - base >= 5 && b - base >= 5) return `up from ${base}%, held two weeks`;
  if (base - a >= 5 && base - b >= 5) return `down from ${base}%, held two weeks`;
  return null;
}

// ---------------------------------------------------------------- write
const stamp = `${iso(now)}-${LABEL}`;
fs.writeFileSync(path.join(OUT, `${stamp}.json`), JSON.stringify({ summary, answers }, null, 2));
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(summary, null, 2));

const line = (name, r, prev, trend) => `  ${name.padEnd(11)} named ${String(r.named).padStart(5)}%   linked ${String(r.linked).padStart(5)}%   cited sources in ${String(r.web).padStart(5)}%   (${r.answers} answers)${prev ? `   last week ${prev.visible}%` : ''}${trend ? `   ${trend}` : ''}`;
const nameOf = (k) => ASSISTANTS.find((a) => a.key === k)?.name || k;
const flagged = ok.filter((a) => a.flags.length);
const brandFlags = flagged.flatMap((a) => a.flags.filter((f) => f.kind === 'brand').map((f) => ({ a, f })));
const lawFlags = flagged.flatMap((a) => a.flags.filter((f) => f.kind === 'law').map((f) => ({ a, f })));
const flagLine = ({ a, f }) => `- ${nameOf(a.assistant)} (${a.tier}), ${a.id} "${questions.find((q) => q.id === a.id)?.text}"\n  ${f.quote ? `"${f.quote}" - ` : ''}${f.why}${a.ourUrls.length ? `\n  OUR PAGE WAS CITED: ${a.ourUrls[0]}` : a.cited[0] ? `\n  Source it cited: ${a.cited[0]}` : ''}`;

const baselineNote = prior.length < 4
  ? `Baseline: week ${prior.length + (LABEL === 'weekly' ? 1 : 0)} of 4. Don't act on week-to-week changes yet.`
  : 'Changes are only called out when they hold for two weeks in a row.';

const partial = stopReason ? `PARTIAL RUN, NOT A FULL WEEK: stopped after ${main.length} of ${tasks.filter((t) => t.tier === (tiers.includes('cheap') ? 'cheap' : tiers[0])).length} answers (${stopReason}). The figures below cover only what was collected and are not saved to the trend.\n\n` : '';
const keyNote = cfg('AI_MENTIONS_API_KEY') ? '' : '\nRuns on the same OpenRouter key as the blog (no separate key set); these calls show as "PropertyList AI mention checker" in OpenRouter\'s activity list.';

const text = `AI mention checker - ${ddmmyy(now)} (${LABEL})

${partial}How often the assistants named or linked PropertyList, with web search on.
${questions.length} questions x ${RUNS} run(s) x ${active.length} assistants = ${main.length} answers${failed.length ? ` (${failed.length} failed)` : ''}.${skipped.length ? `\n${skipped.join('\n')}` : ''}
"Cited sources" shows how often an assistant backed its answer with web links; the rest it answered from memory.

${Object.entries(summary.byAssistant).map(([k, r]) => line(nameOf(k), r, lastWeek?.byAssistant?.[k], held((h) => h?.byAssistant?.[k]?.visible))).join('\n')}
${line('All', summary.overall, lastWeek?.overall, held((h) => h?.overall?.visible))}

By market:   ${Object.entries(summary.byMarket).map(([k, r]) => `${k} ${r.visible}%`).join(', ')}
By language: ${Object.entries(summary.byLang).map(([k, r]) => `${LANGS[k] || k} ${r.visible}%`).join(', ')}
By group:    ${Object.entries(summary.byGroup).sort().map(([k, r]) => `${GROUPS[k] || k} ${r.visible}%`).join(', ')}
(Percentages are "named or linked".)

WHERE WE'RE MISSING (other sites cited, PropertyList never named or linked)
${summary.missing.length ? summary.missing.map((m, i) => `${i + 1}. ${m.id} "${m.text}"\n   Cited instead: ${m.cited.map(([d, n]) => `${d} (${n})`).join(', ')}`).join('\n') : '- None this week.'}

MOST-CITED SITES (answers citing each)
${summary.topDomains.slice(0, 10).map(([d, n]) => `- ${d} ${n}${isOurs(d) ? '  <- us' : ''}`).join('\n') || '- None.'}

ABOUT US: POSSIBLY WRONG STATEMENTS (checked against the claims ledger; confirm before acting)
${brandFlags.length ? brandFlags.slice(0, 12).map(flagLine).join('\n') : '- None found.'}

LEGAL: DEAD LAW POSSIBLY PRESENTED AS CURRENT (checked against the legal-currency list)
${lawFlags.length ? lawFlags.slice(0, 12).map(flagLine).join('\n') : '- None found.'}
${summary.tierComparison ? `
PILOT: FLAGSHIP VS CHEAPER MODELS
${Object.entries(summary.tierComparison).map(([k, c]) => `- ${nameOf(k)}: same visibility on ${c.sameVisibility}% of ${c.questions} questions, cited-site overlap ${c.domainOverlap}%. Cheaper ${c.cheap.visible}% visible, flagship ${c.flagship.visible}%.`).join('\n')}
` : ''}
COST PER ANSWER (actual)
${Object.entries(summary.costPerAnswer).map(([m, c]) => `- ${m}: $${c.toFixed(4)}`).join('\n')}

Spend: ${usd(summary.costTotal)} this run (judge ${usd(summary.costJudge)}), ${usd(summary.monthSpend)} this month of a ${usd(MONTHLY_CAP)} cap. OpenRouter balance now ${summary.balanceAfter === null ? 'unknown' : usd(summary.balanceAfter)}.${summary.costUnknown ? ` ${summary.costUnknown} answers came back without a cost figure.` : ''}${judgeErrors ? ` ${judgeErrors} judge checks failed.` : ''}
${baselineNote}
These are the vendors' developer versions with web search on, not the consumer apps; read them as a trend.${keyNote}
Raw answers: var/ai-mentions/${stamp}.json on the droplet.`;

fs.writeFileSync(path.join(OUT, 'latest.txt'), text);
console.log(text);

if (SEND_EMAIL) {
  const MKEY = cfg('MANDRILL_API_KEY'), TO = cfg('NOTIFY_TO'), FROM = cfg('NOTIFY_FROM') || 'noreply@propertylist.es';
  if (!MKEY || !TO) { console.log('ai-mentions: email skipped (MANDRILL_API_KEY / NOTIFY_TO missing)'); process.exit(0); }
  const subject = stopReason && !main.length
    ? `[GEO] AI mentions ${ddmmyy(now)}: not run - ${stopReason}`
    : `[GEO] AI mentions ${ddmmyy(now)}: ${stopReason ? 'PARTIAL, ' : ''}named or linked in ${summary.overall.visible}% of ${main.length} answers${brandFlags.length + lawFlags.length ? `, ${brandFlags.length + lawFlags.length} to check` : ''}`;
  const res = await fetch('https://mandrillapp.com/api/1.0/messages/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: MKEY, message: { from_email: FROM, from_name: 'PropertyList Info Hub', to: [{ email: TO }], subject, text, tags: ['info-hub', 'ai-mentions'], track_opens: false, track_clicks: false } }),
  });
  console.log('ai-mentions: email', res.status, (await res.text()).slice(0, 120));
}
