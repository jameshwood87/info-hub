# Where the words actually are on the Website Builder page, longest first.
# Trimming by feel edits whatever you happen to scroll past; this shows what to
# cut and what a cut is worth.
import re

P = '/opt/info-hub/src/pages/website-builder.astro'
s = open(P, encoding='utf-8').read()
cut = s.index('\n---', 3) + 4
head, body = s[:cut], s[cut:]
body = re.sub(r'<script(?![^>]*/>)[^>]*>.*?</script>', '', body, flags=re.S)

nodes = [t.strip() for t in re.findall(r'>([^<>{}]+)<', body)]
nodes = [t for t in nodes if len(t.split()) > 5]

fm = re.findall(r"'((?:[^'\\]|\\.)*)'", head)
fm = [t for t in fm if len(t.split()) > 8 and 'https' not in t]

rows = sorted(((len(t.split()), t) for t in nodes + fm), reverse=True)
print('prose strings:', len(rows), ' total words:', sum(r[0] for r in rows))
print()
for n, t in rows[:20]:
    print(f'{n:3d} | {t[:118]}')
