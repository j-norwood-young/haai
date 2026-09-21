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

### Serve

`haai serve` starts HAAI **in the background** (as a daemon), waits until it is healthy, opens the admin UI, and returns your shell. The server keeps running after you close the terminal.

```bash
haai serve                 # start in the background (default port 4000) and open the admin UI
haai serve --port 5000     # custom listen port
haai serve --no-open       # don't open the browser
haai serve --no-daemon     # run in the foreground, logging to the terminal (Ctrl+C to stop)
haai stop                  # stop the background server
haai stop --force          # SIGKILL it if it's hung
```

While running in the background, HAAI writes its output to `<data dir>/logs/haai.log` (`~/.haai/logs/haai.log` by default) and its PID to `<data dir>/haai.pid`. The log file is not rotated. `haai stop` only stops an instance started by `haai serve`; it refuses to signal a PID it can't confirm is answering as HAAI unless you pass `--force`. Running `haai serve` while an instance is already up just reports it (and opens the UI).

Use `--no-daemon` under a process manager (systemd, launchd, Docker, …) or for debugging.

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
haai plugin install <source> [--name <name>] [--upgrade]
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
haai prompt 'Hello!' -k haai-sk-... -m smart-chat
haai models -k haai-sk-...
```

`haai models` prints the model IDs the key can use (one per line) — the same list as `GET /v1/models`.

Uses `HAAI_API_KEY` / `HAAI_API_KEY` when `-k` is omitted.

## Shell completion

```bash
haai completion bash >> ~/.bashrc
```

## Related

- [Quick Start](./quickstart)
- [REST API](../api/rest)
