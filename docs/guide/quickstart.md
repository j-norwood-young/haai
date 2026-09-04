# Quick Start

Get HAAI running in under a minute. Two options: Docker (fastest) or Node.js (full control).

## Docker (fastest)

The quickest way to get HAAI running:

```bash
git clone https://github.com/j-norwood-young/haai.git
cd haai

# Optional: customise settings
cp .env.example .env
# Edit .env if you want to change the port, admin password, session secret, etc.

# Start everything
docker compose up -d
```

HAAI is live at **http://localhost:4000** — admin UI, API, docs, and Swagger all on one port. Data persists in the `haai-data` Docker volume.

Default login is `admin` / `admin` — change it immediately in **Settings**.

### Tailscale (optional)

Serve HAAI over your tailnet with HTTPS:

```bash
COMPOSE_PROFILES=tailscale TS_AUTHKEY=tskey-auth-... docker compose up -d
```

HAAI is then reachable at `https://<TS_HOSTNAME>.<tailnet>.ts.net`. See [Tailscale](./tailscale.md) for the full guide.

## Node.js

For full control over the runtime and development:

```bash
git clone https://github.com/j-norwood-young/haai.git
cd haai
pnpm install
pnpm build
pnpm start
```

This starts the proxy on **http://localhost:4000** with:

- OpenAI-compatible API at `/v1/*`
- Management API at `/api/v1/*`
- Admin UI at `/` (login, dashboards, backends, keys, etc.)

Data is stored in `~/.haai/`. On first run an admin user is created with password `admin` — **change it immediately** in **Settings** after logging in.

### Configuration

Environment variables:

```bash
HAAI_PORT=8080 HAAI_LOG_LEVEL=info pnpm start
```

Or `~/.haai/config.yaml`:

```yaml
server:
  port: 4000
log:
  level: info
  format: pretty
```

See [Configuration](./configuration.md) for all options.

## Add a backend

```bash
pnpm haai backend add \
  --name lmstudio-bob \
  --base-url http://192.168.1.100:1234 \
  --provider lmstudio \
  --hostname bob
```

Providers: `lmstudio`, `ollama`, `vllm`, `openai`, `generic`.

Use `--mode abstraction --api-key sk-...` when the backend needs its own key. Omit `--mode` to pass through the caller's key (default).

## Verify

```bash
pnpm haai backend test lmstudio-bob
curl http://localhost:4000/v1/models
```

Models appear as `model:hostname:provider`, e.g. `qwen3.5-35b:bob:lmstudio`.

## Create an API key

```bash
pnpm haai key create --name "my-app"
```

Save the key when shown — it is only displayed once.

```bash
pnpm haai key create --name "limited-app" --rpm 60 --day-budget 100000 --expires-in 90
```

## Chat completion

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer haai-sk-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5-35b:bob:lmstudio",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Virtual model (optional)

```bash
pnpm haai vmodel create --model-id smart-chat --display-name "Smart Chat"
pnpm haai vmodel add-backend smart-chat \
  --backend-id <backend-id> \
  --backend-model qwen3.5-35b
```

Clients can then use `smart-chat` instead of the full backend model ID.

## CLI reference

```bash
pnpm haai status
pnpm haai backend list
pnpm haai vmodel list
pnpm haai key list
pnpm haai key suspend <prefix> --reason "Over quota"
pnpm haai key logs <prefix>
```

## Next steps

- [Web UI](./web-ui.md) — Admin dashboard walkthrough
- [Virtual models](./vmodels.md) — Deep dive into v-models
- [High availability](./ha.md) — Load balancing, failover, circuit breakers
- [Configuration](./configuration.md) — All config options
- [CLI reference](./cli.md) — Full CLI command list
