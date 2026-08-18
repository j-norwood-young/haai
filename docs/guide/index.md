# Guide

Documentation for **HAAI** — a streaming reverse proxy for OpenAI-compatible LLMs.

## Getting started

- [Introduction](./introduction) — what HAAI does and how it fits together
- [Installation](./installation) — install and first run
- [Quick Start](./quickstart) — add a backend and send your first request
- [Development](./development) — contributing and local dev setup

## Core concepts

| Topic | Description |
|-------|-------------|
| [Backends](./backends) | Connect LM Studio, Ollama, vLLM, or OpenAI |
| [Virtual Models](./vmodels) | User-facing model aliases with load balancing |
| [API Keys](./keys) | Client authentication, budgets, and logging |
| [Load Balancing](./balancing) | Routing strategies across backends |
| [Hooks](./hooks) | Pre/post request extensions |

## Configuration

- [Overview & Precedence](./configuration)
- [Environment Variables](./env-vars)
- [config.yaml Reference](./config-yaml)

## Operations

- [Web UI](./web-ui) · [CLI](./cli) · [MCP Server](./mcp)
- [Monitoring](./monitoring) · [Prometheus](./prometheus) · [Logging](./logging)
- [REST API](../api/rest) · [Swagger UI](../../api/docs/)

## Deployment

- [Docker](./docker) · [Tailscale](./tailscale) · [Kubernetes](./kubernetes) · [Systemd](./systemd)
