# Swap the row of language pills for a flag dropdown, but only on pages that
# offer more than the EN/ES pair.
#
# Six pills do not fit a phone header. Two still do, so every existing page keeps
# the switcher it has and only the multilingual pages change. That also means
# this can go live without re-checking the header on hundreds of pages.
import sys

P = '/opt/info-hub/src/layouts/Layout.astro'
s = open(P, encoding='utf-8').read()

if 'LangPicker' in s:
    print('already wired')
    sys.exit(0)

# 1. Import the component next to the other layout imports.
anchor_import = "---\n"
if not s.startswith(anchor_import):
    print('NO FRONTMATTER')
    sys.exit(1)
s = s.replace("---\n", "---\nimport LangPicker from '../components/LangPicker.astro';\n", 1)

# 2. Build the full list once, in a fixed order, so both headers agree.
old_logic = "const isExtraLang = (EXTRA_LANG_CODES as readonly string[]).includes(lang);"
new_logic = (
    "const isExtraLang = (EXTRA_LANG_CODES as readonly string[]).includes(lang);\n"
    "// The complete set this page offers, English first, in the order the picker\n"
    "// lists them. Only pages with something beyond EN/ES get the dropdown.\n"
    "const pickerLangs = [\n"
    "\t{ code: 'en', href: '' },\n"
    "\t{ code: 'es', href: '' },\n"
    "\t...switchLangs,\n"
    "];\n"
)
if old_logic not in s:
    print('LOGIC ANCHOR NOT FOUND')
    sys.exit(1)
s = s.replace(old_logic, new_logic, 1)

# The two hrefs are only known after enPath/esPath are computed, which happens
# on the following lines, so fill them in rather than reordering the file.
old_paths = "const esPath = isExtraLang ? (esHreflang ?? '/es/') : toSpanishSwitchPath(pathname);"
new_paths = old_paths + "\npickerLangs[0].href = enPath;\npickerLangs[1].href = esPath;"
if old_paths not in s:
    print('PATHS ANCHOR NOT FOUND')
    sys.exit(1)
s = s.replace(old_paths, new_paths, 1)

# 3. Desktop: dropdown when there is more than the pair, pills otherwise.
old_desktop = """\t\t\t\t\t\t\t\t{switchLangs.map((l) => (
\t\t\t\t\t\t\t\t\t<a class:list={['navLangLink', lang === l.code ? 'isActive' : null]} href={l.href} hreflang={l.code}>
\t\t\t\t\t\t\t\t\t\t{l.code.toUpperCase()}
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t))}"""
if old_desktop not in s:
    print('DESKTOP ANCHOR NOT FOUND')
    sys.exit(1)

# Wrap the whole navLang block so the pills disappear when the picker shows.
old_block_open = """\t\t\t\t\t\t\t<div class="navLang" aria-label={lang === 'de' ? 'Sprache' : lang === 'es' ? 'Idioma' : 'Language'}>"""
new_block_open = """\t\t\t\t\t\t\t{switchLangs.length > 0 ? (
\t\t\t\t\t\t\t\t<LangPicker lang={lang} langs={pickerLangs} />
\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t<div class="navLang" aria-label={lang === 'de' ? 'Sprache' : lang === 'es' ? 'Idioma' : 'Language'}>"""
if old_block_open not in s:
    print('DESKTOP BLOCK OPEN NOT FOUND')
    sys.exit(1)
s = s.replace(old_block_open, new_block_open, 1)
s = s.replace(old_desktop + "\n\t\t\t\t\t\t\t</div>", "\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t)}", 1)

# 4. Mobile: same rule, the in-flow variant.
old_mobile_open = """\t\t\t\t\t\t\t<div class="mobileLang">"""
old_mobile_extra = """\t\t\t\t\t\t\t\t{switchLangs.map((l) => (
\t\t\t\t\t\t\t\t\t<a class:list={['mobileLangLink', lang === l.code ? 'isActive' : null]} href={l.href} hreflang={l.code}>
\t\t\t\t\t\t\t\t\t\t{l.code.toUpperCase()}
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t))}"""
if old_mobile_open not in s or old_mobile_extra not in s:
    print('MOBILE ANCHORS NOT FOUND')
    sys.exit(1)
s = s.replace(
    old_mobile_open,
    """\t\t\t\t\t\t\t{switchLangs.length > 0 ? (
\t\t\t\t\t\t\t\t<LangPicker lang={lang} langs={pickerLangs} variant="mobile" />
\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t<div class="mobileLang">""",
    1,
)
s = s.replace(old_mobile_extra + "\n\t\t\t\t\t\t\t</div>", "\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t)}", 1)

open(P, 'w', encoding='utf-8').write(s)
print('flag dropdown wired for desktop and mobile')
