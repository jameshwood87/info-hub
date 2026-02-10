#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  apt-get update -y >/dev/null
  apt-get install -y jq >/dev/null
fi

cd /opt/directus
set +a
. ./.env
set -a

echo "directus:login" >&2
LOGIN_RESP="$(
  curl -sS -X POST http://127.0.0.1:8055/auth/login \
    -H "content-type:application/json" \
    -d "{\"email\":\"${DIRECTUS_ADMIN_EMAIL}\",\"password\":\"${DIRECTUS_ADMIN_PASSWORD}\"}"
)"
TOKEN="$(echo "${LOGIN_RESP}" | jq -r ".data.access_token // empty")"

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "${LOGIN_RESP}" | head -c 300 >&2 || true
  echo >&2
  exit 1
fi
echo "directus:login_ok" >&2

api_post() {
  local path="$1"
  local json="$2"
  curl -sS -X POST "http://127.0.0.1:8055${path}" \
    -H "authorization: Bearer ${TOKEN}" \
    -H "content-type:application/json" \
    -d "${json}"
}

api_patch() {
  local path="$1"
  local json="$2"
  curl -sS -X PATCH "http://127.0.0.1:8055${path}" \
    -H "authorization: Bearer ${TOKEN}" \
    -H "content-type:application/json" \
    -d "${json}"
}

api_get() {
  local path="$1"
  curl -sS --globoff "http://127.0.0.1:8055${path}" \
    -H "authorization: Bearer ${TOKEN}"
}

create_collection() {
  local name="$1"
  api_post "/collections" "{\"collection\":\"${name}\",\"meta\":{\"icon\":\"description\"},\"schema\":{\"name\":\"${name}\"}}" >/dev/null 2>&1 || true
}

create_field() {
  local coll="$1"
  local payload="$2"
  api_post "/fields/${coll}" "${payload}" >/dev/null 2>&1 || true
}

create_collection "kb_pages"
echo "directus:collection_ok" >&2

create_field "kb_pages" "{\"field\":\"status\",\"type\":\"string\",\"meta\":{\"interface\":\"select-dropdown\",\"options\":{\"choices\":[{\"text\":\"Draft\",\"value\":\"draft\"},{\"text\":\"Published\",\"value\":\"published\"}]}} ,\"schema\":{\"default_value\":\"draft\"}}"
create_field "kb_pages" "{\"field\":\"language\",\"type\":\"string\",\"meta\":{\"interface\":\"select-dropdown\",\"options\":{\"choices\":[{\"text\":\"English\",\"value\":\"en\"},{\"text\":\"Español\",\"value\":\"es\"}]}}}"
create_field "kb_pages" "{\"field\":\"path\",\"type\":\"string\",\"meta\":{\"interface\":\"input\",\"required\":true},\"schema\":{\"is_unique\":true}}"
create_field "kb_pages" "{\"field\":\"title\",\"type\":\"string\",\"meta\":{\"interface\":\"input\",\"required\":true}}"
create_field "kb_pages" "{\"field\":\"description\",\"type\":\"text\",\"meta\":{\"interface\":\"textarea\"}}"
create_field "kb_pages" "{\"field\":\"body\",\"type\":\"text\",\"meta\":{\"interface\":\"input-rich-text-html\"}}"
create_field "kb_pages" "{\"field\":\"seo_title\",\"type\":\"string\",\"meta\":{\"interface\":\"input\"}}"
create_field "kb_pages" "{\"field\":\"seo_description\",\"type\":\"text\",\"meta\":{\"interface\":\"textarea\"}}"
echo "directus:fields_ok" >&2

ensure_page() {
  local path="$1"
  local language="$2"
  local title="$3"
  local description="$4"
  local body="$5"
  local status="$6"

  local existing_id
  existing_id="$(
    api_get "/items/kb_pages?filter[path][_eq]=${path}&limit=1" | jq -r '.data[0].id // empty'
  )"

  if [[ -n "${existing_id}" ]]; then
    return 0
  fi

  api_post "/items/kb_pages" "{\"status\":\"${status}\",\"language\":\"${language}\",\"path\":\"${path}\",\"title\":\"${title}\",\"description\":\"${description}\",\"body\":\"${body}\"}" >/dev/null
}

ensure_page "/docs/getting-started/" "en" "Getting Started" "Start here to learn the basics." "<h2>Overview</h2><p>This is a placeholder page.</p>" "published"
ensure_page "/es/docs/empezar/" "es" "Empezar" "Empieza aquí para aprender lo básico." "<h2>Resumen</h2><p>Esta es una página de ejemplo.</p>" "published"

echo "directus:seed_ok" >&2

PUBLIC_POLICY_ID="$(
  api_get "/policies" | jq -r '.data[] | select(.icon=="public" and (.admin_access==false) and (.app_access==false)) | .id' | head -n 1
)"

if [[ -z "${PUBLIC_POLICY_ID}" || "${PUBLIC_POLICY_ID}" == "null" ]]; then
  exit 1
fi

PUBLIC_PERM_ID="$(
  api_get "/permissions?filter[policy][_eq]=${PUBLIC_POLICY_ID}&filter[collection][_eq]=kb_pages&filter[action][_eq]=read&limit=1" \
  | jq -r '.data[0].id // empty'
)"

PUBLIC_PERM_PAYLOAD="{\"policy\":\"${PUBLIC_POLICY_ID}\",\"collection\":\"kb_pages\",\"action\":\"read\",\"fields\":[\"*\"],\"permissions\":{\"status\":{\"_eq\":\"published\"}}}"

if [[ -n "${PUBLIC_PERM_ID}" ]]; then
  api_patch "/permissions/${PUBLIC_PERM_ID}" "${PUBLIC_PERM_PAYLOAD}" >/dev/null
else
  api_post "/permissions" "${PUBLIC_PERM_PAYLOAD}" >/dev/null
fi

echo "directus:done" >&2
