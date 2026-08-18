# Publishing Hooks to NPM

Share hooks as NPM packages so others can install them with one command.

## Package structure

```
my-haai-hook/
  package.json
  src/index.ts
  dist/index.js
```

## package.json manifest

```json
{
  "name": "my-haai-hook",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "haai-hook": {
    "name": "My Hook",
    "description": "Prepends a system prompt",
    "trigger": "pre-request",
    "configSchema": {
      "type": "object",
      "properties": {
        "systemPromptPrefix": { "type": "string" }
      }
    }
  },
  "dependencies": {
    "@haai/hooks-sdk": "^0.2.2"
  }
}
```

The `haai-hook` key is required — the installer validates it.

## Publish

```bash
npm publish
```

## Install on a server

```bash
haai hook add-internal \
  --name my-hook \
  --module my-haai-hook \
  --trigger pre-request
```

Modules are copied to `{HAAI_DATA_DIR}/hooks/`.

## Install from GitHub

```bash
npm install github:owner/repo#v1.0.0 --prefix ~/.haai/hooks

haai hook add-internal \
  --name github-hook \
  --module ~/.haai/hooks/node_modules/my-haai-hook/dist/index.js \
  --trigger pre-request
```

## Related

- [Authoring Hooks](./hooks-authoring) — full SDK reference and webhook signing
