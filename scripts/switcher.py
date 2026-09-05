# Generalise the header language switcher from a fixed EN/ES pair (plus a
# German special case left over from the pilot) to however many languages the
# page itself declares.
#
# The rule: a page gets a pill for every hreflang it publishes. A page that
# publishes only en and es renders exactly what it renders today, so nothing on
# the existing site changes. This is what makes a sitewide rollout a matter of
# adding hreflangs to a page rather than editing this file again.
import sys

P = '/opt/info-hub/src/layouts/Layout.astro'
s = open(P, encoding='utf-8').read()

if 'switchLangs' in s:
    print('already generalised')
    sys.exit(0)

# 1. Replace the German-only path logic with an N-language version.
old_logic = """const deHreflang = (hreflangs || []).find((h) => h.hreflang === 'de')?.href;
const enPath = lang === 'de' ? (enHreflang ?? '/') : toEnglishSwitchPath(pathname);
const esPath = lang === 'de' ? (esHreflang ?? '/es/') : toSpanishSwitchPath(pathname);
const deSwitchHref = deHreflang ?? '/de/';"""

new_logic = """// Languages beyond the EN/ES core. A page opts in by publishing an hreflang for
// one: the switcher then shows a pill for it, and the EN and ES pills follow the
// page's own declarations instead of the /es/ path convention, which only
// describes the two-language site. Pages that publish nothing extra are
// unaffected, which is why this was safe to turn on everywhere at once.
const EXTRA_LANG_CODES = ['de', 'fr', 'sv', 'ru'] as const;
const switchLangs = EXTRA_LANG_CODES.map((code) => ({
	code,
	href: (hreflangs || []).find((h) => h.hreflang === code)?.href,
})).filter((l): l is { code: string; href: string } => Boolean(l.href));
const isExtraLang = (EXTRA_LANG_CODES as readonly string[]).includes(lang);
const enPath = isExtraLang ? (enHreflang ?? '/') : toEnglishSwitchPath(pathname);
const esPath = isExtraLang ? (esHreflang ?? '/es/') : toSpanishSwitchPath(pathname);"""

if old_logic not in s:
    print('LOGIC BLOCK NOT FOUND')
    sys.exit(1)
s = s.replace(old_logic, new_logic, 1)

# 2. Desktop pills.
old_desktop = """\t\t\t\t\t\t\t\t{lang === 'de' && (
\t\t\t\t\t\t\t\t\t<a class:list={['navLangLink', 'isActive']} href={deSwitchHref} hreflang="de">
\t\t\t\t\t\t\t\t\t\tDE
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t)}"""
new_desktop = """\t\t\t\t\t\t\t\t{switchLangs.map((l) => (
\t\t\t\t\t\t\t\t\t<a class:list={['navLangLink', lang === l.code ? 'isActive' : null]} href={l.href} hreflang={l.code}>
\t\t\t\t\t\t\t\t\t\t{l.code.toUpperCase()}
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t))}"""
if old_desktop not in s:
    print('DESKTOP BLOCK NOT FOUND')
    sys.exit(1)
s = s.replace(old_desktop, new_desktop, 1)

# 3. Mobile pills.
old_mobile = """\t\t\t\t\t\t\t\t{lang === 'de' && (
\t\t\t\t\t\t\t\t\t<a class:list={['mobileLangLink', 'isActive']} href={deSwitchHref} hreflang="de">
\t\t\t\t\t\t\t\t\t\tDE
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t)}"""
new_mobile = """\t\t\t\t\t\t\t\t{switchLangs.map((l) => (
\t\t\t\t\t\t\t\t\t<a class:list={['mobileLangLink', lang === l.code ? 'isActive' : null]} href={l.href} hreflang={l.code}>
\t\t\t\t\t\t\t\t\t\t{l.code.toUpperCase()}
\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t))}"""
if old_mobile not in s:
    print('MOBILE BLOCK NOT FOUND (indent differs)')
    sys.exit(1)
s = s.replace(old_mobile, new_mobile, 1)

open(P, 'w', encoding='utf-8').write(s)
print('switcher generalised: logic + desktop + mobile')
