# Restore sentence capitalisation the translator dropped.
#
# Russian came back with "выберите дизайн." where the English headline reads
# "Pick a design." Not every string should be capitalised, though: the labels
# under the proof numbers are lowercase in English on purpose, and a blanket
# "capitalise everything" would break them.
#
# So the rule is to copy the English decision rather than invent one: if the
# English span starts with an uppercase letter and the translated span starts
# with a lowercase one, raise it. The generated pages share the English page's
# markup exactly, only the text differs, so the Nth text node in one file is the
# Nth in the other.
import re, sys

EN = '/opt/info-hub/src/pages/website-builder.astro'
PAGES = {
    'de': '/opt/info-hub/src/pages/de/website-baukasten.astro',
    'fr': '/opt/info-hub/src/pages/fr/createur-de-site-immobilier.astro',
    'sv': '/opt/info-hub/src/pages/sv/webbplatsbyggare.astro',
    'ru': '/opt/info-hub/src/pages/ru/konstruktor-saytov.astro',
}
NODE = re.compile(r'>([^<>{}]+)<')

def body(path):
    s = open(path, encoding='utf-8').read()
    # Skip the frontmatter; only markup text nodes are paired here.
    cut = s.index('\n---', 3) + 4
    return s, cut

en_src, en_cut = body(EN)
en_nodes = [m.group(1) for m in NODE.finditer(en_src[en_cut:])]

for lang, path in PAGES.items():
    s, cut = body(path)
    head, tail = s[:cut], s[cut:]
    matches = list(NODE.finditer(tail))
    if len(matches) != len(en_nodes):
        print(f'{lang}: {len(matches)} nodes vs {len(en_nodes)} in English, skipped (structures differ)')
        continue
    fixed = 0
    out = []
    last = 0
    for i, m in enumerate(matches):
        src_txt, tgt_txt = en_nodes[i], m.group(1)
        new = tgt_txt
        st = tgt_txt.lstrip()
        se = src_txt.lstrip()
        if se[:1].isupper() and st[:1].islower():
            lead = len(tgt_txt) - len(st)
            new = tgt_txt[:lead] + st[0].upper() + st[1:]
            fixed += 1
        out.append(tail[last:m.start(1)])
        out.append(new)
        last = m.end(1)
    out.append(tail[last:])
    if fixed:
        open(path, 'w', encoding='utf-8').write(head + ''.join(out))
    print(f'{lang}: {fixed} capitals restored')
