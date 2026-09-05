#!/bin/sh
# Daily snapshot of the portal market data so week-over-week movement posts are possible.
cp /opt/info-hub/var/admin/budget-data.json /opt/info-hub/var/admin/history/budget-$(date +%F).json
find /opt/info-hub/var/admin/history -name 'budget-*.json' -mtime +400 -delete
