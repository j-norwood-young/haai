# Tailscale

Join HAAI to your [Tailscale tailnet](https://tailscale.com/docs/concepts/tailnet) with the optional Docker Compose `tailscale` profile. Other devices on the tailnet can then reach the admin UI and API at `https://haai.<tailnet>.ts.net` — no port forwarding or public reverse proxy.

The sidecar is off by default. `docker compose up` without the profile is unchanged.

## What you get

| Piece | Role |
|-------|------|
| `tailscale` service | Official Tailscale container; joins the tailnet as `TS_HOSTNAME` (default `haai`) |
| `haai-tailscale` network | Compose bridge shared by `proxy`, `web`, and the sidecar |
| Tailscale Serve | HTTPS on port 443 with a Tailscale certificate, proxied to `http://proxy:4000` |
| SOCKS5 / HTTP proxy | Port **1055** on the compose network (not published to the host) for reaching other tailnet devices |

Node identity is stored in the `haai-tailscale-state` volume (`TS_AUTH_ONCE=true`), so the container keeps the same machine on the tailnet across restarts.

## Prerequisites

- A Tailscale account and tailnet
- Docker Compose
- Permission to create keys: **Owner**, **Admin**, **IT admin**, or **Network admin**

## Get a Tailscale auth key

An [auth key](https://tailscale.com/docs/features/access-control/auth-keys) lets the container join the tailnet without a browser login. You must be an Owner, Admin, IT admin, or Network admin.

1. Open the [Keys](https://login.tailscale.com/admin/settings/keys) page in the Tailscale admin console.
2. Select **Generate auth key**.
3. Use these settings for a long-running HAAI node:

| Field | Recommended | Why |
|-------|-------------|-----|
| Description | `haai` | Shown in the keys list |
| Reusable | On | You can recreate the container if state is lost |
| Expiration | 90 days (maximum) | Only needed to *register* the node; the node stays joined after the key expires if state is persisted |
| Ephemeral | Off | Stopping Compose must not delete the machine from the tailnet |
| Tags | `tag:container` | Server identity instead of your user; tagged nodes do not expire by default |
| Pre-approved | On if you use [device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval) | Skip a manual Machines-page approval |

4. Select **Generate key** and copy the value (it is shown once). It looks like `tskey-auth-…`.
5. Put it in `.env` as `TS_AUTHKEY`. Treat it like a password — do not commit it.

::: warning
Reusable keys can add any number of nodes until they expire or you revoke them. Store `TS_AUTHKEY` only in `.env` or a secret manager. Revoke a leaked key on the [Keys](https://login.tailscale.com/admin/settings/keys) page. Revoking the key does **not** remove machines that already joined; delete those on the [Machines](https://login.tailscale.com/admin/machines) page if needed.
:::

### Define the tag in your ACL

Tags must exist in the tailnet policy before you can select them on a key. In [Access controls](https://login.tailscale.com/admin/acls):

```json
{
  "tagOwners": {
    "tag:container": ["autogroup:admin"]
  }
}
```

### Auth key vs interactive login

If you skip `TS_AUTHKEY`, start the profile and log in once from the container:

```bash
docker compose --profile tailscale up -d
docker compose --profile tailscale exec tailscale tailscale login
```

Follow the URL printed in the logs to authenticate in a browser. After that, persisted state is enough — you do not need a key for later restarts.

## OAuth client (optional)

Auth keys expire after at most 90 days (they cannot register *new* nodes after that; existing nodes keep working). For automation that may recreate nodes indefinitely, use an [OAuth client](https://tailscale.com/docs/features/oauth-clients) instead:

1. Open [Trust credentials](https://login.tailscale.com/admin/settings/trust-credentials).
2. Select **Credential** → **OAuth**.
3. Grant **Auth Keys: Write** (and the matching Read scope).
4. Assign the same tag as above (`tag:container`).
5. Generate the credential and copy the **client secret** (`tskey-client-…`). It is shown once.

In `.env`:

```env
TS_AUTHKEY=tskey-client-...?ephemeral=false
TS_EXTRA_ARGS=--advertise-tags=tag:container
```

`?ephemeral=false` keeps the Compose node on the tailnet when the container stops. OAuth-registered nodes are tag-owned, not owned by your user.

## Enable MagicDNS and HTTPS

Serve needs certificates issued by Tailscale:

1. Open [DNS](https://login.tailscale.com/admin/dns) in the admin console.
2. Enable **MagicDNS**.
3. Enable **HTTPS Certificates**.

Your tailnet name (for example `wombat-pancake.ts.net`) is shown on that page. HAAI will be reachable at `https://<TS_HOSTNAME>.<tailnet>.ts.net`.

## Configure Compose

Copy `.env.example` to `.env` if you have not already, then set:

```env
COMPOSE_PROFILES=tailscale
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=haai
```

`COMPOSE_PROFILES=tailscale` makes `docker compose up` include the sidecar. You can omit it and pass `--profile tailscale` instead.

Replace `your-tailnet.ts.net` with the MagicDNS name from the DNS page, then add the Serve origin so cookies, CORS, and passkeys work:

```env
HAAI_CORS_ORIGINS=http://localhost:4000,http://localhost:5173,https://haai.your-tailnet.ts.net
HAAI_URL=https://haai.your-tailnet.ts.net
HAAI_WEBAUTHN_RP_ID=haai.your-tailnet.ts.net
HAAI_WEBAUTHN_ORIGINS=https://haai.your-tailnet.ts.net
```

See [TLS Setup](./tls) for WebAuthn fields.

## Start

```bash
docker compose up -d
```

Or without `COMPOSE_PROFILES`:

```bash
docker compose --profile tailscale up -d
```

Check that the node is logged in:

```bash
docker compose --profile tailscale exec tailscale tailscale status
```

Open `https://haai.<tailnet>.ts.net` from any device on the tailnet. Localhost ports (`4000`, `5173`) still work on the host.

Serve config lives in `docker/tailscale/serve.json` and proxies `/` to `http://proxy:4000`. The mount is a **directory** so Tailscale can reload changes.

## Reach backends on the tailnet

The sidecar listens on **1055** for SOCKS5 and HTTP proxy traffic (compose networks only). If a backend is another tailnet machine and the `proxy` container cannot route `100.x` / MagicDNS itself, point HAAI at that host and send egress through the sidecar. Example extra env on `proxy`:

```yaml
environment:
  HTTP_PROXY: http://tailscale:1055
  HTTPS_PROXY: http://tailscale:1055
  NO_PROXY: localhost,127.0.0.1,proxy,web,tailscale,haai-tailscale
```

Do not publish port 1055 to the host.

## Compose environment

These variables are read by Docker Compose / the Tailscale image, not by the HAAI process.

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_PROFILES` | — | Set to `tailscale` to start the sidecar with `docker compose up` |
| `TS_AUTHKEY` | — | Auth key (`tskey-auth-…`) or OAuth client secret (`tskey-client-…`) |
| `TS_HOSTNAME` | `haai` | MagicDNS hostname on the tailnet |
| `TS_EXTRA_ARGS` | — | Extra `tailscale up` flags, e.g. `--advertise-tags=tag:container` |
| `TS_USERSPACE` | `true` | Userspace networking (no `/dev/net/tun`) |
| `TS_ACCEPT_DNS` | `true` | Use MagicDNS inside the sidecar |
| `HAAI_TAILSCALE_NETWORK` | `haai-tailscale` | Name of the Compose bridge network |

## Advanced

### Kernel networking and subnet router

Userspace mode is enough for Serve. For subnet routes or higher throughput, set `TS_USERSPACE=false` and add TUN access to the `tailscale` service in `docker-compose.yml`:

```yaml
devices:
  - /dev/net/tun:/dev/net/tun
cap_add:
  - NET_ADMIN
  - SYS_MODULE
```

Advertise the Compose network with `TS_ROUTES` (for example the bridge subnet), then approve the subnet routes in the admin console. To accept routes advertised by other nodes, add `--accept-routes` to `TS_EXTRA_ARGS`.

### Existing Docker network

To attach to a network created by another stack, set `HAAI_TAILSCALE_NETWORK` to that name and change the Compose `tailscale` network to `external: true`.

### Funnel (public internet)

Serve is **tailnet-only**. [Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel) would expose HAAI on the public internet. It is not enabled in `serve.json`. Prefer a real reverse proxy if you need a public URL — see [TLS Setup](./tls).

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Sidecar not running | `COMPOSE_PROFILES=tailscale` or `--profile tailscale` |
| `Logged out` in `tailscale status` | `TS_AUTHKEY` missing/expired, or finish `tailscale login` |
| HTTPS certificate errors | MagicDNS and HTTPS Certificates enabled on the DNS page |
| Browser blocks the admin UI | `HAAI_CORS_ORIGINS` (and WebAuthn origins) include `https://haai.<tailnet>.ts.net` |
| New machine on every restart | `haai-tailscale-state` volume not persisted; `TS_AUTH_ONCE` must stay true |
| OAuth node disappears when stopped | Append `?ephemeral=false` to `TS_AUTHKEY` |
| OAuth fails to join | `TS_EXTRA_ARGS=--advertise-tags=tag:container` and the tag exists in the ACL |

## Related

- [Docker](./docker)
- [TLS Setup](./tls)
- [Reverse Proxy (nginx)](./reverse-proxy)
- [Environment Variables](./env-vars)
- [Security Overview](./security)
- [Tailscale auth keys](https://tailscale.com/docs/features/access-control/auth-keys)
- [Tailscale OAuth clients](https://tailscale.com/docs/features/oauth-clients)
- [Tailscale Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
