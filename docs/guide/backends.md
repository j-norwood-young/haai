# Adding Backends

A **backend** is an upstream OpenAI-compatible LLM server. HAAI proxies `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings` to it.

## Required fields

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (e.g. `lmstudio-bob`) |
| `hostName` | Short hostname label used in model IDs (e.g. `bob`) |
| `provider` | `lmstudio`, `ollama`, `vllm`, `omlx`, `openai`, or `generic` |
| `baseUrl` | Base URL of the upstream API |

`hostName` must be **globally unique across all backends**, regardless of `provider`.
It's the sole differentiator in every pass-through model ID
(`<model>:<hostName>:<provider>`, see [Model ID Convention](./model-ids)) — two backends
sharing a `hostName` would produce model IDs that differ only by provider suffix, which
isn't a meaningful distinction to an end user picking a model from a list, and the
direct namespaced lookup would only ever reach one of them anyway. HAAI rejects creating
a second backend with a `hostName` already in use (`409 Conflict`), even under a
different provider — if one machine runs both vLLM and LM Studio, give it two distinct
host labels (e.g. `bob-vllm` and `bob-lmstudio`).

Neither `hostName` nor `provider` can be changed after creation (delete and re-create
instead), since changing either would silently break any client already using the old
model IDs.

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

## Model kind classification

Alongside each health check, HAAI classifies every model the backend reports as `llm`,
`vlm`, or `embeddings` — this is what powers the `type` field in `GET /v1/models` and the
kind guard on v-models (see [Virtual Models](./vmodels#kind-chat-vs-embedding)).

- **LM Studio** (`provider: "lmstudio"`) — probed via `GET /api/v0/models`, which reports
  a native `type` per model.
- **Ollama** (`provider: "ollama"`) — probed via `POST /api/show` per model, using its
  `capabilities` array (`"embedding"` vs `"completion"`).
- **vLLM, OpenAI, and generic backends** have no native signal, so classification falls
  back to a heuristic on the model's id (patterns like `embed`, `bge-`, `gte-`, `e5-`,
  `minilm`, etc. classify as `embeddings`; anything else is treated as `llm`). A model
  whose name doesn't hint at its purpose (e.g. an oddly-named embedding model on a vLLM
  host) will be misclassified as `llm` until you give it a name the heuristic recognizes.

A probe failure (unsupported endpoint, timeout) never affects the backend's reported
health or latency — it just leaves that backend's models on the heuristic fallback.

## Provider guides

- [LM Studio](./providers/lmstudio)
- [Ollama](./providers/ollama)
- [vLLM](./providers/vllm)
- [oMLX](./providers/omlx)
- [OpenAI / Generic](./providers/openai)
- [Key Modes](./key-modes)
