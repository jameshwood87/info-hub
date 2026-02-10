import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_UA = "PropertyListInfoHubImporter/1.0 (+https://info.propertylist.es)"


def fetch(url: str, *, user_agent: str, timeout_s: int = 40) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": user_agent, "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return r.read()


def parse_sitemap(xml_bytes: bytes) -> dict:
    xml_text = xml_bytes.decode("utf-8", "replace").lstrip()
    xml_bytes = xml_text.encode("utf-8", "replace")
    root = ET.fromstring(xml_bytes)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

    if root.tag.endswith("sitemapindex"):
        sitemaps = []
        for sm in root.findall("sm:sitemap", ns):
            loc = (sm.findtext("sm:loc", default="", namespaces=ns) or "").strip()
            if loc:
                sitemaps.append(loc)
        return {"type": "index", "sitemaps": sitemaps}

    if root.tag.endswith("urlset"):
        urls = []
        for u in root.findall("sm:url", ns):
            loc = (u.findtext("sm:loc", default="", namespaces=ns) or "").strip()
            if loc:
                urls.append(loc)
        return {"type": "urlset", "urls": urls}

    return {"type": "unknown"}


_RE_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_RE_META_DESC = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
    re.IGNORECASE | re.DOTALL,
)
_RE_MAIN = re.compile(r"<main[^>]*>([\s\S]*?)</main>", re.IGNORECASE)
_RE_ARTICLE = re.compile(r"<article[^>]*>([\s\S]*?)</article>", re.IGNORECASE)


def extract_title(html: str) -> str:
    m = _RE_TITLE.search(html)
    if not m:
        return ""
    title = re.sub(r"\s+", " ", m.group(1)).strip()
    title = re.sub(r"\s*[•|\\-]\\s*PropertyList Info Hub\s*$", "", title).strip()
    return title


def extract_description(html: str) -> str:
    m = _RE_META_DESC.search(html)
    if not m:
        return ""
    return re.sub(r"\s+", " ", m.group(1)).strip()


def extract_body(html: str) -> str:
    m = _RE_MAIN.search(html)
    if m:
        return m.group(1).strip()
    m = _RE_ARTICLE.search(html)
    if m:
        return m.group(1).strip()
    return html


def directus_request(
    url: str, *, method: str, token: str | None, body: dict | None = None
) -> dict:
    data = None
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw)


def directus_login(base_url: str, email: str, password: str) -> str:
    out = directus_request(
        f"{base_url}/auth/login",
        method="POST",
        token=None,
        body={"email": email, "password": password},
    )
    return out.get("data", {}).get("access_token", "")


def get_item_by_path(base_url: str, token: str, path: str) -> dict | None:
    qs = urllib.parse.urlencode({"filter[path][_eq]": path, "limit": "1"})
    out = directus_request(
        f"{base_url}/items/kb_pages?{qs}", method="GET", token=token, body=None
    )
    data = out.get("data") or []
    return data[0] if data else None


def upsert_page(base_url: str, token: str, item: dict) -> tuple[str, str]:
    existing = get_item_by_path(base_url, token, item["path"])
    if existing and existing.get("id"):
        page_id = str(existing["id"])
        directus_request(
            f"{base_url}/items/kb_pages/{page_id}",
            method="PATCH",
            token=token,
            body=item,
        )
        return "updated", page_id
    out = directus_request(
        f"{base_url}/items/kb_pages", method="POST", token=token, body=item
    )
    page_id = str(out.get("data", {}).get("id", ""))
    return "created", page_id


def normalize_path(url: str) -> str:
    p = urllib.parse.urlparse(url)
    path = p.path or "/"
    if not path.endswith("/"):
        path += "/"
    if not path.startswith("/"):
        path = "/" + path
    return path


def detect_language(path: str) -> str:
    if path.startswith("/es/"):
        return "es"
    return "en"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitemap", default="https://info.propertylist.es/sitemap.xml")
    ap.add_argument("--directus-url", default="http://127.0.0.1:8055")
    ap.add_argument("--admin-email", default=os.environ.get("DIRECTUS_ADMIN_EMAIL", ""))
    ap.add_argument("--admin-password", default=os.environ.get("DIRECTUS_ADMIN_PASSWORD", ""))
    ap.add_argument("--user-agent", default=DEFAULT_UA)
    ap.add_argument("--delay-ms", type=int, default=250)
    ap.add_argument("--max-pages", type=int, default=0, help="0 = no limit")
    ap.add_argument("--state", default="import_state.jsonl")
    args = ap.parse_args()

    if not args.admin_email or not args.admin_password:
        raise SystemExit("Missing Directus admin credentials")

    directus_url = args.directus_url.rstrip("/")
    token = directus_login(directus_url, args.admin_email, args.admin_password)
    if not token:
        raise SystemExit("Directus login failed")

    sitemap_xml = fetch(args.sitemap, user_agent=args.user_agent)
    parsed = parse_sitemap(sitemap_xml)
    urls: list[str] = []
    if parsed["type"] == "index":
        for sm in parsed["sitemaps"]:
            try:
                child_xml = fetch(sm, user_agent=args.user_agent)
            except Exception:
                continue
            child = parse_sitemap(child_xml)
            if child["type"] == "urlset":
                urls.extend(child["urls"])
    elif parsed["type"] == "urlset":
        urls = parsed["urls"]
    else:
        raise SystemExit("Unknown sitemap format")

    seen_paths: set[str] = set()
    state_path = os.path.abspath(args.state)
    if os.path.exists(state_path):
        with open(state_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    if rec.get("path"):
                        seen_paths.add(rec["path"])
                except Exception:
                    continue

    done = 0
    with open(state_path, "a", encoding="utf-8") as st:
        for u in urls:
            if args.max_pages and done >= args.max_pages:
                break
            path = normalize_path(u)
            lang = detect_language(path)
            if lang not in {"en", "es"}:
                continue
            if path in seen_paths:
                continue

            record = {"url": u, "path": path, "lang": lang, "ts": time.time()}
            try:
                html = fetch(u, user_agent=args.user_agent).decode("utf-8", "replace")
                title = extract_title(html) or path
                desc = extract_description(html)
                body = extract_body(html)

                item = {
                    "status": "published",
                    "language": lang,
                    "path": path,
                    "title": title,
                    "description": desc or None,
                    "body": body,
                    "seo_title": title,
                    "seo_description": desc or None,
                }

                action, page_id = upsert_page(directus_url, token, item)
                record.update({"ok": True, "action": action, "id": page_id})
            except Exception as e:
                record.update({"ok": False, "error": str(e)})

            st.write(json.dumps(record, ensure_ascii=False) + "\n")
            st.flush()
            seen_paths.add(path)
            done += 1
            time.sleep(args.delay_ms / 1000.0)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
