#!/usr/bin/env bash
# Atomic production deploy for info.propertylist.es (Astro SSR).
#
# The old deploy ran `npm run build` in-place on the live dist/, so the running
# server crashed mid-build (missing manifest chunk) and systemd restarted it -
# a transient 502 on every push. This builds into a staging dir first so the
# live dist/ keeps serving throughout the build, then swaps it in and restarts
# once. The only downtime is the ~1s clean restart at the end.
#
# 2026-08-03: two deploys from different sessions overlapped and left dist/ with
# entry.mjs from one build and the manifest chunk from the other, so the service
# died with ERR_MODULE_NOT_FOUND and systemd gave up after 4 restarts. The site
# was down until someone noticed. Three guards added:
#   1. an exclusive flock, so a second deploy waits instead of interleaving;
#   2. a health check that waits for the app to actually serve 200;
#   3. automatic rollback to the previous dist/ if it does not.
#
# Assumes deps are already installed (npm ci) by the caller / pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."

LOCK=/var/lock/info-hub-deploy.lock
HEALTH_URL=http://127.0.0.1:3000/
HEALTH_TIMEOUT=60

# ---- 1. only one deploy at a time ----
exec 9>"$LOCK"
if ! flock -n 9; then
	echo "==> Another deploy is running; waiting for it to finish..."
	flock 9
fi

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

# ---- 2. wait for the app to actually serve, do not assume ----
echo "==> Waiting for the app to answer on $HEALTH_URL ..."
healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true)
	if [ "$code" = "200" ]; then
		healthy=1
		break
	fi
	sleep 1
done

# ---- 3. roll back rather than leave the site down ----
if [ "$healthy" != "1" ]; then
	echo "!! App did not return 200 within ${HEALTH_TIMEOUT}s - rolling back." >&2
	journalctl -u info-hub.service -n 20 --no-pager >&2 || true
	rm -rf dist_failed
	mv dist dist_failed
	mv dist_old dist
	sudo systemctl restart info-hub.service
	sleep 3
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)
	echo "!! Rolled back to the previous build (health: $code). The failed build is in dist_failed/." >&2
	exit 1
fi

echo "==> Cleaning up old build..."
rm -rf dist_old
echo "==> Deploy complete and healthy."
