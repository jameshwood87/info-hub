param(
	[string]$Host = "164.90.180.73",
	[string]$User = "root",
	[string]$KeyPath = "$env:USERPROFILE\.ssh\propertylist_migration_ed25519"
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$infoHubDir = Join-Path $repoRoot "info-hub"
$artifactPath = Join-Path $PSScriptRoot "info-hub-src.tar.gz"
$remoteArtifactPath = "/tmp/info-hub-src.tar.gz"

if (-not (Test-Path $KeyPath)) {
	throw "SSH key not found at: $KeyPath"
}

if (-not (Test-Path $infoHubDir)) {
	throw "Info Hub directory not found at: $infoHubDir"
}

if (Test-Path $artifactPath) {
	Remove-Item $artifactPath -Force
}

tar -czf $artifactPath --exclude "node_modules" --exclude "dist" --exclude ".astro" -C $infoHubDir .

scp -i $KeyPath -o IdentitiesOnly=yes -o BatchMode=yes $artifactPath "$User@$Host`:$remoteArtifactPath"

$remoteCommand = 'set -euo pipefail; rm -rf /opt/info-hub.new; mkdir -p /opt/info-hub.new; tar -xzf /tmp/info-hub-src.tar.gz -C /opt/info-hub.new; if [ -f /opt/info-hub/.env ]; then cp /opt/info-hub/.env /opt/info-hub.new/.env; fi; cd /opt/info-hub.new; npm ci; npm run build; systemctl stop info-hub || true; ts=$(date +%Y%m%d-%H%M%S); if [ -d /opt/info-hub ]; then mv /opt/info-hub /opt/info-hub.prev-$ts; fi; mv /opt/info-hub.new /opt/info-hub; chown -R infohub:infohub /opt/info-hub || true; systemctl start info-hub; systemctl --no-pager status info-hub | head -n 60'

ssh -i $KeyPath -o IdentitiesOnly=yes -o BatchMode=yes "$User@$Host" $remoteCommand
