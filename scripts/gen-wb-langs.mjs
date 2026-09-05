// Generate the Website Builder page in the extra site languages from the
// English source, so there is exactly one page to edit and the rest are built.
//
//   node scripts/gen-wb-langs.mjs --dry           show what would change
//   node scripts/gen-wb-langs.mjs                 write all four
//   node scripts/gen-wb-langs.mjs --only=de,fr    write some
//
// WHY GENERATED, NOT HAND-WRITTEN. English and Spanish are hand-kept because
// James writes them. Four more hand-kept copies would mean six edits every time
// a price or a sentence changes, and this page changed nine times in one day.
// Generated files carry a header saying so; edit the English page and re-run.
//
// The German pilot's lesson is baked in too: these are self-contained routes,
// so a mistake here can never take the live EN/ES pages down with it.
import fs from 'node:fs';

const DIR = '/opt/info-hub';
const SRC = `${DIR}/src/pages/website-builder.astro`;
const ORIGIN = 'https://info.propertylist.es';

for (const line of fs.readFileSync(`${DIR}/.env`, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const KEY = (process.env.DEEPL_API_KEY || '').trim();
const ENDPOINT = KEY.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// The site's language registry for this page. Slugs are localised, the way the
// Spanish one is, because a French speaker searching for an agency site builder
// does not type "website-builder".
const LANGS = [
  { code: 'de', deepl: 'DE', dir: 'de', slug: 'website-baukasten' },
  { code: 'fr', deepl: 'FR', dir: 'fr', slug: 'createur-de-site-immobilier' },
  { code: 'sv', deepl: 'SV', dir: 'sv', slug: 'webbplatsbyggare' },
  { code: 'ru', deepl: 'RU', dir: 'ru', slug: 'konstruktor-saytov' },
];
const url = (l) => (l === 'en' ? `${ORIGIN}/website-builder/` : l === 'es' ? `${ORIGIN}/es/constructor-de-webs/` : `${ORIGIN}/${LANGS.find((x) => x.code === l).dir}/${LANGS.find((x) => x.code === l).slug}/`);
const ALL = ['en', 'es', ...LANGS.map((l) => l.code)];

// Names and terms that must survive translation untouched. Only terms that are
// unambiguous are listed: template names like Marina or Sierra are ordinary
// words in some of these languages, and they only ever appear in the `name`
// field, which is never sent for translation anyway.
const KEEP = [
  'PropertyList', 'Website Builder', 'Instant Content', 'Property Intelligence Report',
  'Google Business Profile', 'Cloudflare', 'DDoS', 'SSL', 'CRM', 'MLS', 'XML', 'API',
  'EUR', 'your-agency-name.estate-agency.co', 'your-agency.estate-agency.co',
  'yourbrand.estate-agency.co', 'estate-agency.co', 'aviso legal', 'Costa del Sol',
  'Solaz', 'Noir', 'Faro', 'HTML',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEEP_RE = new RegExp('(' + KEEP.sort((a, b) => b.length - a.length).map(esc).join('|') + ')', 'g');

// DeepL in XML mode leaves anything inside an ignored tag alone, which is how
// the brand names and the HTML entities come back exactly as they went in.
const protect = (s) => s.replace(KEEP_RE, '<x>$1</x>').replace(/&[a-z]+;/g, (m) => `<x>${m}</x>`);
const unprotect = (s) => s.replace(/<x>(.*?)<\/x>/g, '$1');

// DeepL was the first choice and its quota is spent, so translation runs on the
// same model the German pilot used through OpenRouter. The prompt carries the
// house rules that a general translator does not know: plain hyphens only (the
// standing no-dash rule, which German and French break by habit), the product
// vocabulary that must survive untouched, and the register to address an estate
// agent in. Output is JSON so a stray sentence of commentary cannot end up on
// the page.
const OR_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OR_URL = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const MODEL = process.env.WB_LANG_MODEL || 'openai/gpt-5-mini';

const REGISTER = {
  DE: 'German, addressing the reader formally with Sie',
  FR: 'French, addressing the reader formally with vous',
  SV: 'Swedish, addressing the reader as du, which is normal in Swedish business writing',
  RU: 'Russian, addressing the reader formally with вы',
};

// The unit price is quoted in credits everywhere, and the Spanish page sets the
// precedent by translating the word (creditos, not credits). Left to itself the
// model translated it differently in different batches, so the word is named
// here and the same one is used on every line of a page.
const CREDIT_WORD = {
  DE: 'Credits (always capitalised, never Guthaben or Punkte)',
  FR: 'credits',
  SV: 'krediter',
  RU: 'кредитов, declined correctly for the number in front of it',
};

const translate = async (texts, target) => {
  const out = [];
  // Smaller batches miscount far less often, and a miscount costs a whole batch
  // of one-at-a-time retries, so twelve is faster in practice than twenty.
  const BATCH = 12;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    let got;
    try {
      got = await batch(slice, target);
    } catch (e) {
      // A batch can come back one string short or one long when the model
      // splits a sentence. One at a time cannot miscount, so the run finishes
      // instead of dying two thirds of the way through a language.
      process.stdout.write('!');
      got = [];
      for (const one of slice) got.push((await batch([one], target))[0]);
    }
    out.push(...got);
    process.stdout.write('.');
  }
  return out;
};

const batch = async (slice, target) => {
  {
    const sys =
      `You translate marketing copy for PropertyList, a Spanish property platform, from English into ${REGISTER[target]}.\n` +
      `The user sends a JSON array of ${slice.length} strings. Reply with a JSON object of exactly one key, "translations",\n` +
      `whose value is an array of ${slice.length} strings, same order. No commentary, no other keys.\n` +
      `Rules:\n` +
      `1. Never use an em dash or an en dash. Plain hyphens only. This is absolute.\n` +
      `2. Leave these exactly as written, untranslated: ${KEEP.join(', ')}.\n` +
      `3. Keep every digit exactly as it is: "50 credits a month" keeps the 50. Translate the words around it.\n` +
      `   Render the word "credit"/"credits" as ${CREDIT_WORD[target]}, the same way on every line.\n` +
      `   Make it agree with the number in front of it: "1 credit" is singular, "50 credits" is plural.\n` +
      `4. The audience is a working estate agent. Plain, direct, concrete. No marketing hype words.\n` +
      `5. Keep HTML entities such as &middot; exactly as they appear.\n` +
      `6. Preserve leading and trailing spaces of each string exactly.\n` +
      `7. If a string is a single UI word such as Modern or Classic, translate it as that one word.`;
    const res = await fetch(`${OR_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${OR_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: JSON.stringify(slice) },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`model ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    let raw = j.choices?.[0]?.message?.content || '';
    raw = raw.replace(/^```(?:json)?|```$/g, '').trim();
    let arr;
    try {
      const parsed = JSON.parse(raw);
      // json_object mode forces an object wrapper, and the model picks its own
      // key for it, so take the first value that is actually an array of the
      // right length rather than trusting a name.
      arr = Array.isArray(parsed)
        ? parsed
        : Object.values(parsed).find((v) => Array.isArray(v) && v.length === slice.length) ||
          Object.values(parsed).find(Array.isArray);
    } catch {
      throw new Error('model did not return JSON: ' + raw.slice(0, 200));
    }
    if (!Array.isArray(arr) || arr.length !== slice.length) {
      throw new Error(`batch ${i}: expected ${slice.length} strings, got ${Array.isArray(arr) ? arr.length : typeof arr}`);
    }
    // The no-dash rule is enforced here as well as asked for: a model that slips
    // once would otherwise put a dash on a live page.
    return arr.map((t) => String(t).replace(/\s*[–—]\s*/g, ', ').replace(/‑/g, '-'));
  }
};

// ---------------------------------------------------------------- extraction
const src = fs.readFileSync(SRC, 'utf8');
const fmEnd = src.indexOf('\n---', 3);
const frontmatter = src.slice(0, fmEnd + 4);
const rest = src.slice(fmEnd + 4);

// Every span of the file that holds prose, as [start, end) offsets into `src`.
// Conservative on purpose: a rule that is not certain a span is prose leaves it
// alone, and the English text simply survives into the translated page, which
// is visible and fixable. The opposite mistake, translating an identifier,
// breaks the build.
const spans = [];
const addAll = (re, group, from, to) => {
  const s = src.slice(from, to);
  let m;
  while ((m = re.exec(s))) {
    const g = m[group];
    if (!g || !g.trim()) continue;
    const start = from + m.index + m[0].indexOf(g);
    spans.push({ start, end: start + g.length, text: g });
  }
};

// 1. Frontmatter, rule by rule and scoped to the array each rule belongs to.
//    Scoping matters: a bare /name: '...'/ would also match the fifteen template
//    names, and DeepL would happily turn Horizon, Heritage and Meridian into
//    German nouns. Template names are the product's vocabulary and never move.
const block = (startRe) => {
  const m = startRe.exec(src.slice(0, fmEnd));
  if (!m) return null;
  const from = m.index;
  const to = src.indexOf('\n];', from);
  return to === -1 ? null : [from, to];
};
const templatesAt = block(/const templates = \[/);
const addonsAt = block(/const addons = \[/);
const faqsAt = block(/const faqs = \[/);

addAll(/const title =\s*\n?\t*'([^']*)'/g, 1, 0, fmEnd);
// `const description =` sits on its own line with the string on the next one.
// An earlier version of this rule looked for a tab before the word, matched
// nothing, and shipped four pages whose meta description was still English.
addAll(/const description =\s*\n?\s*'((?:[^'\\]|\\.)*)'/g, 1, 0, fmEnd);
if (templatesAt) {
  addAll(/\bstyle: '([^']*)'/g, 1, ...templatesAt);
  addAll(/\bline: '((?:[^'\\]|\\.)*)'/g, 1, ...templatesAt);
}
if (addonsAt) {
  addAll(/\bname: '((?:[^'\\]|\\.)*)'/g, 1, ...addonsAt);
  addAll(/\bwhat: '((?:[^'\\]|\\.)*)'/g, 1, ...addonsAt);
  addAll(/\bprice: '((?:[^'\\]|\\.)*)'/g, 1, ...addonsAt);
}
if (faqsAt) {
  addAll(/\bq: '((?:[^'\\]|\\.)*)'/g, 1, ...faqsAt);
  addAll(/\ba: '((?:[^'\\]|\\.)*)'/g, 1, ...faqsAt);
}
{
  const m = /const styles = \[([^\]]*)\]/.exec(src.slice(0, fmEnd));
  if (m) {
    const inner = m[1];
    const base = m.index + m[0].indexOf(inner);
    const re = /'([^']*)'/g;
    let x;
    while ((x = re.exec(inner))) spans.push({ start: base + x.index + 1, end: base + x.index + 1 + x[1].length, text: x[1] });
  }
}

