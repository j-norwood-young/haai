# REST API Reference

The management API is available at `/api/v1/`. All endpoints require admin authentication (session cookie or Bearer token).

## Authentication

### Login
`POST /api/v1/auth/login`

```json
{ "username": "admin", "password": "admin" }
```

Returns a session cookie `haai_session`.

### Get current user
`GET /api/v1/auth/me`

### Logout
`POST /api/v1/auth/logout`

---

## Backends

### List backends
`GET /api/v1/backends`

### Get backend
`GET /api/v1/backends/:id`

### Create backend
`POST /api/v1/backends`

```json
{
  "name": "lmstudio-bob",
  "displayName": "LM Studio (Bob)",
  "hostName": "bob",
  "provider": "lmstudio",
  "baseUrl": "http://192.168.1.100:1234",
  "keyMode": "passthrough",
  "enabled": true,
  "weight": 1
}
```

### Update backend
`PATCH /api/v1/backends/:id`

### Delete backend
`DELETE /api/v1/backends/:id`

### Test backend
`POST /api/v1/backends/:id/test`

Returns `{ success, latencyMs, models[] }`.

---

## Virtual Models

### List v-models
`GET /api/v1/vmodels`

### Create v-model
`POST /api/v1/vmodels`

```json
{
  "modelId": "smart-chat",
  "displayName": "Smart Chat",
  "balancingStrategy": "session-pin",
  "streaming": true,
  "allowToolCalling": true,
  "backends": [
    { "backendId": "backend-abc", "backendModelId": "qwen3.5-35b", "weight": 1 }
  ]
}
```

### Add backend to v-model
`POST /api/v1/vmodels/:id/backends`

### Remove backend from v-model
`DELETE /api/v1/vmodels/:id/backends/:backendMappingId`

---

## API Keys

### List keys
`GET /api/v1/keys`

### Create key
`POST /api/v1/keys`

```json
{
  "name": "my-app",
  "allowedModels": null,
  "rateLimitRpm": 60,
  "tokenBudgetDay": 100000,
  "expiresAt": null
}
```

Returns `{ id, key, prefix }`. **Key is shown once only.**

### Update key
`PATCH /api/v1/keys/:id`

### Suspend key
`POST /api/v1/keys/:id/suspend`

### Resume key
`POST /api/v1/keys/:id/resume`

### Delete key
`DELETE /api/v1/keys/:id`

### Key logs
`GET /api/v1/keys/:id/logs?limit=100&since=<timestamp>`

### Key budget
`GET /api/v1/keys/:id/budget`

---

## Hooks

### List hooks
`GET /api/v1/hooks`

### Create hook
`POST /api/v1/hooks`

```json
{
  "name": "my-webhook",
  "type": "external",
  "trigger": "pre-request",
  "webhookUrl": "https://...",
  "webhookSecret": "...",
  "timeoutMs": 5000
}
```

### Test hook
`POST /api/v1/hooks/:id/test`

---

## Metrics

### Summary (windowed)
`GET /api/v1/metrics/summary?since=<ms|iso>&keyId=...&vmodelId=...&backendId=...&backendModelId=...`

Returns windowed totals (`total_requests_24h`, `total_tokens_24h`, `error_rate_24h`, `avg_ttft_ms`, `avg_tps`), plus:
- `p50_ttft_ms`, `p95_ttft_ms`, `p50_duration_ms`, `p95_duration_ms`, `p50_tps` — nearest-rank percentiles over the window (omitted when no samples)
- `previous` — same metrics over the preceding window of equal length: `{ total_requests, total_tokens, error_rate, avg_ttft_ms?, avg_tps? }`

### Rollups
`GET /api/v1/metrics/rollups?period=hour&keyId=...&vmodelId=...&since=...&limit=48`

Supported periods: `minute`, `5min`, `15min` (in-memory event aggregation with zero-filled buckets; default `since` = now − limit × bucket), `hour`, `day`, `week`, `month` (persisted rollups).

### Events
`GET /api/v1/metrics/events?limit=100&keyId=...&errorsOnly=true`

`errorsOnly=true` restricts the result to `statusCode >= 400`. Each event includes `backendId`, `backendName`, `ttftMs`, `promptTokens`, `completionTokens` when available.

### Live snapshot
`GET /api/v1/metrics/live`

Returns the in-memory live operations state (10-minute window at 1 s resolution; lost on restart):

```json
{
  "now": 1760000000000,
  "startedAt": 1759990000000,
  "series": [{ "t": 1760000000000, "completed": 3, "errors": 0, "tokens": 420, "inFlight": 2 }],
  "inFlight": [{ "id": "...", "keyPrefix": "sk_ab", "vmodelName": "chat", "backendName": "openai", "backendModelId": "gpt-4o", "stream": true, "startedAt": 1759999999000, "firstTokenAt": 1759999999500, "completionTokens": 42, "attempt": 1, "vmodelId": "...", "backendId": "..." }],
  "inFlightTotal": 2,
  "backends": [{ "backendId": "...", "backendName": "openai", "concurrency": 1, "circuit": "closed", "probes": [{ "t": 1760000000000, "status": "healthy", "latencyMs": 120 }], "max_concurrency": 10, "enabled": true, "lastHealthStatus": "healthy" }]
}
```

### Performance breakdown
`GET /api/v1/metrics/breakdown?by=backend|vmodel|backendModel&since=<ms|iso>&keyId=...&vmodelId=...&backendId=...`

Groups usage events (default window: 24 h) with p50/p95 percentiles and a 24-bucket request sparkline per group:

```json
{
  "by": "backend",
  "since": 1759900000000,
  "groups": [{
    "key": "backend-1", "name": "OpenAI", "requests": 120, "share": 0.6, "errors": 2, "error_rate": 0.017,
    "prompt_tokens": 9000, "completion_tokens": 4000, "total_tokens": 13000, "tool_calls": 3,
    "ttft_p50_ms": 210, "ttft_p95_ms": 480, "ttft_max_ms": 900,
    "duration_p50_ms": 1200, "duration_p95_ms": 2600,
    "tps_avg": 42.5, "tps_p50": 40.1, "last_seen": 1760000000000,
    "sparkline": [0, 3, 5, 0, "... 24 buckets total"]
  }]
}
```

Deleted backends / v-models still appear as `"(deleted)"`; requests without a v-model are grouped under key `direct` (name `Direct`).

---

## Live Events (SSE)

`GET /api/v1/events`

Establishes a Server-Sent Events stream. Events:

| Event type | Description |
|---|---|
| `backend-health` | Backend health status changes |
| `usage-event` | New usage event recorded (includes `backendId`, `backendName`, `ttftMs`, `promptTokens`, `completionTokens`) |
| `key-event` | Key created/suspended/deleted |
| `log` | Log entry |
| `system` | System notifications |
| `request-start` | A request entered the in-flight tracker (full `InFlightRequest` row) |
| `request-end` | A request left the tracker: `{ id, statusCode, durationMs, backendId }` |
| `live-tick` | Aggregate tick every 1 s while clients are connected: `{ point, inFlight, inFlightTotal, backends }` |

Note: embeddings requests are not usage-tracked today, so they do not appear in live or historical metrics.

---

## OpenAI-compatible endpoints

| Endpoint | Description |
|---|---|
| `GET /v1/models` | List all models (backend + v-models) |
| `POST /v1/chat/completions` | Chat completion (streaming + non-streaming) |
| `POST /v1/completions` | Legacy text completion |
| `POST /v1/embeddings` | Embeddings |
| `GET /health` | Health check |
| `GET /ready` | Readiness check |
| `GET /metrics` | Prometheus metrics |
