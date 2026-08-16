# Virtual Models (V-Models)

A **virtual model** is a user-facing alias that maps to one or more backends. Clients request `smart-chat` instead of `qwen3.5-35b:bob:lmstudio`.

## Why use v-models?

- Stable model names when backends change
- Load balancing across multiple GPUs or machines
- Centralized capability flags (tools, vision, embeddings)
- Per-model balancing strategy

## Create a v-model

```bash
haai vmodel create --model-id smart-chat --display-name "Smart Chat"
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
    "streaming": true,
    "allowToolCalling": true,
    "backends": [
      { "backendId": "backend-abc123", "backendModelId": "qwen3.5-35b", "weight": 1 }
    ]
  }'
```

## Defaults

| Field | Default |
|-------|---------|
| `balancingStrategy` | `session-pin` |
| `streaming` | `true` |
| `allowToolCalling` | `true` |
| `allowVision` | `false` |
| `allowEmbeddings` | `false` |
| `enabled` | `true` |

## Capability flags

| Flag | Effect |
|------|--------|
| `allowToolCalling` | Reject tool-use requests when `false` |
| `allowVision` | Reject image inputs when `false` |
| `allowEmbeddings` | Reject embedding requests when `false` |
| `streaming` | When `false`, response is buffered (needed for some post-processing) |

## Related

- [Model ID Convention](./model-ids)
- [Load Balancing](./balancing)
- [High Availability](./ha)
