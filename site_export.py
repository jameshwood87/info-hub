import argparse
import hashlib
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_UA = "PropertyListInfoHubRebuildBot/1.0 (+https://info.propertylist.es)"


def _mkdirp(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def fetch(url: str, *, user_agent: str, timeout_s: int, retries: int, backoff_s: float) -> tuple[int, str, bytes]:
    last_exc = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout_s) as r:
                return r.status, r.geturl(), r.read()
        except Exception as e:
            last_exc = e
            if attempt >= retries:
                break
            sleep_s = backoff_s * (2**attempt) * (0.7 + random.random() * 0.6)
            time.sleep(sleep_s)
    raise last_exc  # type: ignore[misc]


def parse_sitemap(xml_bytes: bytes) -> dict:
    xml_text = xml_bytes.decode("utf-8", "replace").lstrip()
    xml_bytes = xml_text.encode("utf-8", "replace")
    root = ET.fromstring(xml_bytes)

    ns = {
        "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
        "xhtml": "http://www.w3.org/1999/xhtml",
        "image": "http://www.google.com/schemas/sitemap-image/1.1",
    }

    if root.tag.endswith("sitemapindex"):
        sitemaps = []
        for sm in root.findall("sm:sitemap", ns):
            loc = sm.findtext("sm:loc", default="", namespaces=ns).strip()
            lastmod = sm.findtext("sm:lastmod", default="", namespaces=ns).strip()
            if loc:
                sitemaps.append({"loc": loc, "lastmod": lastmod})
        return {"type": "index", "sitemaps": sitemaps}

    if root.tag.endswith("urlset"):
        urls = []
        for u in root.findall("sm:url", ns):
            loc = u.findtext("sm:loc", default="", namespaces=ns).strip()
            lastmod = u.findtext("sm:lastmod", default="", namespaces=ns).strip()

            alternates = []
            for a in u.findall("xhtml:link", ns):
                rel = (a.attrib.get("rel") or "").strip()
                hreflang = (a.attrib.get("hreflang") or "").strip()
                href = (a.attrib.get("href") or "").strip()
                if rel == "alternate" and hreflang and href:
                    alternates.append({"hreflang": hreflang, "href": href})

            images = []
            for img in u.findall("image:image", ns):
                img_loc = img.findtext("image:loc", default="", namespaces=ns).strip()
                if img_loc:
                    images.append(img_loc)

            if loc:
                urls.append(
                    {
                        "loc": loc,
                        "lastmod": lastmod,
                        "alternates": alternates,
                        "images": images,
                    }
                )
        return {"type": "urlset", "urls": urls}

    return {"type": "unknown"}


