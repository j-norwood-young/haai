# Docker

Run HAAI in a container with persistent data on a volume.

## Quick start

```bash
docker compose up -d
```

Open http://localhost:4000 — admin UI, API, docs (`/docs/`), and Swagger (`/api/docs/`).

## docker-compose.yml

The included compose file defines two default services plus optional profiles:

| Service | Port (default) | Role |
|---------|----------------|------|
| `proxy` | 4000 | API, admin UI, docs, Swagger |
| `web` | 5173 | nginx reverse proxy to `proxy` (dev-port parity) |
| `tailscale` | — | Optional sidecar (`--profile tailscale`) that joins your tailnet |
| `mock-backend` | 11434 | Optional mock LLM (`--profile testing`) |

`proxy` and `web`:

- Build `proxy` from the repo `Dockerfile` (or use a published image)
- Mount volume `haai-data` → `/data` (`HAAI_DATA_DIR`) on `proxy`
- Health check `GET /health` on `proxy`
- Join the default network and the optional `tailscale` network (`haai-tailscale`)

Host ports are overridable via `.env` (`HAAI_HOST_PROXY_PORT`, `HAAI_HOST_WEB_PORT`). See [Reverse Proxy (nginx)](./reverse-proxy) for the `web` service config and production nginx examples.

### Environment

| Variable | Value in compose |
|----------|------------------|
| `HAAI_HOST` | `0.0.0.0` |
| `HAAI_PORT` | `4000` |
| `HAAI_DATA_DIR` | `/data` |
| `HAAI_LOG_LEVEL` | `info` |
| `HAAI_LOG_FORMAT` | `json` |
| `HAAI_CORS_ORIGINS` | `http://localhost:4000,http://localhost:5173` |

Add secrets via compose `environment` or an env file:

```yaml
environment:
  HAAI_SESSION_SECRET: "${HAAI_SESSION_SECRET}"
  HAAI_ADMIN_PASSWORD: "${HAAI_ADMIN_PASSWORD}"
```

## Build manually

```bash
docker build -t haai .
docker run -d \
  -p 4000:4000 \
  -v haai-data:/data \
  -e HAAI_DATA_DIR=/data \
  haai
```

The image includes the built admin UI and VitePress docs.

## Mock backend (testing profile)

```bash
docker compose --profile testing up
```

Starts a mock OpenAI-compatible backend on port 11434 for integration testing.

## Tailscale (optional)

The compose file defines a `tailscale` network (`haai-tailscale` by default) and a `tailscale` sidecar on the `tailscale` profile. Enable it to put HAAI on your [tailnet](https://tailscale.com/kb/1136/tailnet) without changing the default `docker compose up` services.

### Enable

1. In the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys), generate a **reusable auth key** (or an [OAuth client](https://tailscale.com/kb/1215/oauth-clients) with `auth_keys` write scope).
2. Enable **MagicDNS** and **HTTPS** under Tailscale DNS settings (required for Serve certificates).
3. Copy `.env.example` to `.env` and set:

```env
COMPOSE_PROFILES=tailscale
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=haai
```

4. Start the stack:

```bash
docker compose up -d
```

Or pass the profile on the command line instead of `COMPOSE_PROFILES`:

```bash
docker compose --profile tailscale up -d
```

Without an auth key, log in once from the container:

```bash
docker compose --profile tailscale exec tailscale tailscale login
```

The sidecar uses userspace networking (no `/dev/net/tun`). It joins the compose `tailscale` network and the default network so it can reach `proxy`. Tailscale Serve proxies HTTPS to the proxy:

| From the tailnet | Backend |
|------------------|---------|
| `https://haai.<tailnet>.ts.net` | `http://proxy:4000` |

Hostname is `TS_HOSTNAME` (default `haai`). State is stored in the `haai-tailscale-state` volume so the node identity survives restarts (`TS_AUTH_ONCE=true`).

Add the Serve URL to CORS (and WebAuthn, if you use passkeys):

```env
HAAI_CORS_ORIGINS=http://localhost:4000,http://localhost:5173,https://haai.your-tailnet.ts.net
HAAI_URL=https://haai.your-tailnet.ts.net
HAAI_WEBAUTHN_RP_ID=haai.your-tailnet.ts.net
HAAI_WEBAUTHN_ORIGINS=https://haai.your-tailnet.ts.net
```

### Reach tailnet backends from HAAI

The sidecar exposes a SOCKS5 and HTTP proxy on port **1055** (compose network only, not published to the host). Point a backend at a MagicDNS name or Tailscale IP, and send proxy traffic through the sidecar if the proxy container cannot route `100.x` itself.

OAuth client secrets must advertise a tag, for example `TS_EXTRA_ARGS=--advertise-tags=tag:container` (define `tag:container` in your tailnet ACL).

### Kernel networking and subnet router

Set `TS_USERSPACE=false` and add TUN access to the `tailscale` service when you need kernel networking (subnet routes, higher throughput):

```yaml
devices:
  - /dev/net/tun:/dev/net/tun
cap_add:
  - NET_ADMIN
  - SYS_MODULE
```

Advertise the compose network with `TS_ROUTES` (then approve the subnet routes in the admin console). Override the network name with `HAAI_TAILSCALE_NETWORK` if other stacks should join the same bridge.

To attach an **existing** Docker network instead of creating `haai-tailscale`, set `HAAI_TAILSCALE_NETWORK` to that network’s name and change the compose `tailscale` network to `external: true`.

## Backup

Back up the Docker volume or `/data` contents:

- `data.db` — all configuration and keys metadata
- `master.key` — required for abstraction-mode backend keys
- `config.yaml` — optional overrides

## Related

- [Reverse Proxy (nginx)](./reverse-proxy)
- [Installation](./installation)
- [Kubernetes](./kubernetes)
- [Environment Variables](./env-vars)
- [TLS Setup](./tls)
- [Migrating from ai-v-models](./migrating-from-aivm)
