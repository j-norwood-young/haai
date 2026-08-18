# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-08-17

### Added

- Playwright browser tests for the admin UI (backends, v-models, keys, and metrics)
- E2E coverage for admin CRUD, the metrics API, and v-model health states
- Metrics summary endpoint honors a `since` query so Analytics can show 48-hour, 48-day, 48-week, and 48-month windows

### Changed

- Key allow-lists accept the public v-model alias (`smart-chat`) or the internal `vmodel-…` id, so existing production keys keep working
- Admin v-model picker and Connect snippet store and copy `model_id` instead of the internal row id

### Fixed

- Analytics cards no longer hardcode “24 hours” when a longer window is selected

## [0.2.1] - 2026-08-16

### Changed

- **Breaking:** Rebrand from AiVM / ai-v-models to HAAI. CLI `aivm` → `haai`, env prefix `AIVM_*` → `HAAI_*`, data directory `~/.aivm` → `~/.haai`, npm scope `@ai-v-models/*` → `@haai/*`, Prometheus metrics `aivm_*` → `haai_*`, plugin/hook manifests, webhook headers, and session cookie. See [Migrating from AiVM](docs/guide/migrating-from-aivm.md). Existing stored API keys still authenticate; only newly issued credentials use the `haai-` prefix.
- CLI, MCP, and TUI auto-detect the proxy on the production or dev listen port when `HAAI_URL` is unset

### Added

- Migration guide from AiVM to HAAI
- CLI screenshots in the README

### Fixed

- Metrics dashboard flash on load
- TypeScript, SvelteKit, and test failures after the rebrand
- Plugin SDK workspace dependency alignment

## [0.1.0] - 2026-08-16

Initial public release of haai (HAAI): a streaming reverse proxy for OpenAI-compatible LLMs with virtual models, key management, plugins, hooks, and a built-in admin UI.

### Added

- Streaming OpenAI-compatible reverse proxy with SSE pass-through, token counting, TTFT, and TPS metrics
- Virtual models (v-models) that alias one or more backends with load-balancing strategies, weights, and failover
- Backend management for LM Studio, Ollama, vLLM, OpenAI, and generic OpenAI-compatible upstreams, including connection testing and health checks
- API key management with scopes, rate limits, token budgets, expiry, and per-key usage logs
- Load balancing and HA: session pinning, round-robin, weighted routing, circuit breakers, and automatic failover
- Sandboxed plugins installable from npm or GitHub, with global or per-v-model bindings and a plugin SDK
- Hooks for pre-request mutation and post-completion callbacks (worker threads or external webhooks), plus a hooks SDK
- Web admin UI (SvelteKit) for backends, v-models, keys, plugins, live logs, metrics, and settings — served from the proxy port in production
- Admin security: password login, TOTP 2FA, WebAuthn passkeys, and admin API tokens
- `haai` CLI for scripting and automation (backends, keys, prompts, plugins, and more)
- Observability: Prometheus metrics, OpenTelemetry OTLP export, structured logging, and real-time SSE dashboards
- Docker Compose and Dockerfile support, with data stored under `~/.haai/` (or a Docker volume)
- VitePress documentation covering installation, configuration, CLI, v-models, plugins, hooks, Docker, and Kubernetes
- Example plugins (e.g. system-prompt injection, token compression, vLLM compatibility fixes)

[unreleased]: https://github.com/j-norwood-young/haai/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/j-norwood-young/haai/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/j-norwood-young/haai/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/j-norwood-young/haai/releases/tag/v0.1.0
