"""Atomic JSON writes for the map data files.

These files are served live. Writing them in place leaves a window in which a browser can
read a half-written file: map.js does fetch(...).then(r => r.json()) with an empty catch,
so a truncated read silently drops the whole town-dot layer for that visitor. Writing to a
temp file in the same directory and os.replace()-ing is atomic on the same filesystem, so
a reader sees either the old file or the new one and never a partial one.
"""
import io, json, os


def dump(obj, path, **kw):
    kw.setdefault("ensure_ascii", False)
    kw.setdefault("separators", (",", ":"))
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, **kw)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
