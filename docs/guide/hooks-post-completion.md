# Post-Completion Hooks

Post-completion hooks run **after** a chat response finishes. Use them for logging, analytics, or response transformation.

## Streaming vs non-streaming

| V-model `streaming` | Internal hook | Webhook |
|---------------------|---------------|---------|
| `true` (default) | Not mutating — fire-and-forget | Fire-and-forget |
| `false` | Can return modified response | Response ignored |

Set `streaming: false` on the v-model when you need to buffer and transform the full response.

## Internal hook

```typescript
import type { PostCompletionHook } from "@haai/hooks-sdk";

const hook: PostCompletionHook = async (response, ctx) => {
  // log, transform, or return modified response (non-streaming only)
  return response;
};

export default hook;
```

## Webhook contract

**POST** body:

```json
{
  "response": { "id": "...", "choices": [...], "usage": {...} },
  "ctx": { "vmodelId": "...", "keyPrefix": "...", "timestamp": 1710000000000 }
}
```

For streaming v-models the response body is ignored.

## Register

```bash
haai hook add-internal --name audit-log --module ./audit-hook.js --trigger post-completion

haai hook add-webhook \
  --name completion-webhook \
  --webhook-url https://example.com/haai-complete \
  --trigger post-completion
```

## Related

- [Hooks Overview](./hooks)
- [Authoring Hooks](./hooks-authoring)
