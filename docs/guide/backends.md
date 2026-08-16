# Adding Backends

A **backend** is an upstream OpenAI-compatible LLM server. HAAI proxies `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings` to it.

## Required fields

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (e.g. `lmstudio-bob`) |
| `hostName` | Short hostname label used in model IDs (e.g. `bob`) |
| `provider` | `lmstudio`, `ollama`, `vllm`, `openai`, or `generic` |
| `baseUrl` | Base URL of the upstream API |

## Add via CLI

```bash
haai backend add \
  --name lmstudio-bob \
  --base-url http://192.168.1.100:1234 \
  --provider lmstudio \
  --hostname bob \
  --mode passthrough
```

For backends that require their own API key, use abstraction mode:

```bash
haai backend add \
  --name openai-main \
  --base-url https://api.openai.com/v1 \
  --provider openai \
  --hostname cloud \
  --mode abstraction \
  --api-key sk-...
```

## Add via API

```bash
curl -X POST http://localhost:4000/api/v1/backends \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "lmstudio-bob",
    "displayName": "LM Studio (Bob)",
    "hostName": "bob",
    "provider": "lmstudio",
    "baseUrl": "http://192.168.1.100:1234",
    "keyMode": "passthrough",
    "enabled": true,
    "weight": 1
  }'
```

## Test connectivity

```bash
haai backend test lmstudio-bob
# or
curl -X POST http://localhost:4000/api/v1/backends/<id>/test \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Returns latency and discovered models.

## Defaults

When created, backends get:

- `keyMode`: `passthrough`
- `weight`: `1`
- `maxConcurrency`: `10` (stored, not enforced yet)
- `healthCheckEnabled`: `true`
- `enabled`: `true`

## Health status

Each backend tracks `lastHealthStatus` (`healthy`, `degraded`, `unhealthy`), `lastLatencyMs`, and `lastCheckedAt`. Health checks call `GET {baseUrl}/v1/models` on the interval set by `health.checkIntervalSecs`.

See [High Availability](./ha) for failover behavior.

## Provider guides

- [LM Studio](./providers/lmstudio)
- [Ollama](./providers/ollama)
- [vLLM](./providers/vllm)
- [OpenAI / Generic](./providers/openai)
- [Key Modes](./key-modes)
