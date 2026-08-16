# Scopes & Capabilities

API keys control **what** clients can access and **which features** they can use.

## Model allow lists

| Field | Scope |
|-------|-------|
| `allowedModels` | JSON array of v-model IDs; `null` = all v-models |
| `allowedBackends` | JSON array of backend IDs for pass-through models; `null` = all backends |

If both lists are set, the key must match at least one allowed source for each request type.

```bash
haai key create --name app-a \
  --models smart-chat,fast-summarizer

haai key create --name gpu-only \
  --backends backend-gpu1,backend-gpu2
```

## Capability flags

Checked on every inference request:

| Flag | Default | Effect when `false` |
|------|---------|---------------------|
| `allowToolCalling` | `true` | Reject requests with tools / tool_choice |
| `allowVision` | `false` | Reject image content in messages |
| `allowEmbeddings` | `false` | Reject `/v1/embeddings` |

```bash
haai key create --name no-tools --no-tools
```

## `/v1/models` filtering

`GET /v1/models` only returns models the key is allowed to use. This prevents clients from discovering restricted backends.

## Embeddings

Embedding requests require:

1. `allowEmbeddings: true` on the key
2. A pass-through model ID the key can access (or appropriate v-model configuration)

## Related

- [Key Management](./keys)
- [Model ID Convention](./model-ids)