_RE_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_RE_META_DESC = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
    re.IGNORECASE | re.DOTALL,
)
_RE_CANONICAL = re.compile(
    r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\'](.*?)["\']',
    re.IGNORECASE | re.DOTALL,
)
_RE_HREFLANG = re.compile(
    r'<link[^>]+rel=["\']alternate["\'][^>]+hreflang=["\'](.*?)["\'][^>]+href=["\'](.*?)["\']',
    re.IGNORECASE | re.DOTALL,
)
_RE_LDJSON = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def extract_meta(html: str) -> dict:
    title = (_RE_TITLE.search(html) or [None, ""])[1]
    title = re.sub(r"\s+", " ", title).strip()

    desc = (_RE_META_DESC.search(html) or [None, ""])[1]
    desc = re.sub(r"\s+", " ", desc).strip()

    canonical = (_RE_CANONICAL.search(html) or [None, ""])[1].strip()

    hreflangs = []
    for m in _RE_HREFLANG.finditer(html):
        hreflang = m.group(1).strip()
        href = m.group(2).strip()
        if hreflang and href:
            hreflangs.append({"hreflang": hreflang, "href": href})

    ldjson_raw = [m.group(1).strip() for m in _RE_LDJSON.finditer(html)]
    ldjson = []
    for block in ldjson_raw:
        try:
            ldjson.append(json.loads(block))
        except Exception:
            ldjson.append({"_raw": block})

    return {
        "title": title,
        "description": desc,
        "canonical": canonical,
        "hreflangs": hreflangs,
        "ldjson": ldjson,
    }


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://info.propertylist.es", help="Base origin to crawl")
    ap.add_argument("--out", default="export", help="Output directory")
    ap.add_argument("--user-agent", default=DEFAULT_UA)
    ap.add_argument("--timeout-s", type=int, default=40)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--backoff-s", type=float, default=1.2)
    ap.add_argument("--delay-ms", type=int, default=250)
    ap.add_argument("--max-pages", type=int, default=0, help="0 = no limit")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    root_sitemap = f"{base}/sitemap.xml"

    out_dir = os.path.abspath(args.out)
    html_dir = os.path.join(out_dir, "html")
    _mkdirp(out_dir)
    _mkdirp(html_dir)

    status, final_url, xml_bytes = fetch(
        root_sitemap,
        user_agent=args.user_agent,
        timeout_s=args.timeout_s,
        retries=args.retries,
        backoff_s=args.backoff_s,
    )
    if status >= 400:
        raise RuntimeError(f"Failed to fetch root sitemap: {status} {final_url}")

    parsed = parse_sitemap(xml_bytes)
    if parsed.get("type") != "index":
        raise RuntimeError("Root sitemap is not a sitemap index")

    child_sitemaps = parsed["sitemaps"]
    with open(os.path.join(out_dir, "sitemaps.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "fetched_at": _now_iso(),
                "root_sitemap": root_sitemap,
                "child_sitemaps": child_sitemaps,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    urls = {}
    images = set()
    for sm in child_sitemaps:
        sm_url = sm["loc"]
        try:
            st, fu, sm_bytes = fetch(
                sm_url,
                user_agent=args.user_agent,
                timeout_s=args.timeout_s,
                retries=args.retries,
                backoff_s=args.backoff_s,
            )
        except Exception:
            continue
        if st >= 400:
            continue
        sm_parsed = parse_sitemap(sm_bytes)
        if sm_parsed.get("type") != "urlset":
            continue
        for entry in sm_parsed["urls"]:
            loc = entry["loc"]
            if loc:
                urls[loc] = entry
            for img in entry.get("images", []):
                images.add(img)

    url_list = sorted(urls.keys())
    with open(os.path.join(out_dir, "urls.txt"), "w", encoding="utf-8") as f:
        for u in url_list:
            f.write(u + "\n")

    with open(os.path.join(out_dir, "images.txt"), "w", encoding="utf-8") as f:
        for img in sorted(images):
            f.write(img + "\n")

    index_path = os.path.join(out_dir, "pages.jsonl")
    pages_done = 0
    with open(index_path, "w", encoding="utf-8") as out:
        for u in url_list:
            if args.max_pages and pages_done >= args.max_pages:
                break
            pages_done += 1

            record = {
                "url": u,
                "fetched_at": _now_iso(),
            }
            try:
                st, fu, body = fetch(
                    u,
                    user_agent=args.user_agent,
                    timeout_s=args.timeout_s,
                    retries=args.retries,
                    backoff_s=args.backoff_s,
                )
                record["http_status"] = st
                record["final_url"] = fu

                html = body.decode("utf-8", "replace")
                meta = extract_meta(html)
                record.update(meta)

                file_name = sha1(u) + ".html"
                rel_path = os.path.join("html", file_name)
                abs_path = os.path.join(out_dir, rel_path)
                with open(abs_path, "wb") as f:
                    f.write(body)
                record["html_path"] = rel_path.replace("\\", "/")

                record["sitemap"] = urls.get(u, {})
            except Exception as e:
                record["error"] = str(e)

            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()

            time.sleep(args.delay_ms / 1000.0)

    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "fetched_at": _now_iso(),
                "root_sitemap": root_sitemap,
                "pages_total": len(url_list),
                "pages_exported": pages_done,
                "html_dir": os.path.relpath(html_dir, out_dir).replace("\\", "/"),
                "notes": [
                    "pages.jsonl contains one JSON object per URL with SEO meta and html_path",
                    "html/ contains raw HTML responses for later structured extraction",
                ],
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
