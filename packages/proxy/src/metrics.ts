import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const registry = new Registry();
registry.setDefaultLabels({ service: "haai" });

export const httpRequestsTotal = new Counter({
  name: "haai_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "endpoint", "status", "vmodel", "backend"],
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: "haai_http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "endpoint", "vmodel", "backend"],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [registry],
});

export const tokensTotal = new Counter({
  name: "haai_tokens_total",
  help: "Total tokens processed",
  labelNames: ["type", "vmodel", "backend", "key_prefix"],
  registers: [registry],
});

export const ttftMs = new Histogram({
  name: "haai_ttft_ms",
  help: "Time to first token in milliseconds",
  labelNames: ["vmodel", "backend"],
  buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
  registers: [registry],
});

export const tpsGauge = new Gauge({
  name: "haai_tps",
  help: "Current tokens per second",
  labelNames: ["vmodel", "backend"],
  registers: [registry],
});

export const toolCallsTotal = new Counter({
  name: "haai_tool_calls_total",
  help: "Total tool calls made",
  labelNames: ["vmodel", "backend"],
  registers: [registry],
});

export const backendHealthGauge = new Gauge({
  name: "haai_backend_health",
  help: "Backend health status (1=healthy, 0.5=degraded, 0=unhealthy)",
  labelNames: ["backend", "provider"],
  registers: [registry],
});

export const backendConcurrencyGauge = new Gauge({
  name: "haai_backend_concurrency",
  help: "Current in-flight requests per backend",
  labelNames: ["backend"],
  registers: [registry],
});

export const rateLimitHitsTotal = new Counter({
  name: "haai_rate_limit_hits_total",
  help: "Rate limit rejections",
  labelNames: ["key_prefix", "reason"],
  registers: [registry],
});

export const circuitBreakerState = new Gauge({
  name: "haai_circuit_breaker_state",
  help: "Circuit breaker state (0=closed, 0.5=half-open, 1=open)",
  labelNames: ["backend"],
  registers: [registry],
});
