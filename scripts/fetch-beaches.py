"""Pull named beaches from Overpass once, for the coasts our area guides cover.

Run on the Contabo box: overpass-api.de refuses connections from the info-hub droplet,
so the droplet gets a static file instead of calling this service at runtime.
"""
import json, urllib.request, urllib.parse, time, re

BOXES = [
    ('mainland-south', 35.90, -6.10, 37.30, -1.40),   # Cádiz -> Almería, covers all Costa del Sol areas
    ('mallorca',       39.20,  2.20, 40.00,  3.60),
    ('ibiza',          38.55,  1.10, 39.20,  1.75),
]

def fetch(bbox):
    _, s, w, n, e = bbox
    # Unnamed beaches matter: the whole Sotogrande shoreline is untagged in OSM, so a
    # named-only list would report its nearest beach as 5.2km away in the next town
    # instead of the 1.6km that is actually true.
    q = f"""[out:json][timeout:180];
(
  nwr["natural"="beach"]({s},{w},{n},{e});
  nwr["tourism"="beach_resort"]({s},{w},{n},{e});
);
out center;"""
    url = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={
        'user-agent': 'PropertyListInfoHub/1.0 (one-off dataset build)',
        'accept': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=240))

seen = {}
for box in BOXES:
    name = box[0]
    for attempt in range(1, 4):
        try:
            data = fetch(box)
            break
        except Exception as e:
            print(f'  {name}: attempt {attempt} failed ({e})')
            data = None
            time.sleep(20)
    if not data:
        raise SystemExit(f'{name}: could not fetch, aborting rather than shipping a partial list')

    added = 0
    for el in data.get('elements', []):
        lat = el.get('lat', (el.get('center') or {}).get('lat'))
        lon = el.get('lon', (el.get('center') or {}).get('lon'))
        if lat is None or lon is None:
            continue
        nm = ((el.get('tags') or {}).get('name') or '').strip()
        # dog and nudist beaches are real beaches and count for distance, but naming one
        # as the headline beach of a luxury area guide reads badly - keep them unnamed
        if nm and re.search(r'canina|nudist|perro', nm, re.I):
            nm = ''
        # collapse duplicates: the same beach is often mapped as both a node and a way
        key = (nm.lower(), round(float(lat), 3), round(float(lon), 3))
        if key in seen:
            continue
        rec = {'lat': round(float(lat), 5), 'lon': round(float(lon), 5)}
        if nm:
            rec['name'] = nm
        seen[key] = rec
        added += 1
    print(f'  {name}: {added} beaches')
    time.sleep(5)

out = sorted(seen.values(), key=lambda b: (b['lat'], b['lon']))
with open('/tmp/beaches.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(f'\ntotal {len(out)} named beaches -> /tmp/beaches.json')
for b in out[:5]:
    print('  sample:', b['name'], b['lat'], b['lon'])