// 2. Body: text nodes with no braces (so never an Astro expression), plus the
//    attributes a reader actually hears or sees.
const bodyStart = fmEnd + 4;
// Only real script BLOCKS are off limits. The JSON-LD tags on this page are
// self-closing, and a naive /<script[\s\S]*?<\/script>/ starts at the first of
// them and runs to the inline script at the foot of the page, marking the whole
// body untranslatable. That is why the first run produced almost nothing.
const scriptRe = /<script(?![^>]*\/>)[^>]*>[\s\S]*?<\/script>/g;
const blocked = [];
let sm;
while ((sm = scriptRe.exec(src))) blocked.push([sm.index, sm.index + sm[0].length]);
const inBlocked = (i) => blocked.some(([a, b]) => i >= a && i < b);

{
  const s = src.slice(bodyStart);
  const re = />([^<>{}]+)</g;
  let m;
  while ((m = re.exec(s))) {
    const g = m[1];
    if (!g.trim() || !/[A-Za-z]{2}/.test(g)) continue;
    const start = bodyStart + m.index + 1;
    if (inBlocked(start)) continue;
    spans.push({ start, end: start + g.length, text: g });
  }
  for (const attr of ['alt', 'aria-label', 'title']) {
    const ar = new RegExp(`${attr}="([^"{}]+)"`, 'g');
    let a;
    while ((a = ar.exec(s))) {
      const g = a[1];
      if (!/[A-Za-z]{2}/.test(g)) continue;
      const start = bodyStart + a.index + a[0].indexOf(g);
      if (inBlocked(start)) continue;
      spans.push({ start, end: start + g.length, text: g });
    }
  }
}

