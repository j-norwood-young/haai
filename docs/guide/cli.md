# CLI

The `haai` command-line tool manages the proxy without opening the web UI.

## Install

From the repo:

```bash
pnpm haai --help
# or after build:
node packages/cli/dist/index.js --help
```

## Global options

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `-u, --url` | `HAAI_URL` | auto (`:4000` / `:4001`) | Proxy base URL. When unset, probes `http://localhost:4000` then `:4001` (`pnpm start` vs `pnpm dev`) |
| `-t, --token` | `HAAI_ADMIN_TOKEN` | — | Admin Bearer token (also read from `.env` in the working directory) |

## Commands

### Status & config

```bash
haai status
haai config
```

### Backends

```bash
haai backend list
haai backend add --name ... --base-url ... --provider ... --hostname ...
haai backend test <name>
haai backend remove <name>
```

### Virtual models

```bash
haai vmodel list
haai vmodel create --model-id smart-chat
haai vmodel add-backend smart-chat --backend-id ... --backend-model ...
haai vmodel delete smart-chat
```

### API keys

```bash
haai key list
haai key create --name my-app --day-budget 100000
haai key suspend <id> --reason "..."
haai key resume <id>
haai key logs <id> --limit 50
haai key delete <id>
```

### Hooks

```bash
haai hook list
haai hook add-internal --name ... --module ... --trigger pre-request
haai hook add-webhook --name ... --webhook-url ... --trigger ...
haai hook test <name>
haai hook delete <name>
```

### Plugins

```bash
haai plugin list
haai plugin install <package>
haai plugin enable <id>
haai plugin bind <id> --vmodel smart-chat
```

### Admin tokens

```bash
haai admin-token list
haai admin-token create --name ci-bot --expires-in 90
haai admin-token revoke <id>
```

### Users (direct database)

```bash
haai user list
haai user create --username jason --password '...' --role viewer
haai user set-password --username jason --password '...'
```

### Inference

```bash
haai prompt "Hello!" -k haai-sk-... -m smart-chat
```

Uses `HAAI_API_KEY` / `HAAI_API_KEY` when `-k` is omitted.

## Shell completion

```bash
haai completion bash >> ~/.bashrc
```

## Related

- [Quick Start](./quickstart)
- [REST API](../api/rest)
