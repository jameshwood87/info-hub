# Record the four new language versions in llms.txt, and bump the version.
# Every public page ships an llms.txt entry in the same change as the page; the
# Spanish twin is already named on the /website-builder/ line, so the four new
# URLs go there too rather than getting sections of their own.
import re, sys

P = '/opt/info-hub/src/data/llms-template.txt'
s = open(P, encoding='utf-8').read()

if 'website-baukasten' in s:
    print('already recorded')
    sys.exit(0)

marker = '#### /website-builder/ - Website Builder (fifteen finished agency website designs)'
if marker not in s:
    print('MARKER NOT FOUND')
    sys.exit(1)

# Append the language list to the end of that entry's paragraph.
start = s.index(marker)
para_start = s.index('\n', start) + 1
para_end = s.index('\n\n', para_start)
para = s[para_start:para_end]
para = para.rstrip() + (
    ' Published in six languages: English /website-builder/, Spanish /es/constructor-de-webs/, '
    'German /de/website-baukasten/, French /fr/createur-de-site-immobilier/, '
    'Swedish /sv/webbplatsbyggare/ and Russian /ru/konstruktor-saytov/. '
    'The four beyond English and Spanish are generated from the English page, so they carry the same facts and prices.'
)
s = s[:para_start] + para + s[para_end:]

s = re.sub(r'^Version: 6\.6$', 'Version: 6.7', s, count=1, flags=re.M)
open(P, 'w', encoding='utf-8').write(s)
print('llms updated, version 6.7')
