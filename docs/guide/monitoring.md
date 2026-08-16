# Monitoring & Graphs

The admin UI provides real-time visibility into proxy health and usage.

## Dashboard (`/`)

- 24-hour request volume, tokens, error rate
- Average TTFT (time to first token) and TPS
- Per-backend health badges (healthy / degraded / unhealthy)
- Sidebar status indicator for backends **and** v-models (including mapping-level reasons when degraded/down)
- Recent activity feed via SSE

## Analytics (`/analytics`)

Detailed charts built from metrics rollups — hourly usage, token breakdown, and backend comparison.

## Live Logs (`/logs`)

Stream structured log entries in real time over SSE (`log` events on `/api/v1/events`).

## Metrics API

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/metrics/summary` | 24h aggregate stats + backend and v-model health |
| `GET /api/v1/metrics/rollups?period=hour&limit=48` | Time-series buckets |
| `GET /api/v1/metrics/events?limit=100` | Recent usage events |

## Server-Sent Events

Connect to `GET /api/v1/events` (admin session required):

| Event | Description |
|-------|-------------|
| `backend-health` | Backend status changes / poll complete |
| `vmodel-health` | V-model availability changes / poll complete |
| `usage-event` | New inference usage recorded |
| `key-event` | Key created, suspended, deleted |
| `log` | Log line for live tail |
| `system` | System notifications |

The dashboard subscribes automatically when you are logged in.

## External monitoring

Export metrics to Prometheus — see [Prometheus & OTLP](./prometheus).

Build custom dashboards by polling the metrics API or scraping `/metrics`.
