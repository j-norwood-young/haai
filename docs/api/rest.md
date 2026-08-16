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

### Summary (24h)
`GET /api/v1/metrics/summary`

### Rollups
`GET /api/v1/metrics/rollups?period=hour&keyId=...&vmodelId=...&since=...&limit=48`

### Events
`GET /api/v1/metrics/events?limit=100&keyId=...`

---

## Live Events (SSE)

`GET /api/v1/events`

Establishes a Server-Sent Events stream. Events:

| Event type | Description |
|---|---|
| `backend-health` | Backend health status changes |
| `usage-event` | New usage event recorded |
| `key-event` | Key created/suspended/deleted |
| `log` | Log entry |
| `system` | System notifications |

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
