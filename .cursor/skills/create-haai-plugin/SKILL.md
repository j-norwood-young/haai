# Skill: Create a HAAI Plugin

Use this skill whenever you need to create a new plugin for the HAAI reverse proxy.

## What is a plugin?

A plugin is a TypeScript package that hooks into the proxy's request/response pipeline. Plugins run in isolated V8 sandboxes (no filesystem, no network, no Node.js builtins). They communicate with the host through a typed capability API (`ctx.ai.complete`, `ctx.log`, `ctx.fetch`).

## Quick scaffold

```bash
haai plugin create my-plugin-name
cd my-plugin-name
npm install
```

This creates:
- `package.json` — includes the required `"haai-plugin"` manifest
- `src/index.ts` — the plugin implementation
- `tsconfig.json` — TypeScript config
- `README.md`

## Plugin structure

```ts
// src/index.ts
import { definePlugin, t, prependSystemPrompt } from "@haai/plugin-sdk";

export default definePlugin({
  name: "My Plugin",
  version: "1.0.0",
  description: "What this plugin does",

  // Config schema — drives the auto-generated admin UI
  config: {
    intensity: t.select(["light", "full", "ultra"], {
      label: "Intensity level",
      description: "How strongly to apply the effect",
      default: "full",
    }),
    addPrefix: t.boolean({ label: "Add prefix", default: true }),
    systemPromptExtra: t.text({
      label: "Extra system prompt text",
      description: "Appended to every system prompt",
    }),
    targetModel: t.model({ label: "Model to use for processing" }),
  },

  // Set to true only if your onResponse hook needs the complete response text
  needsResponseBuffer: false,

  hooks: {
    // Called before the request is sent to the backend
    onRequest(request, ctx) {
      // ctx.config is fully typed based on your config schema above
      if (ctx.config.intensity === "light") {
        return prependSystemPrompt(request, "Be concise.");
      }
      return prependSystemPrompt(request, "Be very concise and direct.");
    },

    // Called after the upstream response (only when needsResponseBuffer: true)
    // onResponse(response, ctx) {
    //   return response;
    // },
  },
});
```

## Config field types

| Builder | UI control | Value type |
|---------|------------|------------|
| `t.string(opts)` | Text input | `string` |
| `t.text(opts)` | Textarea | `string` |
| `t.number(opts)` | Number input | `number` |
| `t.boolean(opts)` | Toggle switch | `boolean` |
| `t.select(options, opts)` | Dropdown | `string` (one of options) |
| `t.secret(opts)` | Password input (encrypted) | `string` |
| `t.model(opts)` | Model picker (all backends + v-models) | `string` (model ID) |
| `t.backend(opts)` | Backend picker | `string` (backend ID) |

All builders accept: `label` (required), `description`, `default`, `required`.

## Capability API (`ctx`)

Inside hooks, `ctx` provides:

```ts
ctx.config        // Typed config values for this binding
ctx.vmodelId      // V-model ID (empty string for direct backend)
ctx.backendId     // Selected backend ID
ctx.backendModelId // Backend model ID being used
ctx.keyPrefix     // API key prefix
ctx.timestamp     // Request start time (ms)

// Run a chat completion through the proxy's own backends
ctx.ai.complete({ model, messages, temperature?, max_tokens? })

// Log a message (appears in proxy logs)
ctx.log("info" | "warn" | "error" | "debug", message, data?)

// Fetch a URL (host-allowlisted)
ctx.fetch(url, { method?, headers?, body? })
```

## Helper functions

```ts
import {
  prependSystemPrompt,   // Add text before existing system prompt
  appendSystemPrompt,    // Add text after existing system prompt
  mergeSystemPrompts,    // Merge multiple system messages into one (for vLLM)
  replaceInMessages,     // Find & replace in all message content
  setParam,             // Override a request param (e.g. temperature)
} from "@haai/plugin-sdk";
```

## The `"haai-plugin"` manifest (in `package.json`)

```json
{
  "haai-plugin": {
    "name": "My Plugin",
    "description": "Short description",
    "version": "1.0.0",
    "needsResponseBuffer": false,
    "hooks": ["onRequest"],
    "configSchema": {
      "intensity": {
        "type": "select",
        "label": "Intensity",
        "options": ["light", "full", "ultra"],
        "default": "full"
      }
    }
  }
}
```

Keep `configSchema` in sync with the `config` object passed to `definePlugin`. The proxy reads the manifest at install time to power the config UI.

## Build and install

```bash
# Build
npm run build

# Install locally into a running proxy
haai plugin install local:/absolute/path/to/your/plugin

# Bind globally (applies to all requests)
haai plugin bind <pluginId> --scope global

# Bind to a specific v-model
haai plugin bind <pluginId> --scope vmodel --scope-id my-model-id

# Bind to a specific backend
haai plugin bind <pluginId> --scope backend --scope-id <backendId>

# Publish to npm then install
npm publish
haai plugin install npm:@my-org/my-plugin
```

## Sandboxing constraints

Plugins run in V8 isolates with:
- No `fs`, `net`, `os`, `child_process`, or any Node.js built-ins
- No `fetch` / `XMLHttpRequest` (use `ctx.fetch` instead — it is host-mediated)
- No `require()` or `import()` at runtime
- Memory limit: 64 MB
- Wall-clock timeout: 10 seconds per hook call

Code that imports Node built-ins will fail at bundle time. Keep your plugin's dependencies to pure JavaScript/TypeScript utilities.

## Response-transform plugins

For plugins that need to read or modify the full response (translation, summarisation, etc.):

```json
{ "haai-plugin": { "needsResponseBuffer": true, "hooks": ["onRequest", "onResponse"] } }
```

```ts
hooks: {
  onResponse(response, ctx) {
    // response.choices[0].message.content contains the full text
    const original = response.choices[0]?.message.content ?? "";
    const transformed = original.toUpperCase(); // example
    return {
      ...response,
      choices: response.choices.map((c, i) =>
        i === 0 ? { ...c, message: { ...c.message, content: transformed } } : c
      ),
    };
  },
}
```

**Warning:** Setting `needsResponseBuffer: true` causes the proxy to buffer the entire upstream stream before responding to the client. This adds latency proportional to generation time. Use only when necessary.

## Using `ctx.ai.complete` (AI-in-the-middle)

```ts
hooks: {
  async onResponse(response, ctx) {
    const content = response.choices[0]?.message.content ?? "";
    const translated = await ctx.ai.complete({
      model: ctx.config.translationModel, // from your config
      messages: [
        { role: "system", content: "Translate the following text to French." },
        { role: "user", content },
      ],
      max_tokens: 2000,
    });
    const translatedText = translated.choices[0]?.message.content ?? content;
    return {
      ...response,
      choices: response.choices.map((c, i) =>
        i === 0 ? { ...c, message: { ...c.message, content: translatedText } } : c
      ),
    };
  },
}
```

## Testing your plugin locally

Use `haai plugin install local:<path>` to install from your local directory, then bind it and make a test request through the proxy. The proxy logs show plugin execution details.

The admin UI at `/plugins` lets you manage bindings and configure per-binding settings through the auto-generated config form.
