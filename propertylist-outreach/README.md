# PropertyList Outreach Scraper

Automated agent discovery and outreach system for PropertyList.es

## Quick Start

```bash
# Install dependencies
cd /home/pingu/pertylist-outreach
npm install

# Edit .env with your config
cp .env.example .env
# (Edit .env with your actual values)

# Run manually
node src/index.js

# Or start server (includes cron)
npm start
```

## Configuration (.env)

| Variable | Description |
|----------|------------|
| MAILCHIMP_API_KEY | Your Mailchimp API key |
| MAILCHIMP_SERVER_PREFIX | e.g., us22 |
| MAILCHIMP_AUDIENCE_ID | Audience ID (df879596b3) |
| MAILCHIMP_SEGMENT_ID | Segment for new agencies (33229) |
| PROPERTYLIST_DB_PATH | Path to propertylist-db.sqlite |
| DISCORD_OUTREACH_WEBHOOK | Discord webhook URL |
| SCRAPE_REGIONS | Comma-separated regions to scrape |
| MAX_NEW_PER_RUN | Max agencies to add per run |

## Manual Commands

```bash
# Run outreach cycle
curl http://localhost:3210/run

# Get status
curl http://localhost:3210/status

# Force digest to Discord
curl http://localhost:3210/digest

# Health check
curl http://localhost:3210/health
```

## Systemd Service (survives reboots)

```bash
# Create service file
sudo nano /etc/systemd/system/propertylist-outreach.service

# Add:
[Unit]
Description=PropertyList Outreach Scraper
After=network.target

[Service]
Type=simple
User=pingu
WorkingDirectory=/home/pingu/pertylist-outreach
ExecStart=/usr/bin/node src/index.js
Restart=always

[Install]
WantedBy=multi-user.target

# Enable
sudo systemctl daemon-reload
sudo systemctl enable propertylist-outreach
sudo systemctl start propertylist-outreach
```

## Features

- **Daily automated scraping** via cron
- **Dedup against existing PropertyList agents** (local DB)
- **Dedup against Mailchimp** (103 existing contacts)
- **Add to Mailchimp segment** "agency-outreach"
- **Post new agencies to Discord**
- **Daily digest** with stats

## Files

```
propertylist-outreach/
├── .env                    # Your config
├── .env.example           # Template
├── package.json
├── src/
│   ├── index.js           # Main entry + cron + Express
│   ├── scraper.js         # Playwright web scraper
│   ├── tracker.js         # SQLite agency tracker
│   ├── dedup.js           # Cross-reference PropertyList + Mailchimp
│   ├── mailchimp.js       # Mailchimp API integration
│   ├── discord.js        # Discord webhook integration
│   └── logger.js        # Simple file logger
├── data/
│   └── tracker.db        # SQLite database (auto-created)
└── logs/
    └── outreach.log     # Log file (auto-created)
```

## Current Status

- Config saved: /home/pingu/pertylist-outreach/.env
- Mailchimp: us22, audience df879596b3, segment 33229
- Discord: webhook configured
- Ready to run