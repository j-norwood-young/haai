# Environment Variables

Environment variables override values from `config.yaml`. See [Configuration](./configuration) for full precedence rules.

Variables can be set in the shell or in a `.env` file in the working directory (loaded by the proxy, CLI, MCP server, and TUI).

## Server

| Variable | Default | Description |
|---|---|---|
| `HAAI_HOST` | `0.0.0.0` | Listen host |
| `HAAI_PORT` | `4000` (`4001` when `HAAI_DEV=1`) | Listen port |
| `HAAI_TLS_CERT` | — | Path to TLS certificate file |
| `HAAI_TLS_KEY` | — | Path to TLS private key file |
| `HAAI_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed CORS origins |

## Logging

| Variable | Default | Description |
|---|---|---|
| `HAAI_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal` |
| `HAAI_LOG_FORMAT` | `json` | `json` or `pretty` |
| `HAAI_LOG_FILE` | — | Optional log file path |

## Metrics & health

| Variable | Default | Description |
|---|---|---|
| `HAAI_METRICS_ENABLED` | `true` | Enable Prometheus metrics at `/metrics` |
| `HAAI_OTEL_ENDPOINT` | — | OpenTelemetry OTLP HTTP endpoint |
| `HAAI_OTEL_SERVICE_NAME` | `haai` | Service name for OTLP export |
| `HAAI_HEALTH_CHECK_INTERVAL` | `30` | Backend health check interval in seconds |

## Security

| Variable | Default | Description |
|---|---|---|
| `HAAI_SESSION_SECRET` | auto-generated | Secret for signing session cookies — set explicitly in production |
| `HAAI_WEBAUTHN_RP_ID` | — | WebAuthn relying party ID (usually your domain) |
| `HAAI_WEBAUTHN_ORIGINS` | — | Comma-separated WebAuthn allowed origins |

## Data & first-run bootstrap

| Variable | Default | Description |
|---|---|---|
| `HAAI_DATA_DIR` | `~/.haai` | Data directory (`config.yaml`, SQLite DB, keys, logs) |
| `HAAI_ADMIN_USER` | `admin` | Initial admin username — **first run only** |
| `HAAI_ADMIN_PASSWORD` | `admin` | Initial admin password — **first run only** |

::: warning
`HAAI_ADMIN_USER` and `HAAI_ADMIN_PASSWORD` are only applied when the database is first created. To change credentials later, use the admin UI or `haai user` CLI commands.
:::

## Development & deployment

| Variable | Description |
|---|---|
| `HAAI_DEV` | Set to `1` for development mode (proxy on port 4001, admin UI served separately by Vite) |
| `HAAI_WEB_DIR` | Override path to the built SvelteKit admin UI (`apps/web/build`) |
| `HAAI_DOCS_DIR` | Override path to the built VitePress docs (`docs/.vitepress/dist`) |
| `HAAI_PROXY_URL` | Web dev server only — proxy target for `/api` (default `http://localhost:4001`) |

## CLI & clients

These variables are read by the `haai` CLI, MCP server, and other clients — not by the proxy process itself.

| Variable | Description |
|---|---|
| `HAAI_URL` | Proxy base URL (default `http://localhost:4000`) |
| `HAAI_ADMIN_TOKEN` | Admin Bearer token for CLI/API access |
| `HAAI_API_KEY` | Client API key for inference commands such as `haai prompt` |

## Docker Compose / Tailscale

These are read by Compose and the Tailscale sidecar, not by the HAAI process. See [Tailscale](./tailscale) for how to generate `TS_AUTHKEY`.

| Variable | Default | Description |
|---|---|---|
| `COMPOSE_PROFILES` | — | Set to `tailscale` to start the sidecar with `docker compose up` |
| `TS_AUTHKEY` | — | Tailscale auth key or OAuth client secret |
| `TS_HOSTNAME` | `haai` | Hostname on the tailnet |
| `TS_EXTRA_ARGS` | — | Extra `tailscale up` flags (required tags when using an OAuth secret) |
| `TS_USERSPACE` | `true` | Userspace networking (no `/dev/net/tun`) |
| `HAAI_TAILSCALE_NETWORK` | `haai-tailscale` | Compose network name |

## Examples

```bash
# Production with custom port and log level
HAAI_PORT=8080 HAAI_LOG_LEVEL=debug pnpm start

# Custom data directory (Docker volume mount)
HAAI_DATA_DIR=/data pnpm start

# First run with a strong admin password
HAAI_ADMIN_PASSWORD='your-strong-password' pnpm start
```
