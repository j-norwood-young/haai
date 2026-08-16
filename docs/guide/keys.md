# API Key Management

HAAI uses its own API keys for authenticating users/applications. These are separate from backend API keys.

## Key format

Keys have the format: `haai-sk-<random>` (e.g. `haai-sk-Xn7kP2mQ9vZw4aB`).

Only a SHA-256 hash is stored. The key is shown only once at creation.

## Creating a key

### Via CLI

```bash
haai key create --name "my-app" \
  --day-budget 100000 \
  --rpm 60 \
  --expires-in 90
```

### Via API

```bash
curl -X POST http://localhost:4000/api/v1/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "name": "my-app",
    "tokenBudgetDay": 100000,
    "rateLimitRpm": 60,
    "expiresAt": 1735689600000
  }'
```

## Key options

| Option | Default | Description |
|---|---|---|
| `name` | required | Key display name |
| `enabled` | `true` | Enable/disable the key |
| `expiresAt` | `null` | Unix ms expiry timestamp |
| `allowedModels` | `null` (all) | List of allowed model IDs |
| `allowToolCalling` | `true` | Allow tool use |
| `allowVision` | `false` | Allow vision/image inputs |
| `allowEmbeddings` | `false` | Allow embedding requests |
| `rateLimitRpm` | `null` (unlimited) | Max requests per minute |
| `tokenBudgetHour` | `null` | Max tokens per hour |
| `tokenBudgetDay` | `null` | Max tokens per day |
| `tokenBudgetWeek` | `null` | Max tokens per week |
| `tokenBudgetMonth` | `null` | Max tokens per month |
| `logRequests` | `true` | Log per-key request details |

## Token budgets

Budgets use rolling periods. At the start of each period (hour/day/week/month), the counter resets. Multiple periods can be active simultaneously — the key is rejected if any budget is exceeded.

## Suspending and resuming

```bash
haai key suspend haai-sk-xxxx --reason "Over usage"
haai key resume haai-sk-xxxx
```

## Per-key logs

```bash
haai key logs haai-sk-xxxx --limit 50
```

Or via API:
```bash
curl http://localhost:4000/api/v1/keys/<id>/logs?limit=100
```

## Budget status

```bash
curl http://localhost:4000/api/v1/keys/<id>/budget
```

Returns current usage vs. limits for each period.
