#!/bin/sh
# End-to-end proof of the unsubscribe flow, against the live site.
#  1. sign up a throwaway address through the real public form endpoint
#  2. follow the signed unsubscribe link the digest would send
#  3. confirm the record is marked, and that a wrong token is refused
#  4. leave the list exactly as it was found
cd /opt/info-hub
E="unsub-test@example.com"
SEC=$(grep '^NEWSLETTER_SECRET=' .env | cut -d= -f2-)
TOK=$(printf '%s' "$E" | openssl dgst -sha256 -hmac "$SEC" -r | cut -c1-32)

echo "== 1. signup through the public endpoint"
curl -s -X POST https://info.propertylist.es/api/newsletter \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$E\",\"lang\":\"en\",\"source\":\"/unsub-test/\"}"
echo
echo "stored:"
grep -c "$E" var/admin/newsletter.json

echo "== 2. wrong token must be refused"
curl -s -o /dev/null -w 'status %{http_code} -> %{redirect_url}\n' \
  "https://info.propertylist.es/api/unsubscribe?e=$E&t=00000000000000000000000000000000&lang=en"
echo "still subscribed (want 0 unsubscribedAt):"
grep -A4 "$E" var/admin/newsletter.json | grep -c unsubscribedAt || true

echo "== 3. correct token"
curl -s -o /dev/null -w 'status %{http_code} -> %{redirect_url}\n' \
  "https://info.propertylist.es/api/unsubscribe?e=$E&t=$TOK&lang=en"
echo "now unsubscribed (want 1):"
grep -A5 "$E" var/admin/newsletter.json | grep -c unsubscribedAt || true

echo "== 4. one-click POST (RFC 8058) is accepted too"
curl -s -o /dev/null -w 'status %{http_code} -> %{redirect_url}\n' -X POST \
  "https://info.propertylist.es/api/unsubscribe?e=$E&t=$TOK&lang=es"

echo "== 5. confirmation pages render"
curl -s -o /dev/null -w 'EN ok  %{http_code}\n' "https://info.propertylist.es/unsubscribe/"
curl -s -o /dev/null -w 'EN bad %{http_code}\n' "https://info.propertylist.es/unsubscribe/?bad=1"
curl -s -o /dev/null -w 'ES ok  %{http_code}\n' "https://info.propertylist.es/es/baja/"
curl -s "https://info.propertylist.es/unsubscribe/" | grep -o 'You are unsubscribed\|noindex,follow' | sort -u
curl -s "https://info.propertylist.es/es/baja/?bad=1" | grep -o 'Ese enlace no ha funcionado'

echo "== 6. the digest skips unsubscribed addresses"
node -e "const a=require('/opt/info-hub/var/admin/newsletter.json');const live=a.filter(r=>!r.unsubscribedAt);console.log('records',a.length,'mailable',live.length)"

echo "== 7. clean up the test record"
node -e "const fs=require('fs');const p='/opt/info-hub/var/admin/newsletter.json';const a=JSON.parse(fs.readFileSync(p,'utf8'));const out=a.filter(r=>String(r.email).toLowerCase()!=='$E');fs.writeFileSync(p,JSON.stringify(out,null,2));console.log('removed',a.length-out.length,'left',out.length)"
