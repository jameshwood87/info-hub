#!/usr/bin/env bash
# Keep the Then & Now map tile cache (var/cache/ign-tiles) under 1 GB: when it passes the
# cap, delete the least recently read tiles until it is back under 800 MB. Tiles are only a
# cache of IGN's WMS, so anything deleted is simply fetched again on the next request.
# Cron (root, daily 04:40): 40 4 * * * /opt/info-hub/scripts/then-now/prune-tiles.sh
set -euo pipefail
DIR=/opt/info-hub/var/cache/ign-tiles
CAP=$((1024 * 1024 * 1024))
TARGET=$((800 * 1024 * 1024))
[ -d "$DIR" ] || exit 0
total=$(du -sb "$DIR" | cut -f1)
[ "$total" -le "$CAP" ] && exit 0
find "$DIR" -type f -name '*.jpg' -printf '%A@ %s %p\n' | sort -n | while read -r _ size path; do
	[ "$total" -le "$TARGET" ] && break
	rm -f -- "$path"
	total=$((total - size))
done
find "$DIR" -type d -empty -delete
echo "$(date -u +%FT%TZ) pruned ign-tiles to $(du -sh "$DIR" | cut -f1)"
