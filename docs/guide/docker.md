# Docker

Run HAAI in a container with persistent data on a volume.

## Quick start

```bash
docker compose up -d
```

Open http://localhost:4000 — admin UI, API, docs (`/docs/`), and Swagger (`/api/docs/`).

## docker-compose.yml

The included compose file defines two services:

| Service | Port (default) | Role |
|---------|----------------|------|
| `proxy` | 4000 | API, admin UI, docs, Swagger |
| `web` | 5173 | nginx reverse proxy to `proxy` (dev-port parity) |

Both services:

- Build `proxy` from the repo `Dockerfile` (or use a published image)
- Mount volume `haai-data` → `/data` (`HAAI_DATA_DIR`) on `proxy`
- Health check `GET /health` on `proxy`

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
