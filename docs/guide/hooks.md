# Hooks Overview

Hooks extend HAAI with custom logic at two points in the request lifecycle.

| Trigger | When | Can mutate? |
|---------|------|-------------|
| `pre-request` | Before forwarding to the backend | Yes — messages, parameters |
| `post-completion` | After the response completes | Internal hooks only when `streaming: false` on the v-model |

## Hook types

### Internal

Node.js modules run in worker threads. Install from NPM or a local path.

```bash
haai hook add-internal \
  --name my-hook \
  --module my-haai-hook \
  --trigger pre-request
```

### External (webhooks)

HTTP POST to your URL with optional HMAC signature (`X-HAAI-Signature`).

```bash
haai hook add-webhook \
  --name my-webhook \
  --webhook-url https://example.com/haai-hook \
  --trigger pre-request \
  --secret my-secret \
  --timeout 5000
```

## Hooks vs plugins

| | Hooks | Plugins |
|---|-------|---------|
| SDK | `@haai/hooks-sdk` | `@haai/plugin-sdk` |
| Runtime | Worker threads / webhooks | V8 isolates |
| Request mutation in chat path | Registered in DB; pipeline integration in progress | **Active today** |
| Admin UI | `/hooks` | `/plugins` |

For production request mutation today, prefer **plugins**. Hooks are fully manageable via API/CLI/UI and documented for authoring; wire-up into the hot path is ongoing.

## Manage hooks

```bash
haai hook list
haai hook test my-hook
haai hook delete my-hook
```

## Learn more

- [Pre-Request Hooks](./hooks-pre-request)
- [Post-Completion Hooks](./hooks-post-completion)
- [Authoring Hooks](./hooks-authoring)
- [Publishing to NPM](./hooks-publishing)
