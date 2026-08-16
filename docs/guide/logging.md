# Logging

HAAI uses [Pino](https://getpino.io/) for structured logging.

## Configuration

```yaml
log:
  level: info      # trace | debug | info | warn | error | fatal
  format: json     # json | pretty
  file: ""         # optional file path
```

Environment overrides: `HAAI_LOG_LEVEL`, `HAAI_LOG_FORMAT`, `HAAI_LOG_FILE`

## Formats

| Format | Use case |
|--------|----------|
| `json` | Production — one JSON object per line |
| `pretty` | Development — colorized human-readable output |

## What gets logged

| Level | Examples |
|-------|----------|
| `info` | API requests/responses (`/api/*`), user login |
| `debug` | Non-API HTTP requests, internal routing |
| `warn` | Failed login attempts, hook timeouts |
| `error` | Unhandled server errors |

API log lines include method, URL, status, and elapsed time.

## Live tail

The admin UI **Live Logs** page streams log entries over SSE. Useful during development and incident response.

## Production tips

- Use `json` format and ship logs to your aggregator (Loki, Elasticsearch, etc.)
- Set `HAAI_LOG_LEVEL=info` in production; use `debug` only when troubleshooting
- Optional `log.file` writes to disk under `{HAAI_DATA_DIR}/logs/` when configured

## Base fields

Every log line includes `"service":"haai"` for easy filtering.
