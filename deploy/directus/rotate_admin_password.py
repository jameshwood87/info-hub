import json
import secrets
import string
import urllib.error
import urllib.request
from pathlib import Path


def req(method: str, url: str, token: str | None = None, body: dict | None = None) -> dict:
    headers = {}
    if token:
        headers["authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(url, method=method, headers=headers, data=data)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())


def random_password(length: int = 28) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> int:
    env_path = Path("/opt/directus/.env")
    lines = env_path.read_text(encoding="utf-8").splitlines()
    vals = dict(line.split("=", 1) for line in lines if "=" in line)

    base = "http://127.0.0.1:8055"
    login = req(
        "POST",
        f"{base}/auth/login",
        body={"email": vals["DIRECTUS_ADMIN_EMAIL"], "password": vals["DIRECTUS_ADMIN_PASSWORD"]},
    )
    tok = login["data"]["access_token"]

    me = req("GET", f"{base}/users/me", tok)["data"]
    new_pw = random_password()
    req("PATCH", f"{base}/users/{me['id']}", tok, {"password": new_pw})

    new_lines = []
    for line in lines:
        if line.startswith("DIRECTUS_ADMIN_PASSWORD="):
            new_lines.append("DIRECTUS_ADMIN_PASSWORD=" + new_pw)
        else:
            new_lines.append(line)
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

