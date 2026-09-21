# Then & Now images

Aerial photos of every area guide from Spain's national mapping flights (IGN), shown by
`src/components/ThenNow.astro` on the area guides and used as their share images.

The images are **gitignored** (about 100 MB). Only `public/then-now/manifest.json` is tracked.
Rebuild them with these scripts; never hand-edit an image.

## Source and licence

- WMS `https://www.ign.es/wms/pnoa-historico`. Layers used: `AMS_1956-1957` (American flight
  Serie B), `Interministerial_1973-1986`, `Nacional_1981-1986`, `PNOA2004`...`PNOA2024`.
- IGN licence (Orden FOM/2807/2015): free including commercial use, CC-BY 4.0. Cite
  `<product> <date> CC-BY 4.0 ign.es` at the foot of the viewer. Derived images (the share
  cards, social composites) are prefixed `Obra derivada de`.
- Not every year covers every place: Malaga was flown in 2022 but not 2021, 2023 or 2024, so the
  generator picks the latest non-blank year per area and labels it with its real year.

## Rebuild (runs on the Contabo box, which has the Pillow venv)

```bash
# 1. export the geocoded area list from the droplet (kb-meta neighbourhoodGeo)
python3 scripts/then-now/export-areas.py > areas.psv        # on the droplet
# 2. on Contabo, in the working dir (TN_DIR, default /tmp/tn) with areas.psv + overrides.json
/root/phash-venv/bin/python gen.py "$TN_DIR/final"          # frames: 4 eras x 1600/800 WebP + manifest
/root/phash-venv/bin/python og.py  "$TN_DIR/final"          # share cards og-en.jpg / og-es.jpg
#    fonts/ must hold Inter[opsz,wght].ttf, Lora[wght].ttf (Google Fonts) and logo.png
# 3. copy final/* to public/then-now/ on the droplet, then deploy
```

`--only slug,slug` regenerates just those areas and merges them into the manifest.

## Framing rules (reviewed by eye 22-09-26)

- Default frame: 3.2 km across, 3:2, centred on the area's geocode.
- `overrides.json` re-centres areas whose geocode lands in the wrong place (Marbella sat 7 km
  east in the hills, Mallorca on Palma airport, Ibiza in the island's centre) and forces an era
  layer where a flight only partly covers the frame (Calahonda, Riviera del Sol and Cabopino have
  empty 1973-86 frames, so they use 1981-86).
- The 2000s era must be colour: 2004 is black and white over eastern Malaga, so Torremolinos,
  El Limonar, Nerja and Benalmadena use 2008 (Pedregalejo 2006).
- Always look at a contact sheet (`gen.py ... --sheet`) before shipping new frames. The blank
  check catches white and black no-data, not the flat grey some old flights return.
