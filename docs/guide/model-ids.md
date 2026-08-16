# Model ID Convention

HAAI exposes two kinds of model IDs in `GET /v1/models`.

## Pass-through (backend) models

Format:

```
<backendModelId>:<hostName>:<provider>
```

Example — model `qwen3.5-35b` on LM Studio host `bob`:

```
qwen3.5-35b:bob:lmstudio
```

The proxy builds this ID from each backend's discovered models plus its `hostName` and `provider` fields.

### Colons in model names

If a backend model name contains colons, the parser treats the **last two** segments as `hostName:provider`. For example:

```
my:weird:model:bob:lmstudio
```

→ backend model `my:weird:model`, host `bob`, provider `lmstudio`.

## Virtual models

Plain aliases defined by admins:

```
smart-chat
fast-summarizer
```

No hostname or provider suffix.

## Using IDs in requests

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart-chat",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Key filtering

API keys can restrict which IDs a client sees and uses:

- `allowedModels` — list of v-model IDs (null = all v-models)
- `allowedBackends` — list of backend IDs for pass-through models (null = all)

See [Scopes & Capabilities](./key-scopes).

## Embeddings

Embedding requests require a **pass-through** model ID (not a v-model alias) unless the v-model has `allowEmbeddings: true` and is configured accordingly.
