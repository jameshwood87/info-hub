#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d /opt/info-hub ]]; then
  exit 1
fi

cat > /opt/info-hub/.env <<EOF
HOST=127.0.0.1
PORT=3000
DIRECTUS_URL=http://127.0.0.1:8055
DIRECTUS_TOKEN=
EOF

chmod 600 /opt/info-hub/.env

cd /opt/info-hub
npm ci
npm run build

id -u infohub >/dev/null 2>&1 || useradd --system --home /opt/info-hub --shell /usr/sbin/nologin infohub
chown -R infohub:infohub /opt/info-hub

cat > /etc/systemd/system/info-hub.service <<'EOF'
[Unit]
Description=PropertyList Info Hub (Astro SSR)
After=network.target

[Service]
Type=simple
User=infohub
WorkingDirectory=/opt/info-hub
EnvironmentFile=/opt/info-hub/.env
ExecStart=/usr/bin/node /opt/info-hub/dist/server/entry.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now info-hub
systemctl --no-pager status info-hub | head -n 40
