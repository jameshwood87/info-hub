#!/bin/sh
# One-time wiring for the market email: the HMAC secret the unsubscribe links
# are signed with, plus the two routing registrations every info-hub page needs
# (language toggle pair, sitemap exclusion). Safe to run twice.
set -e
cd /opt/info-hub

# 1. NEWSLETTER_SECRET. Generated on the box, never printed, appended only once.
if grep -q '^NEWSLETTER_SECRET=' .env; then
  echo "secret: already present"
else
  printf 'NEWSLETTER_SECRET=%s\n' "$(cat var/admin/.newsecret | head -1)" >> .env
  echo "secret: appended"
fi
rm -f var/admin/.newsecret

# 2. Language toggle. Layout.astro's mapPairs is what the header EN/ES button
#    reads; a page missing from it 404s the toggle silently.
if grep -q "es: '/es/baja/'" src/layouts/Layout.astro; then
  echo "mapPairs: already present"
else
  perl -0pi -e "s|(\t\{ en: '/website-builder/', es: '/es/constructor-de-webs/' \},\n)|\$1\t{ en: '/unsubscribe/', es: '/es/baja/' },\n|" src/layouts/Layout.astro
  echo "mapPairs: added"
fi

# 3. Sitemap. Both pages are noindex confirmations reached only from an email.
if grep -q "'/unsubscribe/'," src/pages/sitemap.xml.ts; then
  echo "sitemap: already present"
else
  perl -0pi -e "s|(    '/docs/property-services/',)|    '/unsubscribe/',\n    '/es/baja/', // noindex: unsubscribe confirmation, reached only from an email\n\$1|" src/pages/sitemap.xml.ts
  echo "sitemap: added"
fi

echo "--- verify"
grep -c '^NEWSLETTER_SECRET=' .env
grep -n "es/baja" src/layouts/Layout.astro | cut -c1-90
grep -n "unsubscribe/\|es/baja/" src/pages/sitemap.xml.ts | cut -c1-100
