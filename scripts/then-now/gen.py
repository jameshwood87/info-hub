"""Final Then & Now frames for every area guide.
Picks each era per area on the fly (blank + colour checks), fetches 1800x1200,
writes WebP at 1600 and 800 px plus a manifest the Astro component reads.
Usage: gen2.py <outdir> [--only slug,slug] [--sheet]"""
import colorsys, io, json, math, os, re, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image, ImageDraw, ImageFont

WMS = "https://www.ign.es/wms/pnoa-historico"
TN = os.environ.get("TN_DIR", "/tmp/tn")  # working dir holding areas.psv, overrides.json, final/
OUT = sys.argv[1] if len(sys.argv) > 1 else f"{TN}/final"
ONLY = None
if "--only" in sys.argv:
    ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(","))
SHEET = "--sheet" in sys.argv
ASPECT = 3 / 2
FULL_W, FULL_H = 1800, 1200
SIZES = [1600, 800]
DEFAULT_GROUND_W = 3200.0
ov = json.load(open(f"{TN}/overrides.json", encoding="utf-8"))
era_ov = ov.get("_eras", {})

CANDIDATES = {
    "1956": ["AMS_1956-1957"],
    "7080": ["Interministerial_1973-1986", "Nacional_1981-1986"],
    "2000s": [f"PNOA{y}" for y in range(2004, 2011)],
    "now": [f"PNOA{y}" for y in range(2024, 2015, -1)],
}
NEED_COLOUR = {"2000s"}  # every PNOA flight since 2016 is colour; pale ones (Alhaurin 2022) failed the check

def label(layer):
    if layer.startswith("AMS"):
        return {"en": "1956", "es": "1956", "credit": "Vuelo Americano Serie B 1956-1957"}
    if layer.startswith("Interministerial"):
        return {"en": "1970s-80s", "es": "años 70-80", "credit": "Vuelo Interministerial 1973-1986"}
    if layer.startswith("Nacional"):
        return {"en": "1980s", "es": "años 80", "credit": "Vuelo Nacional 1981-1986"}
    y = layer.replace("PNOA", "")
    return {"en": y, "es": y, "credit": f"PNOA {y}"}

def slugify(s):
    s = re.sub(r"\s*\(.*?\)\s*", " ", s)
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def bbox3857(lat, lon, ground_w):
    R = 6378137.0
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    hw = ground_w / math.cos(math.radians(lat)) / 2
    return (x - hw, y - hw / ASPECT, x + hw, y + hw / ASPECT)

def get(layer, bb, w, h):
    b = ",".join(f"{v:.1f}" for v in bb)
    url = f"{WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS={layer}&STYLES=&SRS=EPSG:3857&BBOX={b}&WIDTH={w}&HEIGHT={h}&FORMAT=image/jpeg"
    for _ in range(3):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200 and r.content.startswith(b"\xff\xd8"):
                return Image.open(io.BytesIO(r.content)).convert("RGB")
        except Exception:
            pass
    return None

def blank_share(img):
    g = img.convert("L").resize((96, 64))
    px = list(g.get_flattened_data()) if hasattr(g, "get_flattened_data") else list(g.getdata())
    return sum(1 for p in px if p >= 250 or p <= 5) / len(px)

def saturation(img):
    s = img.resize((64, 43))
    px = list(s.get_flattened_data()) if hasattr(s, "get_flattened_data") else list(s.getdata())
    return sum(colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[1] for r, g, b in px) / len(px)

def pick(slug, era, bb):
    cands = [era_ov[slug][era]] if era in era_ov.get(slug, {}) else CANDIDATES[era]
    for layer in cands:
        t = get(layer, bb, 240, 160)
        if t is None or blank_share(t) > 0.15:
            continue
        if era in NEED_COLOUR and saturation(t) < 0.08:
            continue
        return layer
    return None

def build(row):
    aid, name, lat, lon = row
    slug = slugify(name)
    o = ov.get(slug, {})
    lat, lon, gw = o.get("lat", lat), o.get("lon", lon), o.get("w", DEFAULT_GROUND_W)
    bb = bbox3857(lat, lon, gw)
    rec = {"name": name, "lat": lat, "lon": lon, "groundWidthM": gw, "eras": {}}
    for era in ["1956", "7080", "2000s", "now"]:
        layer = pick(slug, era, bb)
        if not layer:
            continue
        im = get(layer, bb, FULL_W, FULL_H)
        if im is None:
            continue
        os.makedirs(f"{OUT}/{slug}", exist_ok=True)
        for w in SIZES:
            im.resize((w, round(w / ASPECT)), Image.LANCZOS).save(f"{OUT}/{slug}/{era}-{w}.webp", "WEBP", quality=74, method=6)
        rec["eras"][era] = {"layer": layer, **label(layer)}
    return slug, rec

rows = []
for line in open(f"{TN}/areas.psv", encoding="utf-8"):
    p = line.rstrip("\n").split("|")
    lat, lon = map(float, p[4].split())
    if ONLY and slugify(p[1]) not in ONLY:
        continue
    rows.append((p[0], p[1], lat, lon))

with ThreadPoolExecutor(max_workers=6) as ex:
    built = dict(ex.map(build, rows))

mpath = f"{OUT}/manifest.json"
manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"areas": {}}
manifest["areas"].update(built)
manifest["attribution"] = {
    "licence": "CC-BY 4.0",
    "holder": "ign.es",
    "note": "Instituto Geográfico Nacional. Composites carry 'Obra derivada de' per the IGN licence.",
}
json.dump(manifest, open(mpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for slug, rec in built.items():
    print(f'{slug:24} ' + "  ".join(f'{e}:{v["layer"]}' for e, v in rec["eras"].items()))

if SHEET:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
    items = list(built.items())
    tw, th, lab = 300, 200, 22
    sheet = Image.new("RGB", (tw * 4 + 30, (th + lab) * len(items) + 6), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for ri, (slug, rec) in enumerate(items):
        y = ri * (th + lab) + 4
        d.text((6, y), f'{rec["name"]}  ' + " / ".join(v["en"] for v in rec["eras"].values()), fill=(0, 0, 0), font=font)
        for ci, era in enumerate(["1956", "7080", "2000s", "now"]):
            fp = f"{OUT}/{slug}/{era}-800.webp"
            if os.path.exists(fp):
                sheet.paste(Image.open(fp).resize((tw, th)), (6 + ci * (tw + 6), y + lab))
    sheet.save(f"{OUT}/sheet-check.jpg", quality=80)
