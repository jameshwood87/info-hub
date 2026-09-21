"""Print the geocoded area guides as id|name|municipality|region|lat lon| for the
Then & Now generator. Run on the droplet from the repo root."""
import json

meta = json.load(open("var/admin/kb-meta.json", encoding="utf-8"))
for key, item in meta.get("items", {}).items():
    geo = item.get("neighbourhoodGeo") if isinstance(item, dict) else None
    if isinstance(geo, dict) and geo.get("lat") and geo.get("lon"):
        print(f'{key}|{geo.get("placeName")}|{geo.get("municipality")}|{geo.get("region")}|{geo["lat"]:.5f} {geo["lon"]:.5f}|')
