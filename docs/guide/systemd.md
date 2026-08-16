# Systemd

Run HAAI as a systemd service on Linux.

## Build

```bash
pnpm install
pnpm build
```

## Service unit

Create `/etc/systemd/system/haai.service`:

```ini
[Unit]
Description=haai LLM reverse proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=haai
Group=haai
WorkingDirectory=/opt/haai
ExecStart=/usr/bin/node packages/proxy/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=HAAI_DATA_DIR=/var/lib/haai
Environment=HAAI_HOST=0.0.0.0
Environment=HAAI_PORT=4000
Environment=HAAI_LOG_LEVEL=info
Environment=HAAI_LOG_FORMAT=json
# Environment=HAAI_SESSION_SECRET=...

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/haai
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## Setup

```bash
sudo useradd --system --home /var/lib/haai haai
sudo mkdir -p /var/lib/haai
sudo chown haai:haai /var/lib/haai

sudo cp -r /path/to/haai /opt/haai
sudo chown -R haai:haai /opt/haai

sudo systemctl daemon-reload
sudo systemctl enable --now haai
sudo systemctl status haai
```

## Logs

```bash
journalctl -u haai -f
```

## Reverse proxy

Put nginx or Caddy in front for TLS — see [Reverse Proxy (nginx)](./reverse-proxy) and [TLS Setup](./tls).

## Related

- [Installation](./installation)
- [Environment Variables](./env-vars)
- [Docker](./docker)