spans.sort((a, b) => a.start - b.start);
// Drop any span that overlaps an earlier one, which can happen where a rule
// matched inside another rule's match.
const clean = [];
for (const sp of spans) if (!clean.length || sp.start >= clean[clean.length - 1].end) clean.push(sp);

const uniq = [...new Set(clean.map((s) => s.text))];
console.log(`${clean.length} spans, ${uniq.length} unique strings`);
if (DRY) {
  uniq.slice(0, 25).forEach((t) => console.log('  ' + t.slice(0, 100)));
  console.log(`  ... and ${Math.max(0, uniq.length - 25)} more`);
  process.exit(0);
}
if (!KEY) { console.error('DEEPL_API_KEY missing'); process.exit(1); }

// ---------------------------------------------------------------- generation
const targets = LANGS.filter((l) => !ONLY.length || ONLY.includes(l.code));
for (const L of targets) {
  process.stdout.write(`\n${L.code}: translating `);
  const done = await translate(uniq, L.deepl);
  const map = new Map(uniq.map((t, i) => [t, done[i]]));

  // Splice back from the end so earlier offsets stay valid.
  let out = src;
  for (let i = clean.length - 1; i >= 0; i--) {
    const sp = clean[i];
    let t = map.get(sp.text);
    if (t == null) continue;
    // Copy the English page's capitalisation decision. Russian came back with a
    // lowercase headline; blanket-capitalising would instead have broken the
    // proof labels, which are lowercase in English on purpose.
    const srcHead = sp.text.trimStart();
    const tgtHead = t.trimStart();
    if (/^\p{Lu}/u.test(srcHead) && /^\p{Ll}/u.test(tgtHead)) {
      const lead = t.length - tgtHead.length;
      t = t.slice(0, lead) + tgtHead[0].toUpperCase() + tgtHead.slice(1);
    }
    out = out.slice(0, sp.start) + t.replace(/'/g, "\\'") + out.slice(sp.end);
  }
  // Apostrophes inside JSX text must not be escaped; only string literals need
  // it, and those all sit in the frontmatter.
  const fmCut = out.indexOf('\n---', 3) + 4;
  out = out.slice(0, fmCut) + out.slice(fmCut).replace(/\\'/g, "'");

  // Route facts: imports climb one more directory, and the page declares itself.
  out = out.replace("from '../layouts/Layout.astro'", "from '../../layouts/Layout.astro'");
  out = out.replace("from '../lib/portalStats'", "from '../../lib/portalStats'");
  out = out.replace(/statPlus\(__ps\.(\w+), 'en'\)/g, `statPlus(__ps.$1, '${L.code}')`);
  out = out.replace('\tlang="en"', `\tlang="${L.code}"`);
  out = out.replace(/canonical="[^"]*"/, `canonical="${url(L.code)}"`);
  const hre = ALL.map((c) => `\t\t{ hreflang: '${c}', href: '${url(c)}' },`).join('\n') + `\n\t\t{ hreflang: 'x-default', href: '${url('en')}' },`;
  out = out.replace(/\threflangs=\{\[[\s\S]*?\t\]\}/, `\threflangs={[\n${hre}\n\t]}`);
  out = out.replace(/url: 'https:\/\/info\.propertylist\.es\/website-builder\/'/g, `url: '${url(L.code)}'`);
  out = out.replace(/item: 'https:\/\/info\.propertylist\.es\/'/g, `item: '${ORIGIN}/'`);

  const header =
    `---\n/* GENERATED FILE - do not edit by hand.\n` +
    `   Source: src/pages/website-builder.astro (English).\n` +
    `   Rebuild: node scripts/gen-wb-langs.mjs --only=${L.code}\n` +
    `   Hand edits are lost on the next run; change the English page instead. */\n`;
  out = header + out.slice(4);

  const dest = `${DIR}/src/pages/${L.dir}/${L.slug}.astro`;
  fs.mkdirSync(`${DIR}/src/pages/${L.dir}`, { recursive: true });
  fs.writeFileSync(dest, out, 'utf8');
  console.log(` -> ${dest.replace(DIR + '/', '')} (${out.length} bytes)`);
}
console.log('\ndone');
