# Security Overview

## Authentication layers

| Layer | Mechanism |
|-------|-----------|
| Admin UI / management API | Session cookie (`haai_session`) or Bearer admin token (`haai-at-…`) |
| Inference API (`/v1/*`) | Client API key (`haai-sk-…`) |
| Backend upstream | Passthrough client key or encrypted abstraction key |

## Client API keys

- Format: `haai-sk-<random>`
- Only SHA-256 hash stored; full key shown once at creation
- Prefix (first 13 chars) used for lookup and logs — never log full keys

## Backend keys (abstraction mode)

Encrypted with AES-256-GCM using `{HAAI_DATA_DIR}/master.key`. Protect this file like a root credential.

## Admin accounts

- Roles: `admin`, `viewer`
- Optional TOTP and WebAuthn passkeys
- Login rate limiting (10 attempts / 5 minutes by default)
- `mustChangePassword` enforced on first login when using default password

## Admin API tokens

Long-lived Bearer tokens for CLI, MCP, and automation:

```bash
haai admin-token create --name ci --expires-in 90
```

Revoke compromised tokens immediately from Settings or CLI.

## Transport

- Session cookies set `secure` when the request protocol is HTTPS
- Recommended: terminate TLS at a reverse proxy — see [TLS Setup](./tls) — or use [Tailscale Serve](./tailscale) on a private tailnet
- Request body limit: 10 MB

## Webhook security

External hooks support HMAC-SHA256 signatures via `webhookSecret`. Verify `X-HAAI-Signature` in your handler — see [Authoring Hooks](./hooks-authoring).

## Hardening checklist

- [ ] Set `HAAI_SESSION_SECRET` in production
- [ ] Change default admin password
- [ ] Back up `master.key`
- [ ] Use abstraction mode for cloud API keys
- [ ] Set token budgets on client keys
- [ ] Enable TOTP or passkeys for admin accounts
- [ ] Restrict CORS origins (`HAAI_CORS_ORIGINS`)
- [ ] Run behind TLS-terminating reverse proxy, or [Tailscale Serve](./tailscale) for tailnet-only access

## Related

- [TLS Setup](./tls)
- [Tailscale](./tailscale)
- [Audit Log](./audit)
- [Key Modes](./key-modes)
