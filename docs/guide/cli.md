# CLI

The `aivm` command-line tool manages the proxy without opening the web UI.

## Install

From the repo:

```bash
pnpm aivm --help
# or after build:
node packages/cli/dist/index.js --help
```

## Global options

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `-u, --url` | `AIVM_URL` | `http://localhost:4000` | Proxy base URL |
| `-t, --token` | `AIVM_ADMIN_TOKEN` | — | Admin Bearer token |

## Commands

### Status & config

```bash
aivm status
aivm config
```

### Backends

```bash
aivm backend list
aivm backend add --name ... --base-url ... --provider ... --hostname ...
aivm backend test <name>
aivm backend remove <name>
```

### Virtual models

```bash
aivm vmodel list
aivm vmodel create --model-id smart-chat
aivm vmodel add-backend smart-chat --backend-id ... --backend-model ...
aivm vmodel delete smart-chat
```

### API keys

```bash
aivm key list
aivm key create --name my-app --day-budget 100000
aivm key suspend <id> --reason "..."
aivm key resume <id>
aivm key logs <id> --limit 50
aivm key delete <id>
```

### Hooks

```bash
aivm hook list
aivm hook add-internal --name ... --module ... --trigger pre-request
aivm hook add-webhook --name ... --webhook-url ... --trigger ...
aivm hook test <name>
aivm hook delete <name>
```

### Plugins

```bash
aivm plugin list
aivm plugin install <package>
aivm plugin enable <id>
aivm plugin bind <id> --vmodel smart-chat
```

### Admin tokens

```bash
aivm admin-token list
aivm admin-token create --name ci-bot --expires-in 90
aivm admin-token revoke <id>
```

### Users (direct database)

```bash
aivm user list
aivm user create --username jason --password '...' --role viewer
aivm user set-password --username jason --password '...'
```

### Inference

```bash
aivm prompt "Hello!" -k aivm-sk-... -m smart-chat
```

Uses `AIVM_API_KEY` / `AIVM_API_KEY` when `-k` is omitted.

## Shell completion

```bash
aivm completion bash >> ~/.bashrc
```

## Related

- [Quick Start](./quickstart)
- [REST API](../api/rest)
