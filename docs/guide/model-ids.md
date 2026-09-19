# Model ID Convention

HAAI exposes two kinds of model IDs in `GET /v1/models`. Each entry also carries an
LM Studio-style `type` field — `"llm"`, `"vlm"`, or `"embeddings"` — telling clients
which endpoint the model belongs on. See [Virtual Models](./vmodels#kind-chat-vs-embedding)
for how that classification is enforced.

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

`POST /v1/embeddings` accepts either a pass-through model ID, or an `embedding`-kind
v-model alias (see [Virtual Models](./vmodels#kind-chat-vs-embedding)). A `chat`-kind
v-model alias — the default — returns `400` on `/v1/embeddings`, and an embedding model
returns `400` on `/v1/chat/completions`, regardless of which ID form is used to reach it.
