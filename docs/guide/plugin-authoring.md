# Plugin Authoring

Plugins are TypeScript packages that hook into HAAI' request/response pipeline. They are distributed via npm or GitHub and run in sandboxed V8 isolates with no access to the host filesystem, network, or OS.

## Quick start

```bash
# Scaffold a new plugin
haai plugin create my-plugin

cd my-plugin
npm install

# Edit src/index.ts, then build
npm run build

# Install into the proxy
haai plugin install local:$(pwd)

# Bind it globally
haai plugin bind <pluginId> --scope global
```

## Plugin structure

A plugin is a Node.js package with:
- An `"haai-plugin"` key in `package.json` (the manifest)
- A default ESM export from the main entry (`definePlugin(...)`)

```ts
// src/index.ts
import { definePlugin, t, prependSystemPrompt } from "@haai/plugin-sdk";

export default definePlugin({
  name: "Talk like a Pirate",
  version: "1.0.0",
  description: "Makes responses use pirate speak",
  config: {
    intensity: t.select(["light", "full"], { label: "Intensity", default: "full" }),
  },
  needsResponseBuffer: false,
  hooks: {
    onRequest(request, ctx) {
      const instruction = ctx.config.intensity === "light"
        ? "Sprinkle in a few pirate words when appropriate. Arrr!"
        : "Talk exactly like a classic pirate: say 'Arrr', 'matey', 'ye scallywag'. Keep technical accuracy.";
      return prependSystemPrompt(request, instruction);
    },
  },
});
```

## Config fields

The `config` object in `definePlugin` uses the `t.*` field builders from `@haai/plugin-sdk`. Each field drives a UI input in the admin panel.

| Builder | UI | Value type |
|---------|-----|------------|
| `t.string({ label, description?, default? })` | Text input | `string` |
| `t.text({ label, ... })` | Textarea | `string` |
| `t.number({ label, min?, max?, default? })` | Number input | `number` |
| `t.boolean({ label, default? })` | Toggle switch | `boolean` |
| `t.select(options, { label, default? })` | Dropdown | one of `options` |
| `t.secret({ label })` | Password field (encrypted at rest) | `string` |
| `t.model({ label })` | Model picker (all backends + v-models) | model ID string |
| `t.backend({ label })` | Backend picker | backend ID string |

Config values are available as `ctx.config.<field>` inside your hooks, fully typed.

## The `package.json` manifest

The `"haai-plugin"` key is read at install time and must stay in sync with your `definePlugin` config:

```json
{
  "name": "@my-org/talk-like-a-pirate",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "haai-plugin": {
    "name": "Talk like a Pirate",
    "description": "Makes responses use pirate speak",
    "version": "1.0.0",
    "needsResponseBuffer": false,
    "hooks": ["onRequest"],
    "configSchema": {
      "intensity": {
        "type": "select",
        "label": "Intensity",
        "options": ["light", "full"],
        "default": "full"
      }
    }
  }
}
```

## Hook signatures

### `onRequest(request, ctx) → ChatRequest`

Called before the request is sent to the backend. Return a modified request to transform it. The proxy uses your returned value as the upstream body.

```ts
onRequest(request: ChatRequest, ctx: PluginContext): ChatRequest | Promise<ChatRequest>
```

### `onResponse(response, ctx) → ChatResponse`

Called after the backend's full response is available. Only invoked when `needsResponseBuffer: true`. Return a modified response.

```ts
onResponse(response: ChatResponse, ctx: PluginContext): ChatResponse | Promise<ChatResponse>
```

## The context object (`ctx`)

```ts
interface PluginContext {
  config: { /* typed from your config schema */ };
  vmodelId: string;          // Empty string for direct backend requests
  backendId: string;
  backendModelId: string;
  keyPrefix?: string;        // API key prefix (never the full key)
  timestamp: number;         // Request start (Unix ms)

  log(level: "debug"|"info"|"warn"|"error", message: string, data?: object): void;
  fetch(url: string, init?: { method?, headers?, body? }): Promise<{ ok, status, text(), json() }>;
  ai: {
    complete(opts: { model, messages, temperature?, max_tokens?, ... }): Promise<ChatResponse>;
  };
}
```

## Helper functions

```ts
import {
  prependSystemPrompt,  // Prepend text to the system prompt
  appendSystemPrompt,   // Append text to the system prompt
  mergeSystemPrompts,   // Collapse multiple system messages into one
  replaceInMessages,    // Find & replace across all message text
  setParam,            // Override a request parameter
} from "@haai/plugin-sdk";
```

## Scopes and bindings

A plugin can be bound to:
- **global** — applies to every request
- **vmodel** — applies to requests using a specific v-model
- **backend** — applies to requests routed to a specific backend
- **key** — applies to requests from a specific API key

Each binding can have its own config. Multiple bindings are executed in `order` (ascending).

```bash
haai plugin bind <pluginId> --scope global
haai plugin bind <pluginId> --scope vmodel --scope-id my-smart-model
haai plugin bind <pluginId> --scope backend --scope-id <backendId> --order 10
```

## Publishing

```bash
# Build TypeScript first
npm run build

# Publish to npm
npm publish --access public

# Anyone can then install via:
haai plugin install npm:@my-org/my-plugin

# Or from GitHub:
haai plugin install github:my-org/my-plugin-repo
```

## Sandboxing constraints

Plugins execute in V8 isolates (isolated-vm):
- **No Node.js built-ins**: `fs`, `net`, `child_process`, etc. are unavailable
- **No raw network**: use `ctx.fetch` (host-mediated, allow-listed)
- **Memory limit**: 64 MB per plugin
- **Timeout**: 10 seconds per hook call
- Dependencies must be pure JavaScript — no native add-ons

The bundler (esbuild) packs your entire plugin + its `node_modules` into one self-contained file at install time. Anything that cannot be bundled to a single file will fail.

## Response-transform plugins

Set `needsResponseBuffer: true` to receive the full upstream response in `onResponse`. This causes the proxy to buffer the entire stream before responding to the client — only use it when required (e.g. translation, summarisation).

```ts
export default definePlugin({
  ...
  needsResponseBuffer: true,
  hooks: {
    async onResponse(response, ctx) {
      const text = response.choices[0]?.message.content ?? "";
      const summary = await ctx.ai.complete({
        model: ctx.config.summaryModel,
        messages: [
          { role: "system", content: "Summarise the following in 3 bullet points." },
          { role: "user", content: text },
        ],
      });
      const bullets = summary.choices[0]?.message.content ?? text;
      return {
        ...response,
        choices: response.choices.map((c, i) =>
          i === 0 ? { ...c, message: { ...c.message, content: bullets } } : c
        ),
      };
    },
  },
});
```

## Example plugins

See `examples/plugins/` for three fully working examples:
- `talk-like-a-pirate` — `onRequest` system prompt injection
- `caveman` — token compression via caveman-style instructions
- `vllm-system-prompt-fix` — merges multiple system messages for strict vLLM backends
