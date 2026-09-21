# HAAI Codebase Overview

## Project Summary
**HAAI** (High Availability AI) is a modern streaming reverse proxy for OpenAI-compatible LLMs, designed for homelab users and sysadmins managing multiple LLM backends across different machines. It functions like HAProxy/Nginx but purpose-built for LLMs with virtual models, key management, load balancing, hooks, plugins, and a full admin UI.

---

## Architecture Overview

### Monorepo Structure (pnpm + Turbo)
```
haai/
├── apps/web/           # Admin UI (SvelteKit)
├── packages/
│   ├── cli/           # haai CLI tool
│   ├── core/          # Shared config, DB, types
│   ├── hooks-sdk/     # Hook authoring SDK
│   ├── mcp/           # MCP server support
│   ├── plugin-sdk/    # Plugin authoring SDK
│   ├── proxy/         # Reverse proxy server
│   └── tui/           # Terminal UI
├── docs/              # VitePress documentation
├── examples/plugins/  # Example sandboxed plugins
└── tests/e2e/         # End-to-end tests
```

---

## Core Packages Explained

### 1. **packages/core/** - Shared Foundation
- **Database**: SQLite with Drizzle ORM for type-safe queries
- **Schema** (`db/schema.ts`): Complete schema with 15+ tables:
  - `backends` - LLM upstream connections (LM Studio, Ollama, vLLM, OpenAI)
  - `vmodels` - Virtual model aliases with balancing config
  - `api_keys` - Scoped API keys with rate limits and budgets
  - `hooks` - Pre-request/post-completion callbacks
  - `plugins` - Sandboxed request transformers
  - `usage_events`, `usage_rollups` - Metrics aggregation
  - `users`, `sessions`, `webauthn_credentials` - Auth system
  - `audit_log`, `request_logs` - Observability

- **Types** (`types/`): TypeScript interfaces for all entities (Backend, VModel, ApiKey, Hook, Plugin, etc.)

- **Config**: YAML/env-based configuration with schema validation
  - Server settings (port, CORS)
  - Logging (level, format, file output)
  - Health checks (interval, timeout)
  - Security (session secrets, rate limits)

---

### 2. **packages/proxy/** - Reverse Proxy Server
**Entry Point** (`index.ts`):
- Loads config and ensures data directory exists
- Initializes SQLite with WAL mode for concurrency
- Runs Drizzle migrations automatically
- Creates master encryption key for sensitive data
- Ensures admin user exists on first run
- Starts health monitor, plugin runtime
- Builds Fastify app with all route handlers

**Key Components**:

| Component | Purpose |
|-----------|---------|
| `balancer.ts` | Selects backends using strategies: session-pin, round-robin, weighted, least-connections, least-latency |
| `streaming-proxy.ts` | SSE pass-through with token counting, TTFT tracking, TPS metrics |
| `circuit-breaker.ts` | Automatic failover with configurable failure thresholds |
| `key-auth.ts` | API key validation with scope checking and rate limiting |
| `plugins/runtime.ts` | Sandboxed execution via isolated-vm V8 isolates (64MB limit) |
| `health.ts` | Periodic backend health checks with status updates |
| `web-ui.ts` / `docs-site.ts` | Serves admin UI and documentation from same port |

**Load Balancing Strategies**:
- **session-pin**: Hash-based consistent routing per session
- **round-robin**: Even distribution across backends
- **weighted**: Proportional to backend weight config
- **least-connections**: Route to least busy backend
- **least-latency**: Route to fastest responding backend

**Circuit Breaker Pattern**:
- Opens after 5 failures, requires 2 successes to close
- 60-second timeout before retry attempt
- Prevents cascading failures when backends are unhealthy

---

### 3. **packages/cli/** - Command Line Interface
Built with Commander.js, provides full management via terminal:
```bash
haai backend add --name my-backend --base-url http://... --provider ollama
haai key create --name "my-app"
haai vmodel list
haai plugin install npm:@haai/pirate-speak
haai status
```

