#!/usr/bin/env python3
"""Rebuild public/map/cities.json - every listing on the network, aggregated by town.

Pulls the whole shared catalogue from the Website API (api.propertylist.es, page size is
locked at 10 server-side, so this is ~450 requests) and buckets by province+city. Town
coordinates come from scripts/geocache.json; any town not in the cache is geocoded once
via Nominatim at 1 req/sec and written back, so steady-state runs make zero geocode calls.

Writes to public/map/ and, if present, the live dist/client/map/ so the page updates
without a rebuild. Run nightly from build-map-data.py.
"""
import json, os, time, urllib.request, urllib.parse, collections, statistics, sys

ROOT = "/opt/info-hub"
ENV = os.path.join(ROOT, ".env")
CACHE = os.path.join(ROOT, "scripts", "geocache.json")
OUTDIRS = [os.path.join(ROOT, "public", "map"), os.path.join(ROOT, "dist", "client", "map")]
UA = "PropertyList-map/1.0 (+https://info.propertylist.es/map)"

REGION = {
    "MA": "Málaga, Spain", "CA": "Cádiz, Spain", "A": "Alicante, Spain",
    "PM": "Balearic Islands, Spain", "GR": "Granada, Spain", "AL": "Almería, Spain",
    "V": "Valencia, Spain", "CO": "Córdoba, Spain", "M": "Madrid, Spain",
    "MU": "Murcia, Spain", "SE": "Sevilla, Spain", "CR": "Ciudad Real, Spain",
    "GI": "Girona, Spain", "NA": "Navarra, Spain", "H": "Huelva, Spain",
    "J": "Jaén, Spain", "T": "Tarragona, Spain", "B": "Barcelona, Spain",
    "PTFAR": "Algarve, Portugal", "PTLIS": "Lisbon, Portugal",
}
GEO_COUNTRY = {"PTFAR": "Portugal", "PTLIS": "Portugal"}
GEO_PROV = {
    "MA": "Malaga", "CA": "Cadiz", "A": "Alicante", "PM": "Baleares", "GR": "Granada",
    "AL": "Almeria", "V": "Valencia", "CO": "Cordoba", "M": "Madrid", "MU": "Murcia",
    "SE": "Sevilla", "CR": "Ciudad Real", "GI": "Girona", "NA": "Navarra", "H": "Huelva",
    "J": "Jaen", "T": "Tarragona", "B": "Barcelona", "PTFAR": "Faro", "PTLIS": "Lisboa",
}


def env_key(name):
    try:
        for line in open(ENV, encoding="utf-8"):
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


def api(path, key, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(
                "https://api.propertylist.es" + path,
                headers={"Authorization": "Bearer " + key, "User-Agent": UA, "Accept": "application/json"},
            )
            return json.loads(urllib.request.urlopen(req, timeout=45).read().decode())
        except Exception:
            time.sleep(1.5 * (i + 1))
    return {}


def geocode(city, prov, cache, key):
    if key in cache:
        return cache[key]
    q = "%s, %s, %s" % (city, GEO_PROV.get(prov, prov), GEO_COUNTRY.get(prov, "Spain"))
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1}
    )
    val = None
    try:
        r = json.loads(
            urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=25).read().decode()
        )
        if r:
            val = [round(float(r[0]["lon"]), 5), round(float(r[0]["lat"]), 5)]
    except Exception:
        val = None
    cache[key] = val
    time.sleep(1.05)  # Nominatim policy
    return val


def main():
    key = env_key("PROPERTYLIST_WEBSITE_KEY")
    if not key:
        print("no PROPERTYLIST_WEBSITE_KEY in .env - aborting", file=sys.stderr)
        return 1

    listings, page = [], 1
    while True:
        j = api("/v2/properties?shared=true&page=%d" % page, key)
        d = j.get("data") or []
        listings += d
        total = j.get("total_count") or 0
        if not d or len(listings) >= total:
            break
        page += 1
        time.sleep(0.12)
    if not listings:
        print("no listings returned - keeping previous cities.json", file=sys.stderr)
        return 1
    print("fetched %d listings" % len(listings))

    agg = collections.defaultdict(lambda: {"n": 0, "prices": [], "psm": []})
    for p in listings:
        city = (p.get("city") or "").strip()
        prov = (p.get("province") or "").strip()
        if not city:
            continue
        a = agg[(prov, city)]
        a["n"] += 1
        price, build = p.get("for_sale_price"), p.get("build")
        if price:
            a["prices"].append(price)
        if price and build:
            a["psm"].append(price / build)

    cache = {}
    if os.path.exists(CACHE):
        try:
            cache = json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            cache = {}
    before = len(cache)

    feats, placed, total_n = [], 0, 0
    for (prov, city), a in agg.items():
        total_n += a["n"]
        xy = geocode(city, prov, cache, prov + "|" + city)
        if not xy:
            continue
        placed += a["n"]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": xy},
            "properties": {
                "city": city,
                "region": REGION.get(prov, prov),
                "n": a["n"],
                "median": int(statistics.median(a["prices"])) if a["prices"] else None,
                "psm": int(statistics.median(a["psm"])) if a["psm"] else None,
            },
        })
    feats.sort(key=lambda f: -f["properties"]["n"])

    if len(cache) != before:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"))
        print("geocoded %d new towns" % (len(cache) - before))

    payload = {"type": "FeatureCollection", "features": feats}
    for d in OUTDIRS:
        if os.path.isdir(d):
            json.dump(payload, open(os.path.join(d, "cities.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print("towns %d | listings placed %d/%d (%.1f%%)" % (len(feats), placed, total_n, 100.0 * placed / max(total_n, 1)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

    # attach notarial verified EUR/m2 to the town dots (Spain only, sample >= 30)
    try:
        import subprocess
        subprocess.run(["/usr/bin/python3","/opt/info-hub/scripts/add-verified.py"],timeout=1800)
    except Exception as e:
        print("verified pass skipped:",e)
