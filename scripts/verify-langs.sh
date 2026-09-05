#!/bin/sh
# Prove the six language versions of the Website Builder page are correct on the
# live site: each answers 200, declares itself, and points at all five others.
#
# Reciprocity is the point. The German pilot's hreflang pointed out but never
# back, so Google could not form the cluster and the test was never fair. Every
# page here must list every other, or the same thing happens again.
BASE=https://info.propertylist.es
EN=/website-builder/
ES=/es/constructor-de-webs/
DE=/de/website-baukasten/
FR=/fr/createur-de-site-immobilier/
SV=/sv/webbplatsbyggare/
RU=/ru/konstruktor-saytov/
ALL="$EN $ES $DE $FR $SV $RU"

echo "== 1. status, declared lang, canonical"
for p in $ALL; do
  code=$(curl -s -o /tmp/p.html -w '%{http_code}' "$BASE$p")
  lang=$(grep -o '<html[^>]*lang="[a-z-]*"' /tmp/p.html | head -1 | sed 's/.*lang="//;s/"//')
  canon=$(grep -o 'rel="canonical" href="[^"]*"' /tmp/p.html | head -1 | sed 's/.*href="//;s/"//')
  ok=$( [ "$canon" = "$BASE$p" ] && echo ok || echo MISMATCH )
  printf '  %-36s %s  lang=%-3s canonical=%s\n' "$p" "$code" "$lang" "$ok"
done

echo "== 2. hreflang reciprocity (each page must list all 6 + x-default = 7)"
for p in $ALL; do
  curl -s "$BASE$p" > /tmp/p.html
  n=$(grep -o 'rel="alternate" hreflang="[a-z-]*"' /tmp/p.html | wc -l)
  miss=""
  for q in $ALL; do
    grep -q "hreflang=\"[a-z-]*\" href=\"$BASE$q\"" /tmp/p.html || miss="$miss $q"
  done
  printf '  %-36s alternates=%s missing:%s\n' "$p" "$n" "${miss:- none}"
done

echo "== 3. language pills rendered in the header"
for p in $ALL; do
  curl -s "$BASE$p" > /tmp/p.html
  pills=$(grep -o 'class="navLangLink[^"]*" href="[^"]*" hreflang="[a-z]*"' /tmp/p.html | sed 's/.*hreflang="//;s/"//' | tr '\n' ' ')
  printf '  %-36s %s\n' "$p" "$pills"
done

echo "== 4. no em or en dashes anywhere"
for p in $ALL; do
  n=$(curl -s "$BASE$p" | grep -c -P '[\x{2013}\x{2014}]')
  printf '  %-36s dashes=%s\n' "$p" "$n"
done

echo "== 5. the four old German pilot URLs are 410 Gone"
for p in /de/ /de/immobilie-in-spanien-kaufen/ /de/gebiete/elviria/ /de/gebiete/puerto-banus/; do
  printf '  %-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")"
done

echo "== 6. sitemap lists all six"
curl -s "$BASE/sitemap.xml" > /tmp/sm.xml
for p in $ALL; do
  printf '  %-36s %s\n' "$p" "$(grep -c "<loc>$BASE$p</loc>" /tmp/sm.xml)"
done

echo "== 7. llms.txt names the language set"
curl -s "$BASE/llms.txt" | grep -c 'website-baukasten'
