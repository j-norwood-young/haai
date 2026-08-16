# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-16

Initial public release of ai-v-models (AiVM): a streaming reverse proxy for OpenAI-compatible LLMs with virtual models, key management, plugins, hooks, and a built-in admin UI.

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
- `aivm` CLI for scripting and automation (backends, keys, prompts, plugins, and more)
- Observability: Prometheus metrics, OpenTelemetry OTLP export, structured logging, and real-time SSE dashboards
- Docker Compose and Dockerfile support, with data stored under `~/.aivm/` (or a Docker volume)
- VitePress documentation covering installation, configuration, CLI, v-models, plugins, hooks, Docker, and Kubernetes
- Example plugins (e.g. system-prompt injection, token compression, vLLM compatibility fixes)

[unreleased]: https://github.com/j-norwood-young/ai-v-models/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/j-norwood-young/ai-v-models/releases/tag/v0.1.0
