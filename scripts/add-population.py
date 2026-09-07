"""Attach municipal population to the map data so 'coverage gaps' can be measured
per head of population rather than as a raw listing count.

Raw counts only ever restate size: Marbella has 1,401 listings and Manilva 47, so an
inverted count map just says 'Manilva is smaller'. Per 10,000 residents it says
something useful - Malaga city has 597,000 people and 75 listings, which is the real hole.

Source: OpenStreetMap admin boundaries (population tag).
  Spain    - admin_level 8 is the municipio and carries ine:municipio.
  Portugal - admin_level 7 is the concelho (8 is the freguesia, too granular).

Municipalities join on the INE code. Town dots join on a normalised name AND must sit
within MAX_KM of the matched municipality centre, so a coincidental name match in another
province cannot silently produce a wrong population.
"""
import io, json, math, os, re, subprocess, sys, time, unicodedata, urllib.parse
import atomicjson

ROOT = "/opt/info-hub"
OUTDIRS = [ROOT + "/public/map", ROOT + "/dist/client/map"]
CACHE = ROOT + "/scripts/popcache.json"
CACHE_MAX_AGE = 30 * 86400
MAX_KM = 30.0

# One mega-query over all Iberia times out, so ask region by region and merge.
# (south, west, north, east) - Spanish municipios are admin_level 8, Portuguese
# concelhos are 7, so Portugal gets its own box at its own level.
BOXES = [
    ("Andalucia + Murcia",  (36.0, -7.6, 38.9, -0.6), 8),
    ("Levante",             (37.8, -1.7, 40.9,  0.7), 8),
    ("Balearics",           (38.5,  1.1, 40.2,  4.4), 8),
    ("Madrid + centre",     (38.4, -5.2, 41.4, -2.4), 8),
    ("Catalonia",           (40.5,  0.1, 42.9,  3.4), 8),
    ("Navarra + north",     (41.8, -3.4, 43.5, -0.6), 8),
    ("Algarve (concelhos)", (36.9, -9.1, 38.3, -7.2), 7),
]

ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter"]


def q_for(box, lvl):
    s, w, n, e = box
    return ("[out:json][timeout:600];"
            'rel["boundary"="administrative"]["admin_level"="%d"]["population"]'
            "(%s,%s,%s,%s);out tags center;" % (lvl, s, w, n, e))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def keys(name):
    """La Linea de la Concepcion and Linea de la Concepcion, La collapse to one key."""
    n = norm(name)
    out = {n}
    m = re.match(r"^(.*), (el|la|los|las|o|a|os|as)$", n)
    if m:
        n = m.group(2) + " " + m.group(1)
        out.add(n)
    for art in ("el ", "la ", "los ", "las ", "o ", "a "):
        if n.startswith(art):
            out.add(n[len(art):])
    return out


