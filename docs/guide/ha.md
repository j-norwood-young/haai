# High Availability

ai-v-models keeps traffic flowing when backends fail through health checks, model inventory, circuit breakers, and balancer failover.

## Health checks

Every `health.checkIntervalSecs` seconds (default 30), the proxy calls `GET {baseUrl}/v1/models` on each enabled backend.

| Status | Condition |
|--------|-----------|
| `healthy` | Response OK, latency under ~2s |
| `degraded` | Response OK but slow |
| `unhealthy` | Error or timeout |

Successful checks also **parse and store the model list** (`available_models` on the backend). Unhealthy checks clear that inventory so routing never uses a stale list.

Unhealthy backends are excluded from routing. Degraded backends stay eligible when their configured model is still listed.

## V-model model availability

Each v-model mapping is **available** when:

1. The backend is enabled
2. The backend is not `unhealthy`
3. The mapped `backendModelId` appears in that backend’s last model inventory

Derived v-model health (persisted like backend health):

| Status | Meaning |
|--------|---------|
| `healthy` | All enabled mappings available |
| `degraded` | Some mappings available |
| `unhealthy` | No mappings available |
| `unknown` | V-model disabled or not yet evaluated |

When a model disappears from a host’s `/v1/models` response, that mapping is skipped. When it returns on a later poll, the mapping is eligible again automatically.

## Circuit breakers

Per-backend circuit breakers trip after **5 consecutive request failures**:

1. **Closed** — normal traffic
2. **Open** — no traffic for 60 seconds
3. **Half-open** — trial request; 2 successes closes the breaker

State is exposed as the Prometheus metric `aivm_circuit_breaker_state`.

## Multi-backend v-models

Attach multiple backends to one v-model for redundancy:

```bash
aivm vmodel add-backend smart-chat --backend-id gpu1 --backend-model llama3.2 --weight 2
aivm vmodel add-backend smart-chat --backend-id gpu2 --backend-model llama3.2 --weight 1
```

Combine with a [balancing strategy](./balancing) (`session-pin`, `round-robin`, `weighted`, etc.).

At request time the balancer only considers **available** mappings. If the first upstream attempt fails before any client bytes are written (404 / model-not-found / 5xx), the proxy retries another remaining mapping.

## Session continuity

`session-pin` (default) hashes on the API key ID so the same client consistently hits the same backend while it stays healthy. If that backend fails, the client is re-pinned to a healthy one.

## When everything is down

If no healthy mapping is available, the proxy returns **503** with a clear error message.

## Monitoring

- Sidebar health indicator: backends **and** v-models (degraded/down with mapping reasons)
- Dashboard backend health badges on `/`
- SSE `backend-health` and `vmodel-health` events on `/api/v1/events`
- `aivm_backend_health{backend,provider}` Prometheus gauge

See [Monitoring](./monitoring) and [Prometheus & OTLP](./prometheus).
