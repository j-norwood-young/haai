# Authoring Hooks

Hooks extend HAAI with custom pre-request mutations and post-completion callbacks.

## Hook types

| Type | When | Can mutate? |
|---|---|---|
| `pre-request` | Before the request is sent to the backend | Yes — modify messages, params |
| `post-completion` | After the stream completes | Only if v-model has `streaming: false` |

## Internal hooks (NPM / local)

Create a Node.js module that exports a default function:

```typescript
// my-hook/index.ts
import type { PreRequestHook } from "@haai/hooks-sdk";
import { prependSystemPrompt } from "@haai/hooks-sdk";

const hook: PreRequestHook = async (request, ctx) => {
  const prefix = ctx.config["systemPromptPrefix"] as string ?? "";
  if (prefix) {
    return prependSystemPrompt(request, prefix);
  }
  return request;
};

export default hook;
```

### Hook manifest (package.json)

```json
{
  "name": "my-haai-hook",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "haai-hook": {
    "name": "My System Prompt Hook",
    "description": "Prepends a system prompt prefix",
    "trigger": "pre-request",
    "configSchema": {
      "type": "object",
      "properties": {
        "systemPromptPrefix": { "type": "string" }
      }
    }
  }
}
```

### Register the hook

```bash
# Install from NPM
haai hook add-internal --name my-hook --module my-haai-hook --trigger pre-request

# Install from local path
haai hook add-internal --name my-hook --module /path/to/hook/dist/index.js --trigger pre-request
```

## External hooks (webhooks)

External hooks receive a POST request and return a JSON response:

### Pre-request webhook

**Request body:**
```json
{
  "request": { "model": "...", "messages": [...] },
  "ctx": { "vmodelId": "...", "keyPrefix": "..." }
}
```

**Expected response:**
```json
{
  "request": { "model": "...", "messages": [...] }
}
```

Return the (potentially modified) `request` object.

### Post-completion webhook

**Request body:**
```json
{
  "response": { "id": "...", "choices": [...] },
  "ctx": { "vmodelId": "...", "keyPrefix": "..." }
}
```

Response body is ignored for streaming v-models.

### Webhook signature verification

All webhooks include an `X-HAAI-Signature: sha256=<hmac>` header when a `webhookSecret` is configured. Verify it in your handler:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### Register a webhook

```bash
haai hook add-webhook \
  --name my-webhook \
  --webhook-url https://my-server.example.com/haai-hook \
  --trigger pre-request \
  --secret my-signing-secret \
  --timeout 5000
```

## Hook SDK helpers

```typescript
import {
  prependSystemPrompt,
  appendSystemPrompt,
  replaceInMessages,
  setParam,
} from "@haai/hooks-sdk";

// Prepend to system prompt
const req2 = prependSystemPrompt(request, "Always respond in French.");

// Set temperature
const req3 = setParam(request, "temperature", 0.7);

// Replace text in all messages
const req4 = replaceInMessages(request, "REPLACE_ME", "actual value");
```

## Hook context

Every hook receives a `HookContext`:

```typescript
interface HookContext {
  vmodelId: string;        // Virtual model ID
  backendModelId: string;  // Backend model ID
  backendId: string;       // Backend ID
  keyPrefix?: string;      // Key prefix (never the full key)
  timestamp: number;       // Unix ms
  config: Record<string, unknown>; // Hook configuration
}
```

## Installing from GitHub

```bash
# Install hook directly from GitHub
npm install github:owner/repo#tag --prefix ~/.haai/hooks
haai hook add-internal \
  --name github-hook \
  --module ~/.haai/hooks/node_modules/repo-name/dist/index.js \
  --trigger pre-request
```
