# Pre-Request Hooks

Pre-request hooks run **before** the proxy forwards a chat completion to the backend. They can inspect and mutate the OpenAI request body.

## Internal hook

Export a default async function:

```typescript
import type { PreRequestHook } from "@haai/hooks-sdk";
import { prependSystemPrompt } from "@haai/hooks-sdk";

const hook: PreRequestHook = async (request, ctx) => {
  return prependSystemPrompt(request, "You are a helpful assistant.");
};

export default hook;
```

## Webhook contract

**POST** your URL with JSON body:

```json
{
  "request": { "model": "smart-chat", "messages": [...] },
  "ctx": {
    "vmodelId": "vmodel-abc",
    "backendId": "backend-xyz",
    "backendModelId": "qwen3.5-35b",
    "keyPrefix": "haai-sk-Xn7",
    "timestamp": 1710000000000,
    "config": {}
  }
}
```

Return:

```json
{
  "request": { "model": "smart-chat", "messages": [...] }
}
```

## Headers (webhooks)

| Header | Description |
|--------|-------------|
| `X-HAAI-Hook-Trigger` | `pre-request` |
| `X-HAAI-Signature` | `sha256=<hmac>` when `webhookSecret` is set |

## Failure behavior

On timeout or error, the proxy continues with the **original** unmodified request (fail-open).

Default timeout: **5000 ms** (configurable per hook).

## SDK helpers

```typescript
import {
  prependSystemPrompt,
  appendSystemPrompt,
  replaceInMessages,
  setParam,
} from "@haai/hooks-sdk";
```

See [Authoring Hooks](./hooks-authoring) for full examples.
