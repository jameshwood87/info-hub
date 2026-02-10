# PropertyList Info Hub (this repo)

## What this app is
PropertyList Info Hub is a public documentation / knowledge site for PropertyList. It has:
- An English site at `/` and a Spanish site at `/es/`
- A homepage that explains what PropertyList is, how it works, and key offers/features
- Documentation pages, MLS manual pages, laws/procedures pages, news/general information, and search

## Tech stack (how it’s built)
- Framework: Astro (SSR output, Node adapter)
- Runtime: Node.js
- Content: pulled from Directus (configured via env vars)
- Prod hosting: Nginx reverse proxy → systemd service running Astro SSR build

## Repo layout
- `info-hub/`: the Astro application
  - `src/layouts/Layout.astro`: global layout, header/nav, global styles, language switch
  - `src/pages/index.astro`: English homepage
  - `src/pages/es/index.astro`: Spanish homepage
  - `src/lib/directus.ts`: Directus fetch helpers (reads `DIRECTUS_URL` / `DIRECTUS_TOKEN`)
- `deploy/`: server/deployment assets
  - `deploy/nginx/info.propertylist.es`: nginx vhost (proxies to `127.0.0.1:3000`)
  - `deploy/info-hub/setup_server.sh`: initial server setup (systemd unit, build, env file)
  - `deploy/info-hub/deploy_production.ps1`: repeatable production deployment script (Windows)

## Production server notes
- Host: `164.90.180.73`
- App path: `/opt/info-hub`
- Service: `info-hub` (systemd)
  - Runs: `node /opt/info-hub/dist/server/entry.mjs`
- Nginx: proxies `info.propertylist.es` → `http://127.0.0.1:3000`

## Deployment (future deploys)
Run this from Windows PowerShell:

`deploy/info-hub/deploy_production.ps1`

What it does:
- Creates `deploy/info-hub/info-hub-src.tar.gz` from `info-hub/` (excluding `node_modules/`, `dist/`, `.astro/`)
- Uploads it to the server
- Builds on the server (`npm ci`, `npm run build`)
- Restarts the `info-hub` systemd service
- Keeps a backup at `/opt/info-hub.prev-<timestamp>`

## Recent updates (keep this current)

### 2026-02-10
- Homepage layout improvements (EN + ES):
  - Removed the non-functional top-right hero cards section
  - Centered the “What is PropertyList?” / “How PropertyList Works?” tab row
  - Moved persona tabs (Freelancer/Agency/Developer/Property Service) below the title + intro text
  - Updated “What we offer” content to match `https://info.propertylist.es/what-we-offer/` (MLS, CRM, messaging & request viewings, unlimited users/contacts, microsite, verified agencies, history timeline)
- Mobile improvements:
  - Added safe-area support and improved small-screen behavior (no horizontal overflow for tab rows)

