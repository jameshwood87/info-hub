# "1 Credits" is wrong in every language. The translator was told to use one
# fixed word for the unit so it could not drift between batches, and it applied
# that word to the singular case too.
#
# The prompt now asks for number agreement, so future runs come out right; this
# repairs the pages already generated without paying for another full run.
import re, sys, glob

FIX = {
    'de': [(r'\b1 Credits\b', '1 Credit')],
    'fr': [(r'\b1 credits\b', '1 credit'), (r'\b1 crédits\b', '1 crédit')],
    'sv': [(r'\b1 krediter\b', '1 kredit')],
    'ru': [(r'\b1 кредитов\b', '1 кредит'), (r'\b1 кредита\b', '1 кредит')],
}
PAGES = {
    'de': '/opt/info-hub/src/pages/de/website-baukasten.astro',
    'fr': '/opt/info-hub/src/pages/fr/createur-de-site-immobilier.astro',
    'sv': '/opt/info-hub/src/pages/sv/webbplatsbyggare.astro',
    'ru': '/opt/info-hub/src/pages/ru/konstruktor-saytov.astro',
}

for lang, path in PAGES.items():
    try:
        s = open(path, encoding='utf-8').read()
    except FileNotFoundError:
        print(f'{lang}: not generated yet, skipped')
        continue
    n = 0
    for pat, rep in FIX[lang]:
        s, k = re.subn(pat, rep, s)
        n += k
    if n:
        open(path, 'w', encoding='utf-8').write(s)
    print(f'{lang}: {n} singular fixes')
