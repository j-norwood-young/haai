---
layout: home

hero:
  name: HAAI
  text: Modern LLM Reverse Proxy
  tagline: Fast, reliable, highly available streaming reverse proxy for OpenAI-compatible LLMs. Virtual models, key management, hooks, and beautiful monitoring.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Quick Start
      link: /guide/quickstart

features:
  - icon: 🚀
    title: Streaming Proxy
    details: Full SSE pass-through for streaming LLM responses with token counting, TTFT tracking, and TPS metrics.
  - icon: 🎭
    title: Virtual Models
    details: Create aliases that map to one or more backends. Abstract away model names, backends, and keys from your users.
  - icon: 🔑
    title: Key Management
    details: Full lifecycle key management with rate limits, token budgets (hour/day/week/month), model scopes, and per-key logging.
  - icon: ⚖️
    title: Load Balancing & HA
    details: Session pinning, round-robin, weighted, least-connections, and least-latency strategies with automatic failover.
  - icon: 🪝
    title: Hooks System
    details: Pre-request mutating hooks and post-completion hooks. Internal (worker_threads) or external (webhooks). Install from NPM or GitHub.
  - icon: 📊
    title: Full Observability
    details: Prometheus metrics, OpenTelemetry OTLP export, structured pino logs, real-time SSE dashboard, and beautiful charts.
---