Features:
- Tab completion for commands and values
- Environment variable configuration (`HAAI_URL`, `HAAI_ADMIN_TOKEN`)
- Secure token handling (displayed once at creation)

---

### 4. **Plugin System** - Sandboxed Extensions
**SDK** (`plugin-sdk/`):
```typescript
import { definePlugin, t } from "@haai/plugin-sdk";

export default definePlugin({
  name: "pirate-speak",
  version: "1.0.0",
  hooks: {
    onRequest: (request) => ({
      ...request,
      messages: prependSystemPrompt(request.messages, "Speak like a pirate!")
    })
  }
});
```

**Runtime**:
- Each plugin runs in isolated V8 isolate via `isolated-vm`
- 64MB memory limit per plugin
- Host-mediated capabilities (`ctx.log`, `ctx.ai.complete`, `ctx.fetch`)
- No filesystem or network access inside the isolate
- Compiled once, cached, fresh context per request

**Plugin Scopes**:
- **global**: Applies to all requests
- **vmodel**: Bound to specific virtual models
- **backend**: Applied only when routing through specific backends
- **key**: Scoped to API keys

---

### 5. **apps/web/** - Admin UI (SvelteKit)
Pages organized by resource:
- `/backends` - Add, edit, monitor LLM upstreams with health status
- `/vmodels` - Create virtual model aliases with balancing config
- `/keys` - Issue API keys with rate limits and budgets
- `/plugins` - Install/manage sandboxed plugins
- `/hooks` - Configure pre/post request callbacks
- `/logs` - Real-time SSE stream of all requests
- `/metrics` - Charts for requests, tokens, TTFT, TPS, error rates
- `/settings` - System configuration

Security:
- TOTP 2FA support
- WebAuthn passkey authentication
- Admin API tokens for automation
- Session management with expiration

---

## Data Flow

### Request Processing Pipeline:
```
Client Request → Key Auth → Plugin (onRequest) → Balancer → 
Health Check → Circuit Breaker → Streaming Proxy → 
Plugin (onResponse) → Client Response
```

### Metrics Collection:
- Token counts extracted from SSE stream in real-time
- TTFT (Time To First Token) tracked per request
- TPS (Tokens Per Second) calculated and gauged
- Usage rollups aggregated hourly/daily/weekly/monthly
- Prometheus metrics + OpenTelemetry OTLP export available

---

## Security Features

1. **Master Encryption Key**: AES-256-GCM encryption for stored API keys
2. **Key Hashing**: SHA-256 hashing for API key verification (show-once mode)
3. **Rate Limiting**: Per-key RPM limits and token budgets
4. **Scope Enforcement**: Keys can be restricted to specific v-models/backends
5. **Audit Logging**: All admin actions logged with IP addresses
6. **CORS Configuration**: Configurable allowed origins

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Package Manager | pnpm 9+ |
| Monorepo Tool | Turbo |
| API Framework | Fastify |
| Database | SQLite + Drizzle ORM |
| UI Framework | SvelteKit |
| Sandboxing | isolated-vm (V8 isolates) |
| Auth | WebAuthn, TOTP, sessions |
| Metrics | Prometheus client |

---

## Quick Start Commands

```bash
# Development
pnpm install
pnpm dev              # proxy + web UI together
pnpm dev:proxy        # proxy only
pnpm dev:web          # web UI only

# Production
pnpm build
pnpm start            # runs on port 4000

# Docker
docker compose up

# Documentation
pnpm dev:docs         # VitePress docs at localhost:5174
```

---

## Key Design Decisions

1. **SQLite for simplicity**: Single file database, no external dependencies
2. **WAL mode enabled**: Concurrent reads without locking issues
3. **Sandboxed plugins**: isolated-vm provides strong isolation guarantees
4. **Streaming-first**: SSE pass-through preserves real-time UX
5. **Unified port**: API and admin UI served from same endpoint
6. **Configurable balancing**: Multiple strategies for different use cases
7. **Extensible hooks**: Pre-request mutation, post-completion callbacks

This is a well-architected homelab-focused LLM proxy with strong security, observability, and extensibility features.