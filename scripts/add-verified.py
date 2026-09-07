"""Add the notarial verified EUR/m2 to the town dots, not just the 8 municipality polygons.

Guards:
  - Spain only. The Oracle returns a figure for Portuguese towns (Albufeira, Silves) with
    sample_size 0, labelled as the *Spanish* notarial register - that is meaningless, so
    Portugal is excluded rather than shown with a bogus number.
  - sample_size >= 30, otherwise the figure is too thin to publish.
Both are recorded on the feature so the UI can explain absence honestly.
"""
import io, json, os, time, urllib.request
import atomicjson

ROOT = "/opt/info-hub"
UA = "PropertyList-map/1.0 (+https://info.propertylist.es/map)"
MIN_SAMPLE = 30


def mcp(loc, tries=3):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": "area_market_summary",
                                  "arguments": {"location": loc, "search_type": "for-sale"}}}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(
                "https://mcp.propertylist.es/mcp", data=body,
                headers={"Content-Type": "application/json",
                         "Accept": "application/json, text/event-stream",
                         "User-Agent": UA, "MCP-Protocol-Version": "2025-06-18"})
            raw = urllib.request.urlopen(req, timeout=45).read().decode()
            if "data:" in raw[:14]:
                raw = "".join(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
            return json.loads(raw).get("result", {}).get("structuredContent") or {}
        except Exception:
            time.sleep(1.2 * (i + 1))
    return {}


def main():
    cp = os.path.join(ROOT, "public/map/cities.json")
    cj = json.load(io.open(cp, encoding="utf-8"))
    todo = [f for f in cj["features"] if not f["properties"].get("inside")]
    todo.sort(key=lambda f: -f["properties"]["n"])
    got = thin = pt = none = 0
    for f in todo:
        p = f["properties"]
        if "Portugal" in (p.get("region") or ""):
            p["vwhy"] = "pt"
            pt += 1
            continue
        # clear first, then set - otherwise a town that once verified keeps its old
        # price forever, and map.js checks `if (p.v)` before the vwhy explanation, so the
        # stale figure wins. Same pattern as add-inside.py and add-population.py.
        p.pop("v", None)
        p.pop("vn", None)
        p.pop("vwhy", None)
        r = mcp(p["city"])
        o = (r or {}).get("oracle") or {}
        if o.get("verified") and (o.get("sample_size") or 0) >= MIN_SAMPLE:
            p["v"] = o.get("verified_price_per_sqm")
            p["vn"] = o.get("sample_size")
            got += 1
        elif o.get("verified"):
            p["vwhy"] = "thin"
            thin += 1
        else:
            p["vwhy"] = "none"
            none += 1
        time.sleep(0.3)
    atomicjson.dump(cj, cp)
    d = os.path.join(ROOT, "dist/client/map/cities.json")
    if os.path.isdir(os.path.dirname(d)):
        json.dump(cj, io.open(d, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("towns checked: %d | verified: %d | too thin: %d | Portugal skipped: %d | no attestation: %d"
          % (len(todo), got, thin, pt, none))


if __name__ == "__main__":
    main()
