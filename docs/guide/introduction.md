# Introduction

**HAAI** is a modern, rock-solid streaming reverse proxy purpose-built for OpenAI-compatible LLMs. It's aimed at homelab users and systems administrators who want to manage access to multiple LLMs running on different machines.

## What it does

HAAI sits between your users (or applications) and your LLM backends (LM Studio, Ollama, vLLM, etc.), providing:

- **Streaming reverse proxy** — Full SSE pass-through with zero-buffering overhead
- **Virtual models (v-models)** — User-facing model aliases that map to one or more backends
- **Key management** — Create, scope, rate-limit, and audit API keys
- **Load balancing** — Multiple strategies including session pinning (default)
- **High availability** — Health checks, circuit breakers, automatic failover
- **Hooks** — Mutate requests before they're sent, or react to completions
- **Full observability** — Prometheus, OTLP, structured logs, real-time dashboard

## Philosophy

Like HAProxy or Nginx, but purpose-built for LLMs and much easier to configure, monitor, and extend. The goal is a system that "just works" reliably for homelab and small-to-medium production deployments.

## Model IDs

Backend models are namespaced:

```
<model>:<hostname>:<provider>
```

For example, a model `qwen3.5-35b` running on LM Studio on a machine called `bob`:
```
qwen3.5-35b:bob:lmstudio
```

Virtual models are admin-defined aliases:
```
smart-chat
fast-summarizer
```

Both appear in `/v1/models`.

## Architecture

```
User / SDK ──→ Proxy Core (Fastify) ──→ Auth + Key Authz
                     │                        │
                     ▼                        ▼
              v-model Router          Token Budget Check
                     │
                     ▼
              Balancer (session-pin/round-robin/...)
                     │
                     ▼
              Hook Runtime (pre-request mutate)
                     │
                     ▼
              Backend (LM Studio / Ollama / vLLM)
                     │
                     ▼
              SSE Stream → User
                     │
                     ▼
              Hook Runtime (post-completion)
                     │
                     ▼
              Usage Recording + Metrics
```
