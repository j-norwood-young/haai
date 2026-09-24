# HAAI

High Availability AI — a streaming reverse proxy that turns your collection of LLM backends (Ollama, LM Studio, vLLM, OpenAI, and anything OpenAI-compatible) into one seamless, fault-tolerant AI service.

One endpoint for your apps; behind it HAAI handles virtual models, load balancing, failover, key management, and observability — with a built-in admin UI, CLI, and MCP server.

## Requirements

- Node.js 22 or newer

## Quickstart

```bash
npx @jasony/haai serve
```

That's it — HAAI boots in the background on **http://localhost:4000** with the admin UI, OpenAI-compatible API (`/v1/*`), management API (`/api/v1/*`), and Swagger docs (`/api/docs`) all on one port, and opens the browser for you.

Or install globally:

```bash
npm i -g @jasony/haai
haai serve          # boot server + admin UI (in the background)
haai stop           # stop the background server
haai status         # check a running instance
haai --help         # full CLI
```

Log in with the default admin account (`admin` / `admin`) — **change it immediately** in Settings.

Useful `serve` flags:

- `--port <n>` / `--host <addr>` — override the listen port/address
- `--no-open` — don't open the browser
- `--no-daemon` — run in the foreground (logs to the terminal) instead of the background; background output goes to `~/.haai/logs/haai.log`

Data lives in `~/.haai/` (`%USERPROFILE%\.haai` on Windows). Configuration comes from `HAAI_*` environment variables and `~/.haai/config.yaml` — see the [configuration guide](https://github.com/j-norwood-young/haai/tree/main/docs/guide/configuration.md).

## First backend + v-model

```bash
haai backend add --name local --base-url http://localhost:11434 --provider ollama --hostname local
haai vmodel create --model-id smart-chat --display-name "Smart Chat"
haai vmodel add-backend smart-chat --backend-id <backend-id> --backend-model llama3
```

Then call it like any OpenAI endpoint:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer haai-sk-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "smart-chat", "messages": [{"role": "user", "content": "Hello"}]}'
```

Create keys with `haai key create --name "my-app"`.

## MCP server

A Model Context Protocol server is also included — point your MCP client at:

```bash
haai-mcp
```

## Docker

Docker remains a supported install path — see [docker-compose.yml](https://github.com/j-norwood-young/haai/blob/main/docker-compose.yml) and the [Docker guide](https://github.com/j-norwood-young/haai/tree/main/docs/guide/docker.md).

## Using pnpm?

pnpm blocks dependency install scripts by default. After installing HAAI with pnpm (e.g. `pnpm add -g @jasony/haai`), approve the native-module builds once:

```bash
pnpm approve-builds   # approve better-sqlite3, isolated-vm, esbuild
```

## Links

- [Documentation](https://github.com/j-norwood-young/haai/tree/main/docs)
- [Quick start guide](https://github.com/j-norwood-young/haai/blob/main/docs/guide/quickstart.md)
- [CLI reference](https://github.com/j-norwood-young/haai/blob/main/docs/guide/cli.md)
- [Plugin authoring](https://github.com/j-norwood-young/haai/blob/main/docs/guide/plugin-authoring.md)

## License

[MIT](https://github.com/j-norwood-young/haai/blob/main/LICENSE)
