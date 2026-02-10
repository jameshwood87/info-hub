#!/usr/bin/env bash
set -euo pipefail

cd /opt/directus
set -a
. ./.env
set +a

mkdir -p /opt/imports
cd /opt/imports

python3 /opt/imports/import_wp.py \
  --sitemap "https://info.propertylist.es/sitemap.xml" \
  --directus-url "http://127.0.0.1:8055" \
  --state "/opt/imports/wp_import_state.jsonl"
