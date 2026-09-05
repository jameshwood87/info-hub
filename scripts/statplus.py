# Widen statPlus to the languages the site now publishes.
#
# It was typed 'en' | 'es' | 'de', so a French page calling it would not compile.
# It is also worth getting right rather than just widening: English groups
# thousands with a comma, Spanish and German with a full stop, and French,
# Swedish and Russian with a space. A non-breaking space is used so "1 380"
# never wraps across two lines in the middle of a number.
import sys

P = '/opt/info-hub/src/lib/portalStats.ts'
s = open(P, encoding='utf-8').read()

if "'sv'" in s:
    print('already widened')
    sys.exit(0)

old = """export function statPlus(n: number, lang: 'en' | 'es' | 'de' = 'en'): string {
	if (!Number.isFinite(n) || n <= 0) return '0';
	const floored = Math.floor(n / 10) * 10;
	const sep = lang === 'en' ? ',' : '.';
	return String(floored).replace(/\\B(?=(\\d{3})+(?!\\d))/g, sep) + '+';
}"""

new = """export function statPlus(n: number, lang: 'en' | 'es' | 'de' | 'fr' | 'sv' | 'ru' = 'en'): string {
	if (!Number.isFinite(n) || n <= 0) return '0';
	const floored = Math.floor(n / 10) * 10;
	// English groups thousands with a comma, Spanish and German with a full
	// stop, and French, Swedish and Russian with a space. The space is
	// non-breaking so a figure never wraps in half at the end of a line.
	const sep = lang === 'en' ? ',' : lang === 'fr' || lang === 'sv' || lang === 'ru' ? '\\u00a0' : '.';
	return String(floored).replace(/\\B(?=(\\d{3})+(?!\\d))/g, sep) + '+';
}"""

if old not in s:
    print('STATPLUS BODY NOT FOUND')
    sys.exit(1)

open(P, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('statPlus widened to six languages')
