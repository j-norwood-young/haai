# Web UI

The admin UI manages backends, v-models, keys, hooks, plugins, and metrics.

## Access

| Mode | URL |
|------|-----|
| Production (`pnpm start`) | http://localhost:4000 |
| Development (`pnpm dev`) | http://localhost:5173 (API proxied to :4001) |

## Default login

- Username: `admin`
- Password: `admin` (or `HAAI_ADMIN_PASSWORD` on first database creation)

You may be prompted to change the password on first login.

## Navigation

| Page | Path | Purpose |
|------|------|---------|
| Dashboard | `/` | Overview, health, recent activity |
| Backends | `/backends` | Add, test, enable/disable upstreams |
| Virtual Models | `/vmodels` | Aliases and load balancing |
| API Keys | `/keys` | Create, suspend, view logs |
| Hooks | `/hooks` | Register internal and webhook hooks |
| Plugins | `/plugins` | Install and bind request plugins |
| Live Logs | `/logs` | Real-time log stream |
| Metrics | `/analytics` | Usage charts |
| Settings | `/settings` | Account, 2FA, passkeys, server links |

## Documentation links

From Settings or the sidebar:

- **Documentation** → `/docs/` (VitePress guide)
- **API Reference** → `/api/docs/` (Swagger UI)

## Authentication options

Settings supports:

- Password change
- TOTP two-factor authentication
- WebAuthn passkeys
- Admin API tokens (Bearer) for CLI/automation

## Roles

| Role | Access |
|------|--------|
| `admin` | Full management |
| `viewer` | Read-only (where enforced) |

See [Security Overview](./security).