def km(a_lon, a_lat, b_lon, b_lat):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _post(url, query):
    """Shell out to curl.

    overpass-api.de 406s every custom User-Agent we tried - it appears to allow only
    bare client strings like curl/7.88.1. Rather than spoof one from urllib, use the
    real curl binary, which is a legitimate client and is what the allowlist expects.
    """
    r = subprocess.run(["curl", "-sS", "--max-time", "620", "-X", "POST",
                        "--data-urlencode", "data=" + query, url],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("curl exit %d: %s" % (r.returncode, r.stderr.decode()[:200]))
    body = r.stdout.decode("utf-8", "replace")
    if not body.lstrip().startswith("{"):
        raise RuntimeError("non-JSON reply: %s" % body[:200])
    return json.loads(body)


def fetch_osm():
    """Merge every region. A region that fails on all endpoints is reported rather than
    silently dropped - a missing region would look like 'no population data' on the map."""
    elements, failed = [], []
    for label, box, lvl in BOXES:
        got = None
        for url in ENDPOINTS:
            try:
                got = _post(url, q_for(box, lvl))
                break
            except Exception as e:
                print("  %s via %s failed: %s" % (label, url.split("/")[2], e))
                time.sleep(4)
        if got is None:
            failed.append(label)
            continue
        print("  %-22s %4d municipalities" % (label, len(got.get("elements", []))))
        elements += got.get("elements", [])
        time.sleep(2)
    if failed:
        print("  WARNING regions not fetched: %s" % ", ".join(failed))
    if not elements:
        raise RuntimeError("overpass returned nothing for any region")
    return {"elements": elements}


def load_population():
    if os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < CACHE_MAX_AGE:
        c = json.load(io.open(CACHE, encoding="utf-8"))
        print("population cache hit (%d municipalities with INE)" % len(c["by_ine"]))
        return c
    j = fetch_osm()
    by_ine, by_name = {}, {}
    for e in j.get("elements", []):
        t = e.get("tags", {})
        name = t.get("name")
        raw = re.sub(r"[^0-9]", "", (t.get("population") or ""))
        ctr = e.get("center") or {}
        if not name or not raw or "lat" not in ctr:
            continue
        pop = int(raw)
        if pop < 200:
            continue
        rec = {"name": name, "pop": pop, "ine": t.get("ine:municipio"),
               "lat": ctr["lat"], "lon": ctr["lon"]}
        if rec["ine"]:
            by_ine[rec["ine"]] = rec
        for k in keys(name):
            if k not in by_name or by_name[k]["pop"] < pop:
                by_name[k] = rec
    c = {"by_ine": by_ine, "by_name": by_name}
    json.dump(c, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    print("population: %d municipalities with INE, %d name keys" % (len(by_ine), len(by_name)))
    return c



REVCACHE = ROOT + "/scripts/revgeocache.json"


def reverse_municipality(lon, lat, cache):
    """Ask OSM which municipality actually contains this point.

    Used only for dots whose name matched no municipality. Guessing a parent by name would
    risk attaching the wrong population, and a wrong coverage figure is worse than none.
    """
    key = "%.4f,%.4f" % (lon, lat)
    if key in cache:
        return cache[key]
    url = ("https://nominatim.openstreetmap.org/reverse?"
           + urllib.parse.urlencode({"lat": lat, "lon": lon, "format": "json",
                                     "zoom": 10, "addressdetails": 1}))
    val = None
    try:
        r = subprocess.run(["curl", "-sS", "--max-time", "25",
                            "-H", "User-Agent: PropertyList-map/1.0", url],
                           capture_output=True)
        if r.returncode == 0 and r.stdout.strip().startswith(b"{"):
            a = (json.loads(r.stdout.decode()) or {}).get("address") or {}
            for f in ("municipality", "city", "town", "village", "county"):
                if a.get(f):
                    val = a[f]
                    break
    except Exception:
        val = None
    cache[key] = val
    time.sleep(1.05)   # Nominatim usage policy
    return val


def per10k(n, pop):
    return round(n / pop * 10000.0, 1) if pop else None


def main():
    pop = load_population()
    by_ine, by_name = pop["by_ine"], pop["by_name"]

    # --- the 8 municipality polygons, joined on INE ---
    mp = os.path.join(OUTDIRS[0], "map-data.json")
    md = json.load(io.open(mp, encoding="utf-8"))
    hit = 0
    for name, rec in md.get("municipalities", {}).items():
        r = by_ine.get(str(rec.get("ine") or "")) or by_name.get(norm(name))
        if not r:
            print("   no population for municipality %s" % name)
            continue
        rec["pop"] = r["pop"]
        rec["p10"] = per10k((rec.get("ops", {}).get("sale") or {}).get("n") or 0, r["pop"])
        hit += 1
    for d in OUTDIRS:
        if os.path.isdir(d):
            atomicjson.dump(md, os.path.join(d, "map-data.json"))
    print("municipalities matched: %d/%d" % (hit, len(md.get("municipalities", {}))))

    # --- the town dots: resolve each to a real municipality, then measure per municipality ---
    cp = os.path.join(OUTDIRS[0], "cities.json")
    cj = json.load(io.open(cp, encoding="utf-8"))
    try:
        revcache = json.load(io.open(REVCACHE, encoding="utf-8"))
    except Exception:
        revcache = {}
    before_cache = len(revcache)

    matched = far = nomatch = viarev = 0
    for f in cj["features"]:
        p = f["properties"]
        for k in ("pop", "p10", "covArea"):
            p.pop(k, None)
        if p.get("inside"):
            continue
        lon, lat = f["geometry"]["coordinates"]

        rec = None
        for k in keys(p["city"]):
            if k in by_name:
                cand = by_name[k]
                if km(lon, lat, cand["lon"], cand["lat"]) <= MAX_KM:
                    rec = cand
                    break
                far += 1

        # the name told us nothing useful - ask what actually contains this point
        if rec is None:
            muni = reverse_municipality(lon, lat, revcache)
            if muni:
                for k in keys(muni):
                    if k in by_name:
                        rec = by_name[k]
                        viarev += 1
                        break

        if rec is None:
            nomatch += 1
            continue
        p["pop"] = rec["pop"]
        p["covArea"] = rec["name"]
        matched += 1

    if len(revcache) != before_cache:
        json.dump(revcache, io.open(REVCACHE, "w", encoding="utf-8"), ensure_ascii=False)
        print("reverse-geocoded %d new points" % (len(revcache) - before_cache))

    # Coverage belongs to a municipality, not to a dot. Sum every dot that resolves to the
    # same municipality, plus that municipality's own polygon count where it has one, and
    # measure the total against one population.
    totals = {}
    for f in cj["features"]:
        p = f["properties"]
        if p.get("inside") or not p.get("covArea"):
            continue
        totals[p["covArea"]] = totals.get(p["covArea"], 0) + (p.get("n") or 0)
    for name, rec in md.get("municipalities", {}).items():
        r = by_ine.get(str(rec.get("ine") or "")) or by_name.get(norm(name))
        if r and r["name"] in totals:
            totals[r["name"]] += (rec.get("ops", {}).get("sale") or {}).get("n") or 0

    for f in cj["features"]:
        p = f["properties"]
        if p.get("inside") or not p.get("covArea"):
            continue
        p["p10"] = per10k(totals.get(p["covArea"], p.get("n") or 0), p["pop"])

    for d in OUTDIRS:
        if os.path.isdir(d):
            atomicjson.dump(cj, os.path.join(d, "cities.json"))
    drawn = len([f for f in cj["features"] if not f["properties"].get("inside")])
    print("town dots: %d measured (%d of them resolved by reverse geocoding), "
          "%d still unidentifiable (of %d drawn)" % (matched, viarev, nomatch, drawn))

    rows = [f["properties"] for f in cj["features"] if f["properties"].get("p10") is not None]
    rows += [dict(city=k, n=(v.get("ops", {}).get("sale") or {}).get("n") or 0,
                  pop=v["pop"], p10=v["p10"])
             for k, v in md.get("municipalities", {}).items() if v.get("p10") is not None]
    rows.sort(key=lambda x: x["p10"])
    print("")
    print("thinnest coverage per 10,000 residents:")
    for w in rows[:14]:
        print("   %-26s %5d listings  %10s people  %6.1f per 10k"
              % (w["city"], w["n"], "{:,}".format(w["pop"]), w["p10"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
