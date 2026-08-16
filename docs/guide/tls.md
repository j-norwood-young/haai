# TLS Setup

HAAI listens on **plain HTTP** by default. TLS is typically handled by a reverse proxy in front of the proxy process.

## Why reverse proxy TLS?

- Automatic certificate renewal (Let's Encrypt via Caddy or Traefik)
- Standard pattern for container and Kubernetes deployments
- Session cookies already set `secure: true` when `X-Forwarded-Proto: https` is present (`trustProxy: true`)

## Caddy example

```
admin.example.com {
  reverse_proxy localhost:4000
}
```

## nginx example

See [Reverse Proxy (nginx)](./reverse-proxy) for a complete nginx config with TLS, streaming (`proxy_buffering off`), and WebSocket/SSE headers. Minimal TLS block:

```nginx
server {
  listen 443 ssl;
  server_name admin.example.com;

  ssl_certificate     /etc/ssl/certs/admin.pem;
  ssl_certificate_key /etc/ssl/private/admin.key;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Update `HAAI_CORS_ORIGINS` to include your HTTPS admin URL.

## Config file TLS fields

`config.yaml` accepts `server.tlsCert` and `server.tlsKey` (env: `HAAI_TLS_CERT`, `HAAI_TLS_KEY`).

::: info
Native HTTPS termination in the Fastify server is **not implemented yet**. These settings are reserved for a future release. Use a reverse proxy today.
:::

## WebAuthn

When using passkeys, set:

```yaml
security:
  webauthnRpId: admin.example.com
  webauthnOrigins:
    - https://admin.example.com
```

See [Security Overview](./security).
