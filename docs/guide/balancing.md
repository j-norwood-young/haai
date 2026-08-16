# Load Balancing

HAAI supports multiple load balancing strategies per virtual model.

## Strategies

### session-pin (default)

Consistent hashing based on the API key ID. The same key always hits the same backend (as long as it's healthy), providing session continuity for multi-turn conversations.

```yaml
balancingStrategy: session-pin
```

### round-robin

Distributes requests evenly across all healthy backends.

```yaml
balancingStrategy: round-robin
```

### weighted

Uses the `weight` field on each v-model backend mapping. Backends with higher weights receive proportionally more traffic.

```yaml
balancingStrategy: weighted
```

Example: Backend A weight=3, Backend B weight=1 → 75% to A, 25% to B.

### least-connections

Routes to the backend with the fewest current in-flight requests.

```yaml
balancingStrategy: least-connections
```

Best for heterogeneous backends where some are faster than others.

### least-latency

Routes to the backend with the lowest measured latency from the last health check.

```yaml
balancingStrategy: least-latency
```

## Configuring via API

```bash
curl -X PATCH http://localhost:4000/api/v1/vmodels/<id> \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"balancingStrategy": "round-robin"}'
```

## Health checks and failover

Backends are health-checked every `health.checkIntervalSecs` seconds (default 30s). If a backend fails `health.unhealthyThreshold` consecutive checks, it's marked unhealthy and excluded from routing.

Circuit breakers also trip after 5 consecutive request failures, preventing further traffic for 60 seconds before trying again (half-open → closed if successful).

If **all** backends are unhealthy, the proxy returns a 503 error.

## Backend weights

Weights are per v-model backend mapping, not global:

```bash
# Add backend with weight 3
haai vmodel add-backend smart-chat \
  --backend-id backend-abc \
  --backend-model qwen3.5-35b \
  --weight 3
```
