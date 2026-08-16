# config.yaml Reference

The main configuration file lives at `{HAAI_DATA_DIR}/config.yaml` (default `~/.haai/config.yaml`).

See [Configuration](./configuration) for precedence: defaults → `config.yaml` → environment variables.

## Full example

```yaml
server:
  host: "0.0.0.0"
  port: 4000
  corsOrigins:
    - "http://localhost:5173"
    - "https://admin.example.com"
  # tlsCert: /etc/ssl/certs/haai.pem
  # tlsKey: /etc/ssl/private/haai.key

log:
  level: info          # trace | debug | info | warn | error | fatal
  format: json         # json | pretty
  # file: /var/log/haai/proxy.log

metrics:
  enabled: true
  # otelEndpoint: http://localhost:4318
  otelServiceName: haai

health:
  checkIntervalSecs: 30
  timeoutMs: 5000
  unhealthyThreshold: 3
  healthyThreshold: 2

security:
  sessionSecret: ""    # set in production
  sessionMaxAgeSecs: 604800
  loginRateLimitMaxAttempts: 10
  loginRateLimitWindowSecs: 300
  # webauthnRpId: admin.example.com
  # webauthnOrigins:
  #   - https://admin.example.com
```

## Section reference

### `server`

| Key | Default | Env override | Description |
|-----|---------|--------------|-------------|
| `host` | `0.0.0.0` | `HAAI_HOST` | Listen address |
| `port` | `4000` | `HAAI_PORT` | Listen port (`4001` when `HAAI_DEV=1`) |
| `tlsCert` | — | `HAAI_TLS_CERT` | TLS certificate path (see [TLS Setup](./tls)) |
| `tlsKey` | — | `HAAI_TLS_KEY` | TLS private key path |
| `corsOrigins` | localhost dev URLs | `HAAI_CORS_ORIGINS` | Comma-separated or YAML list |

### `log`

| Key | Default | Env override | Description |
|-----|---------|--------------|-------------|
| `level` | `info` | `HAAI_LOG_LEVEL` | Minimum log level |
| `format` | `json` | `HAAI_LOG_FORMAT` | `json` or `pretty` |
| `file` | — | `HAAI_LOG_FILE` | Optional log file path |
| `maxFileSize` | `10485760` | — | Max log file size (10 MB) |
| `maxFiles` | `5` | — | Rotated log files to keep |

### `metrics`

| Key | Default | Env override | Description |
|-----|---------|--------------|-------------|
| `enabled` | `true` | `HAAI_METRICS_ENABLED` | Expose `/metrics` |
| `otelEndpoint` | — | `HAAI_OTEL_ENDPOINT` | OTLP endpoint (config only today) |
| `otelServiceName` | `haai` | `HAAI_OTEL_SERVICE_NAME` | OTLP service name |

### `health`

| Key | Default | Env override | Description |
|-----|---------|--------------|-------------|
| `checkIntervalSecs` | `30` | `HAAI_HEALTH_CHECK_INTERVAL` | Backend poll interval |
| `timeoutMs` | `5000` | — | Health check timeout |
| `unhealthyThreshold` | `3` | — | Consecutive failures (schema default) |
| `healthyThreshold` | `2` | — | Consecutive successes (schema default) |

### `security`

| Key | Default | Env override | Description |
|-----|---------|--------------|-------------|
| `sessionSecret` | auto | `HAAI_SESSION_SECRET` | Session cookie signing secret |
| `sessionMaxAgeSecs` | `604800` | — | Session lifetime (7 days) |
| `loginRateLimitMaxAttempts` | `10` | — | Failed logins before rate limit |
| `loginRateLimitWindowSecs` | `300` | — | Login rate limit window |
| `webauthnRpId` | — | `HAAI_WEBAUTHN_RP_ID` | WebAuthn relying party ID |
| `webauthnOrigins` | — | `HAAI_WEBAUTHN_ORIGINS` | Allowed WebAuthn origins |

## Validation

Invalid values cause startup to fail with a Zod validation error listing each bad field. Fix the file or override with environment variables.

## Data directory

```
~/.haai/
  config.yaml
  data.db
  master.key       # chmod 600 — backs abstraction-mode backend keys
  logs/
  hooks/
  plugins/
```

See [Configuration](./configuration) for the `master.key` backup warning.
