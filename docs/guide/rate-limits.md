# Rate Limiting & Budgets

HAAI supports per-key **token budgets** and stores an **RPM** limit field. Admin login has a separate rate limit.

## Token budgets (enforced)

Rolling calendar buckets per key:

| Field | Period |
|-------|--------|
| `tokenBudgetHour` | Current hour |
| `tokenBudgetDay` | Current day |
| `tokenBudgetWeek` | Current week |
| `tokenBudgetMonth` | Current month |

All configured budgets are checked **before** each request. If any period is exceeded, the proxy returns **429** with `rate_limit_error`.

Usage is recorded after the response completes (including streamed tokens).

```bash
haai key create --name limited \
  --day-budget 100000 \
  --hour-budget 10000
```

### Check budget status

```bash
curl http://localhost:4000/api/v1/keys/<id>/budget \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Returns current usage vs limits for each active period.

## Requests per minute

The `rateLimitRpm` field is stored and configurable via CLI/API:

```bash
haai key create --name app --rpm 60
```

::: info
RPM limits are **stored but not yet enforced** on the inference path. Token budgets are enforced today.
:::

## Suspended keys

Admins can suspend keys regardless of budget:

```bash
haai key suspend <prefix-or-id> --reason "Policy violation"
haai key resume <prefix-or-id>
```

Suspended keys return 403.

## Admin login rate limit

Separate from client keys — configured in `config.yaml` / `security`:

- `loginRateLimitMaxAttempts`: 10 (default)
- `loginRateLimitWindowSecs`: 300 (default)

Applied to `/api/v1/auth/login` via Fastify rate limiting.

## Metrics

Prometheus counter `haai_rate_limit_hits_total{key_prefix, reason}` tracks budget and suspension hits.

See [Prometheus & OTLP](./prometheus).
