# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-21

### Added

- `haai stop` stops the background server started by `haai serve`. It won't signal a PID it can't confirm is answering as HAAI unless you pass `--force` (which sends SIGKILL).

### Changed

- ⚠️ `haai serve` now runs HAAI **in the background** by default: it starts the server detached, waits for it to become healthy, opens the admin UI and returns your shell. Output goes to `<data dir>/logs/haai.log` and the PID is kept in `<data dir>/haai.pid`. Pass `--no-daemon` for the previous foreground behaviour (needed under systemd, launchd or other process managers that expect the process to stay attached).

### Fixed

- `haai serve --no-open` now actually skips opening the browser (the flag was being read under the wrong name and had no effect).

## [0.3.0] - 2026-09-21

### Added

- V-models and backend models now carry a **kind** (`chat` vs. `embedding`), fixing a security gap where an embedding model mapped into a v-model could be routed through `/v1/chat/completions`. Backend model kinds are classified from a provider-native probe where available (LM Studio's `GET /api/v0/models`, Ollama's `POST /api/show`) and fall back to a name heuristic (`bge-`, `gte-`, `e5-`, `*embed*`, etc.) for vLLM/OpenAI/generic backends; `GET /v1/models` now reports an LM Studio-style `type` (`llm`/`vlm`/`embeddings`) per model. Adding a backend model to a v-model of the wrong kind is rejected (`400`) at the admin API, and mismatched requests are rejected at request time on both `/v1/chat/completions` and `/v1/embeddings` (`400 model_not_supported`), so a pre-existing bad mapping can't route either.
- `POST /v1/embeddings` now resolves `embedding`-kind v-model aliases (previously only pass-through `model:host:provider` IDs worked) with full parity to chat: load balancing, failover across members, availability filtering, token-budget enforcement, and usage recording (`usage_events`/rollups/request logs) at `endpoint: "/v1/embeddings"`.
- Reasoning/thinking-budget requests are now capability-aware: v-models that fan out across backends with different reasoning support (e.g. a budget-enforcing vLLM backend mixed with an [oMLX](docs/guide/providers/omlx.md) backend that accepts but silently ignores `thinking_token_budget`) automatically steer budgeted requests to a backend that can honour them, falling back gracefully — with an `X-HAAI-Warning` header and `haai.warnings[]` in the response — when none is available. Toggling reasoning on/off never affects routing. See [Thinking budgets across mixed backends](docs/guide/debugging-thinking.md).
- Haai now additively normalises reasoning field names across backends (vLLM's `reasoning` and oMLX's `reasoning_content`), so clients can read either name regardless of which backend served the request, in both streaming and non-streaming responses.
- New `omlx` backend provider, for [oMLX](https://github.com/jundot/omlx) (an OpenAI/Anthropic-compatible inference server for Apple Silicon).
- `GET /v1/models` now advertises reasoning capability per model and v-model (`supported_parameters`, `capabilities`, and a precise `haai.reasoning` block distinguishing "enforces a budget" from "accepts but ignores one").
- Backends gained an optional `reasoningCaps` override (`PATCH /api/v1/backends/:id`) for correcting a backend's reasoning capabilities without touching `provider`, which is part of the published model-id and can't be changed after creation.
- The admin UI now shows a “Server disconnected” warning in the top-right corner when the live event stream drops, and clears it automatically once the server is reachable again
- The admin UI now manages plugin bindings on **backends and API keys** as well as v-models, from each edit page (with a plugin count and hover list on the v-model, backend and key lists). Plugins run in scope order; a plugin can only be bound to a given scope once.
- Plugin names are now unique (case-insensitive). Installing a name that already exists is refused unless it is a newer version, in which case you're asked to confirm the upgrade (a dialog in the web UI; `--upgrade` on the CLI) and the plugin is replaced in place, keeping its bindings. `haai plugin install` also gained `--name` to install a second copy under a different name. See [Plugin authoring](docs/guide/plugin-authoring.md#names-and-upgrades).
- `haai models` prints the model IDs an API key can use (one per line, same list as `GET /v1/models`).

### Changed

- The admin UI's **Create** and **Edit** virtual model pages now share one form (the Edit layout): backend mappings are added with the same backend/model/weight row, can be re-weighted or removed, and `enabled` can be set at creation. The form requires at least one backend mapping before it can be submitted (the API and CLI still allow an empty v-model), and `POST /api/v1/vmodels` now accepts several models from the same backend (only an identical backend + model pair is rejected as a duplicate), matching `POST /api/v1/vmodels/:id/backends`.
- `haai serve` is now a first-class CLI subcommand (visible in `haai --help`) instead of a hidden entry point in the `haai` bin shim; the shim now only gates the Node version and delegates to the CLI
- Saving a backend in the admin UI now only runs the connection test when the backend is enabled.
- The API key **Connect** dialog was reworked: it now lists the models the key can actually use and generates connection snippets for them.
- `/v1/models` and the admin available-models endpoint now read from cached model catalogs instead of querying every backend on each request.

### Fixed

- Editing an API key in the admin UI no longer resets **Pass-through backends** (or **Virtual models**) from "None" back to "All": an empty allow-list was being read as "unrestricted" when the form loaded, so saving the form silently widened the key's access. The Edit form also can no longer clear a previously-set RPM limit, daily budget or expiry (blank fields are now sent as `null`), and no longer shifts the expiry by your UTC offset each time it's saved.
- `PATCH /api/v1/keys/:id` (and `POST`) ignored an explicit `"allowedModels": null` / `"allowedBackends": null` (camelCase), so a key restricted to specific or no backends/v-models could never be switched back to "All" from the admin UI; the snake_case aliases already worked.
- Creating a backend with a `hostName` already used by another backend is now rejected (`409 Conflict`) instead of silently succeeding, even under a different `provider` — `hostName` is the sole differentiator in every pass-through model ID (`<model>:<hostName>:<provider>`), so a duplicate would produce model IDs indistinguishable to an end user picking a model, and only one of the two backends would ever be reachable by its direct ID. A missing `hostName` is now also rejected with a clear `400` instead of a raw database error. ⚠️ **If you already have two backends sharing a `hostName`, the migration that enforces this will fail to apply (logged as a warning, not fatal) until you resolve the duplicate** — `hostName` can't be changed after creation, so delete and re-create one of the conflicting backends under a different host label.
- The admin UI's "Add Backend" / "Edit Backend" provider dropdown listed the wrong options (`OpenAI`/`Anthropic`/`Ollama`/`Other` — `Anthropic` and `Other` aren't valid providers, and `LM Studio`/`vLLM`/`Generic` were missing entirely) and didn't include the new `omlx` provider; it now lists the real provider set. The "Edit Backend" page also explains why Provider and Host can't be changed after creation.
- Response-buffering plugins (`needsResponseBuffer: true`) no longer silently drop `reasoning`/`reasoning_content`, `tool_calls`, `refusal`, and `usage.completion_tokens_details` when reconstructing a streamed upstream response.
- `haai serve` (and SIGTERM shutdowns) no longer hang when a client holds a long-lived connection open — the SSE event stream (`/api/v1/events`) kept `app.close()` waiting forever, so the process printed “Shutting down gracefully…” but never exited; open connections are now force-closed after the server stops accepting new ones, and a second signal forces an immediate exit
- Deleting a v-model, backend or key now also deletes the plugin bindings scoped to it (they previously outlived it). ⚠️ **Migrations `0013`/`0014` clean up existing data:** orphaned plugin bindings are removed, and duplicate plugin bindings (same plugin + scope) and duplicate v-model backend mappings (same v-model + backend + model) are collapsed to the oldest row before unique indexes are added, so a duplicate can no longer make a plugin run twice per request.

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
[0.4.0]: https://github.com/j-norwood-young/haai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/j-norwood-young/haai/compare/v0.2.3...v0.3.0
[unreleased]: https://github.com/j-norwood-young/haai/compare/v0.4.0...HEAD
[0.2.2]: https://github.com/j-norwood-young/haai/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/j-norwood-young/haai/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/j-norwood-young/haai/releases/tag/v0.1.0
