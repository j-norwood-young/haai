# OpenAI / Generic

Use the `openai` or `generic` provider label for any OpenAI-compatible HTTP API — OpenAI itself, Azure OpenAI-compatible gateways, LiteLLM, etc.

## OpenAI

```bash
haai backend add \
  --name openai-main \
  --base-url https://api.openai.com/v1 \
  --provider openai \
  --hostname cloud \
  --mode abstraction \
  --api-key sk-...
```

Always use **abstraction** mode so your OpenAI key is not exposed to clients.

## Generic

Use `generic` when the upstream is OpenAI-compatible but not one of the named providers:

```bash
haai backend add \
  --name litellm-gateway \
  --base-url https://gateway.internal/v1 \
  --provider generic \
  --hostname gateway \
  --mode abstraction \
  --api-key $GATEWAY_KEY
```

The provider label only affects model ID namespacing — routing uses the same OpenAI endpoints for all providers.

## Model IDs

```
gpt-4o:cloud:openai
my-model:gateway:generic
```

## Tips

- Set token budgets on client keys when proxying paid APIs — see [Rate Limiting & Budgets](./rate-limits).
- Restrict keys with [Scopes & Capabilities](./key-scopes) to specific v-models or backends.
