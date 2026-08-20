"""Tag each town dot with whether it falls inside one of the 8 municipality polygons.

Without this every town inside a drawn municipality is ALSO drawn as its own dot, so
Marbella appears twice with two different numbers (polygon 1,401 from the MCP including
suburbs, dot ~1,183 from the listing 'city' field).

This used to be a one-off script, so the first nightly rebuild after it ran silently
dropped the flag and the map double-counted - and, because the layer filters were
['!', ['get','inside']] and MapLibre's ! demands a boolean, ['!', null] threw and every
single dot vanished instead. It is now part of post_passes() in build-cities.py and must
run BEFORE add-verified.py and add-population.py, both of which skip 'inside' features.
"""
import io, json, os, sys

ROOT = "/opt/info-hub"
OUTDIRS = [ROOT + "/public/map", ROOT + "/dist/client/map"]


def rings(geom):
    """Yield every outer ring of a Polygon or MultiPolygon."""
    t = geom.get("type")
    if t == "Polygon":
        if geom["coordinates"]:
            yield geom["coordinates"][0]
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            if poly:
                yield poly[0]


def in_ring(x, y, ring):
    """Standard ray casting. Counts crossings of a horizontal ray to the right of (x, y)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def main():
    gp = os.path.join(OUTDIRS[0], "municipalities.geojson")
    cp = os.path.join(OUTDIRS[0], "cities.json")
    if not os.path.exists(gp):
        print("municipalities.geojson missing - cannot tag 'inside', aborting rather than "
              "leaving the map double-counted")
        return 1

    polys = []
    for f in json.load(io.open(gp, encoding="utf-8"))["features"]:
        name = f["properties"].get("name")
        for ring in rings(f["geometry"]):
            polys.append((name, ring, bbox(ring)))
    if not polys:
        print("no polygons parsed - aborting")
        return 1

    cj = json.load(io.open(cp, encoding="utf-8"))
    inside = 0
    for f in cj["features"]:
        p = f["properties"]
        p["inside"] = False
        p.pop("muni", None)
        c = (f.get("geometry") or {}).get("coordinates")
        if not c or c[0] is None:
            continue
        x, y = c[0], c[1]
        for name, ring, bb in polys:
            if x < bb[0] or x > bb[2] or y < bb[1] or y > bb[3]:
                continue          # cheap bbox reject before the ring walk
            if in_ring(x, y, ring):
                p["inside"] = True
                p["muni"] = name
                inside += 1
                break

    for d in OUTDIRS:
        if os.path.isdir(d):
            json.dump(cj, io.open(os.path.join(d, "cities.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))

    total = len(cj["features"])
    listings_in = sum(f["properties"]["n"] for f in cj["features"] if f["properties"]["inside"])
    listings_all = sum(f["properties"]["n"] for f in cj["features"])
    print("inside-polygon tagging: %d of %d towns inside (%d of %d listings); %d drawn as dots"
          % (inside, total, listings_in, listings_all, total - inside))
    if inside == 0:
        print("WARNING: nothing matched a polygon - the map will double-count. Check that "
              "municipalities.geojson still has valid geometry.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
