# Every long Spanish passage on the builder page, in full, so the trim can
# match each one exactly. Same extraction as wordcount.py, no truncation.
import re

P = '/opt/info-hub/src/pages/es/constructor-de-webs.astro'
s = open(P, encoding='utf-8').read()
cut = s.index('\n---', 3) + 4
head, body = s[:cut], s[cut:]
body = re.sub(r'<script(?![^>]*/>)[^>]*>.*?</script>', '', body, flags=re.S)

nodes = [t.strip() for t in re.findall(r'>([^<>{}]+)<', body) if len(t.strip().split()) > 9]
fm = [t for t in re.findall(r"'((?:[^'\\]|\\.)*)'", head) if len(t.split()) > 12 and 'https' not in t]
rows = sorted(((len(t.split()), t) for t in nodes + fm), reverse=True)
print('ES total words', sum(len(t.split()) for t in nodes + fm))
for n, t in rows:
    print(f'{n} | {t}')
