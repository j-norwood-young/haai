# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Reasoning/thinking-budget requests are now capability-aware: v-models that fan out across backends with different reasoning support (e.g. a budget-enforcing vLLM backend mixed with an [oMLX](docs/guide/providers/omlx.md) backend that accepts but silently ignores `thinking_token_budget`) automatically steer budgeted requests to a backend that can honour them, falling back gracefully — with an `X-HAAI-Warning` header and `haai.warnings[]` in the response — when none is available. Toggling reasoning on/off never affects routing. See [Thinking budgets across mixed backends](docs/guide/debugging-thinking.md).
- Haai now additively normalises reasoning field names across backends (vLLM's `reasoning` and oMLX's `reasoning_content`), so clients can read either name regardless of which backend served the request, in both streaming and non-streaming responses.
- New `omlx` backend provider, for [oMLX](https://github.com/jundot/omlx) (an OpenAI/Anthropic-compatible inference server for Apple Silicon).
- `GET /v1/models` now advertises reasoning capability per model and v-model (`supported_parameters`, `capabilities`, and a precise `haai.reasoning` block distinguishing "enforces a budget" from "accepts but ignores one").
- Backends gained an optional `reasoningCaps` override (`PATCH /api/v1/backends/:id`) for correcting a backend's reasoning capabilities without touching `provider`, which is part of the published model-id and can't be changed after creation.
- The admin UI now shows a “Server disconnected” warning in the top-right corner when the live event stream drops, and clears it automatically once the server is reachable again

### Changed

- `haai serve` is now a first-class CLI subcommand (visible in `haai --help`) instead of a hidden entry point in the `haai` bin shim; the shim now only gates the Node version and delegates to the CLI

### Fixed

- Creating a backend with a `hostName` already used by another backend is now rejected (`409 Conflict`) instead of silently succeeding, even under a different `provider` — `hostName` is the sole differentiator in every pass-through model ID (`<model>:<hostName>:<provider>`), so a duplicate would produce model IDs indistinguishable to an end user picking a model, and only one of the two backends would ever be reachable by its direct ID. A missing `hostName` is now also rejected with a clear `400` instead of a raw database error. ⚠️ **If you already have two backends sharing a `hostName`, the migration that enforces this will fail to apply (logged as a warning, not fatal) until you resolve the duplicate** — `hostName` can't be changed after creation, so delete and re-create one of the conflicting backends under a different host label.
- The admin UI's "Add Backend" / "Edit Backend" provider dropdown listed the wrong options (`OpenAI`/`Anthropic`/`Ollama`/`Other` — `Anthropic` and `Other` aren't valid providers, and `LM Studio`/`vLLM`/`Generic` were missing entirely) and didn't include the new `omlx` provider; it now lists the real provider set. The "Edit Backend" page also explains why Provider and Host can't be changed after creation.
- Response-buffering plugins (`needsResponseBuffer: true`) no longer silently drop `reasoning`/`reasoning_content`, `tool_calls`, `refusal`, and `usage.completion_tokens_details` when reconstructing a streamed upstream response.
- `haai serve` (and SIGTERM shutdowns) no longer hang when a client holds a long-lived connection open — the SSE event stream (`/api/v1/events`) kept `app.close()` waiting forever, so the process printed “Shutting down gracefully…” but never exited; open connections are now force-closed after the server stops accepting new ones, and a second signal forces an immediate exit

## [0.2.3] - 2026-09-03

### Added

- Optional Docker Compose `tailscale` profile that joins a Tailscale tailnet and serves the proxy over HTTPS on MagicDNS, with a [Tailscale](docs/guide/tailscale.md) guide covering auth keys and OAuth clients
- Drag-and-drop reordering for backends in the admin UI
- Improved model selection logic in the admin UI
- Live metrics dashboard with live-updating charts

### Changed

- Enhanced Tailscale integration in documentation and configuration

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

[0.2.3]: https://github.com/j-norwood-young/haai/compare/v0.2.2...v0.2.3
[unreleased]: https://github.com/j-norwood-young/haai/compare/v0.2.3...HEAD
[0.2.2]: https://github.com/j-norwood-young/haai/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/j-norwood-young/haai/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/j-norwood-young/haai/releases/tag/v0.1.0
