# Virtual Models (V-Models)

A **virtual model** is a user-facing alias that maps to one or more backends. Clients request `smart-chat` instead of `qwen3.5-35b:bob:lmstudio`.

## Why use v-models?

- Stable model names when backends change
- Load balancing across multiple GPUs or machines
- Per-model balancing strategy

## Kind: chat vs. embedding

Every v-model has a `kind` of either `chat` or `embedding`, which determines which
endpoint it's reachable on:

- `chat` (the default) — only reachable via `POST /v1/chat/completions`.
- `embedding` — only reachable via `POST /v1/embeddings`.

A request for the wrong endpoint returns `400` with `code: "model_not_supported"`. This
is enforced twice: once against the v-model's own `kind`, and once per mapped backend
model (using its known or heuristically-guessed kind), so a backend model added by
mistake can't leak onto the wrong endpoint even if it slips past validation.

`kind` is set at creation — explicitly, or inferred as `embedding` when every backend
model supplied at creation positively classifies as an embedding model (otherwise it
defaults to `chat`). It is **immutable once the v-model has any mapped backends**;
`PATCH`ing `kind` on a v-model with members returns `409`. Adding a backend model whose
kind contradicts the v-model's `kind` is rejected with `400`.

## Create a v-model

```bash
haai vmodel create --model-id smart-chat --display-name "Smart Chat" --kind chat
haai vmodel add-backend smart-chat \
  --backend-id backend-abc123 \
  --backend-model qwen3.5-35b \
  --weight 1
```

## Via API

```bash
curl -X POST http://localhost:4000/api/v1/vmodels \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "smart-chat",
    "displayName": "Smart Chat",
    "balancingStrategy": "session-pin",
    "kind": "chat",
    "streaming": true,
    "backends": [
      { "backendId": "backend-abc123", "backendModelId": "qwen3.5-35b", "weight": 1 }
    ]
  }'
```

## Defaults

| Field | Default |
|-------|---------|
| `balancingStrategy` | `session-pin` |
| `kind` | `chat` |
| `streaming` | `true` |
| `enabled` | `true` |

## Streaming

| Field | Effect |
|------|--------|
| `streaming` | When `false`, response is buffered (needed for some post-processing) |

::: warning Deprecated capability flags
`allowToolCalling`, `allowVision`, and `allowEmbeddings` still exist on the v-model API
for backward compatibility, but **none of them are enforced** — they're never read by any
routing code. Use a v-model's `kind` to gate embeddings, and an API key's own
`allowToolCalling` / `allowVision` / `allowEmbeddings` scopes (see [Key Scopes](./key-scopes))
to gate tool calling, vision, and embeddings per key.
:::

## Related

- [Model ID Convention](./model-ids)
- [Load Balancing](./balancing)
- [High Availability](./ha)
