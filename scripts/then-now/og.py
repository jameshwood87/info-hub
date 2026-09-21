"""Share-preview (og:image) cards for Then & Now: 1200x630, one geographic frame split
down the middle - earliest era left, latest right. EN and ES variants per area.
Usage: og.py <finaldir> [--only slug,slug]"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

TN = os.environ.get("TN_DIR", "/tmp/tn")  # working dir holding fonts/ (Inter, Lora, logo.png) and final/
D = sys.argv[1] if len(sys.argv) > 1 else f"{TN}/final"
ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
F = f"{TN}/fonts"
W, H = 1200, 630
TEAL_ON_DARK = (47, 227, 203)

def font(name, size, weight):
    f = ImageFont.truetype(f"{F}/{name}", size)
    try:
        f.set_variation_by_axes([weight] if "Lora" in name else [14, weight] if "opsz" in name else [weight])
    except Exception:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f

INTER = "Inter[opsz,wght].ttf"
LORA = "Lora[wght].ttf"
logo = Image.open(f"{F}/logo.png").convert("RGBA")

def frame(path):
    im = Image.open(path).convert("RGB")          # 1600x1067, 3:2
    target_h = round(im.width * H / W)             # same geographic band for both eras
    top = (im.height - target_h) // 2
    return im.crop((0, top, im.width, top + target_h)).resize((W, H), Image.LANCZOS)

def pill(d, xy, text, f, anchor_right=False):
    x, y = xy
    tw = d.textlength(text, font=f)
    pad_x, pad_y, hgt = 18, 9, f.size + 18
    x0 = x - tw - 2 * pad_x if anchor_right else x
    d.rounded_rectangle((x0, y, x0 + tw + 2 * pad_x, y + hgt), radius=hgt // 2, fill=(11, 27, 34, 200))
    d.text((x0 + pad_x, y + pad_y - 2), text, font=f, fill=(255, 255, 255))

manifest = json.load(open(f"{D}/manifest.json", encoding="utf-8"))
for slug, rec in manifest["areas"].items():
    if ONLY and slug not in ONLY:
        continue
    eras = rec["eras"]
    first_key = next(k for k in ("1956", "7080", "2000s") if k in eras)
    then_e, now_e = eras[first_key], eras["now"]
    left, right = frame(f"{D}/{slug}/{first_key}-1600.webp"), frame(f"{D}/{slug}/now-1600.webp")
    for lang in ("en", "es"):
        card = right.copy()
        card.paste(left.crop((0, 0, W // 2, H)), (0, 0))
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        for i in range(210):  # bottom scrim for legibility
            a = int(205 * (i / 210) ** 1.6)
            d.line([(0, H - 210 + i), (W, H - 210 + i)], fill=(8, 18, 22, a))
        d.rectangle((W // 2 - 2, 0, W // 2 + 1, H), fill=(255, 255, 255, 255))
        cx, cy, r = W // 2, 250, 30
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
        d.polygon([(cx - 17, cy), (cx - 6, cy - 9), (cx - 6, cy + 9)], fill=(11, 27, 34, 255))
        d.polygon([(cx + 17, cy), (cx + 6, cy - 9), (cx + 6, cy + 9)], fill=(11, 27, 34, 255))
        lab = font(INTER, 30, 800)
        pill(d, (26, 24), then_e[lang], lab)
        pill(d, (W - 26, 24), now_e[lang], lab, anchor_right=True)
        eyebrow = "THEN & NOW" if lang == "en" else "ANTES Y AHORA"
        d.text((34, H - 172), eyebrow, font=font(INTER, 21, 800), fill=TEAL_ON_DARK + (255,))
        d.text((32, H - 142), rec["name"], font=font(LORA, 60, 700), fill=(255, 255, 255, 255))
        conj = "y"
        credit = f"Obra derivada de {then_e['credit']} {conj} {now_e['credit']}, CC-BY 4.0 ign.es"
        d.text((34, H - 44), credit, font=font(INTER, 16, 500), fill=(255, 255, 255, 215))
        card = Image.alpha_composite(card.convert("RGBA"), ov)
        chip_h = 64
        lg = logo.copy()
        lg.thumbnail((230, chip_h - 20))
        chip_w = lg.width + 32
        chip = Image.new("RGBA", (chip_w, chip_h), (255, 255, 255, 0))
        ImageDraw.Draw(chip).rounded_rectangle((0, 0, chip_w - 1, chip_h - 1), radius=14, fill=(255, 255, 255, 245))
        chip.alpha_composite(lg, ((chip_w - lg.width) // 2, (chip_h - lg.height) // 2))
        card.alpha_composite(chip, (W - chip_w - 28, H - chip_h - 72))
        card.convert("RGB").save(f"{D}/{slug}/og-{lang}.jpg", quality=86, optimize=True)
    print("og", slug)
