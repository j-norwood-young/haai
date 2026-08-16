# Development

This guide is for **contributors** working on the HAAI source tree. End users running the product should follow [Quick Start](./quickstart.md) instead.

## Prerequisites

- Node.js 22+
- pnpm 9+ (version must match `packageManager` in the root `package.json`)
- Build tools for `better-sqlite3` (`python3`, `g++`, `node-gyp`)

## First-time setup

```bash
pnpm install
pnpm build
```

`pnpm build` compiles all packages and builds the SvelteKit admin UI into `apps/web/build/`.

## Development mode

Development uses **different ports** from production so you can run `pnpm dev` alongside `pnpm start`:

```bash
pnpm dev
```

| Service | URL | Notes |
|---------|-----|-------|
| Proxy API | http://localhost:4001 | Restarts on `packages/proxy` source changes (`tsx watch`) |
| Admin UI | http://localhost:5173 | Vite dev server with hot reload |

The Vite dev server proxies `/api` to the dev proxy on port 4001, so login cookies work without CORS configuration.

Override the dev API port with `HAAI_PORT` (and set `HAAI_PROXY_URL` for the Vite proxy to match).

### Run services individually

```bash
pnpm dev:proxy   # proxy only (port 4001)
pnpm dev:web     # web UI only (port 5173)
```

Rebuild the proxy after TypeScript changes if you are not using `pnpm dev` (which uses `tsx watch` on source):

```bash
pnpm --filter @haai/proxy build
pnpm dev:proxy
```

## Default admin login

- Username: `admin`
- Password: `admin` (or `HAAI_ADMIN_PASSWORD` on first run)

Use **http://localhost:5173** for the admin UI in development. The dev API listens on **http://localhost:4001** (production uses 4000).

Do **not** set `PUBLIC_API_URL` in `apps/web/.env` during local development — the Vite proxy handles API routing.

## Tests

```bash
pnpm test          # all package tests + e2e
pnpm test:e2e      # e2e only
pnpm typecheck
pnpm lint
```

## Production vs development

| | Production | Development |
|---|------------|-------------|
| Start command | `pnpm start` | `pnpm dev` |
| Admin UI URL | http://localhost:4000 | http://localhost:5173 |
| API URL | http://localhost:4000 | http://localhost:4001 |
| UI delivery | Bundled into proxy (`apps/web/build`) | Vite dev server |
| Config hot-reload | `config.yaml` watcher | Same |

Production serves the built admin UI from the proxy process. Development intentionally keeps them separate for fast frontend iteration.

## Project layout

```
packages/core/     Shared types, config, SQLite schema, crypto
packages/proxy/    Fastify server, /v1 API, management API
packages/cli/      `haai` CLI
packages/hooks-sdk Hook authoring interface
packages/mcp/      MCP management server
packages/tui/      Ink terminal dashboard
apps/web/          SvelteKit admin UI
tools/mock-backend Test harness for e2e
tests/e2e/         Cross-process integration tests
docs/              VitePress documentation
```

## Mock backend (testing)

```bash
pnpm --filter @haai/mock-backend start
```

Configurable fault injection via environment variables — see `tools/mock-backend/src/config.ts`.
