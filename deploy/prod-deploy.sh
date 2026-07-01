#!/usr/bin/env bash
# Atomic production deploy for info.propertylist.es (Astro SSR).
#
# The old deploy ran `npm run build` in-place on the live dist/, so the running
# server crashed mid-build (missing manifest chunk) and systemd restarted it -
# a transient 502 on every push. This builds into a staging dir first so the
# live dist/ keeps serving throughout the build, then swaps it in and restarts
# once. The only downtime is the ~1s clean restart at the end.
#
# Assumes deps are already installed (npm ci) by the caller / pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building into staging dir (dist_new)..."
rm -rf dist_new dist_old
OUT_DIR=dist_new npm run build

# Sanity-check the fresh build before we touch the live dir.
if [ ! -f dist_new/server/entry.mjs ]; then
	echo "!! Build did not produce dist_new/server/entry.mjs - aborting, live site untouched." >&2
	rm -rf dist_new
	exit 1
fi

echo "==> Swapping new build into place..."
mv dist dist_old
mv dist_new dist

echo "==> Restarting info-hub.service..."
sudo systemctl restart info-hub.service

echo "==> Cleaning up old build..."
rm -rf dist_old
echo "==> Deploy complete."
