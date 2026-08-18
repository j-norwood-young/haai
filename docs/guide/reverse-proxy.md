# Reverse Proxy (nginx)

HAAI listens on plain HTTP (default port **4000**). For production, put nginx (or Caddy — see [TLS Setup](./tls)) in front for TLS termination, long-lived connections, and a familiar deployment pattern.

## Production nginx with TLS

Use this when HAAI runs on the same host as nginx (systemd, bare metal, or a single container). The config below includes headers and settings needed for:

- Admin UI session cookies (`X-Forwarded-Proto`)
- Streaming chat completions (`proxy_buffering off`)
- Live logs and other SSE/WebSocket traffic (`Upgrade` / `Connection`)

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name admin.example.com;

    ssl_certificate     /etc/ssl/certs/admin.pem;
    ssl_certificate_key /etc/ssl/private/admin.key;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
    }
}
```

Point `proxy_pass` at wherever the proxy process listens (`127.0.0.1:4000` for a local systemd service, or a Docker service hostname in compose networks).

Set `HAAI_CORS_ORIGINS` to your public HTTPS admin URL. See [TLS Setup](./tls) for WebAuthn origin settings and Caddy examples.

## Docker Compose `web` service

The included `docker-compose.yml` runs a separate **nginx** container (`web`) that proxies to the `proxy` service. This mirrors the dev workflow: API and admin UI on port **4000**, admin UI also reachable on port **5173** via nginx.

| URL | Service |
|-----|---------|
| `http://localhost:4000` | `proxy` — API, admin UI, docs, Swagger |
| `http://localhost:5173` | `web` — same app via nginx |

Host ports are configurable in `.env`:

```env
HAAI_HOST_PROXY_PORT=4000
HAAI_HOST_WEB_PORT=5173
HAAI_CORS_ORIGINS=http://localhost:4000,http://localhost:5173
```

The nginx config is at `docker/admin-ui.conf` in the repo root and is mounted into the `web` container:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;

    location / {
        proxy_pass http://proxy:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
    }
}
```

You only need the `web` service for local parity with the Vite dev port. In production behind your own nginx or ingress, run the `proxy` service alone and terminate TLS at the edge.

## Kubernetes

For nginx Ingress Controller, use long proxy timeouts for streaming — see [Kubernetes](./kubernetes).

## Related

- [TLS Setup](./tls) — Caddy, certificates, WebAuthn
- [Tailscale](./tailscale) — HTTPS on your tailnet via Serve
- [Docker](./docker)
- [Systemd](./systemd)
- [Environment Variables](./env-vars)
