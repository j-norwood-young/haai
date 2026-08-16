# Migrating from ai-v-models (AiVM) to HAAI

This guide is for existing **ai-v-models** / **AiVM** installs upgrading to **HAAI**. The rename is a hard cutover: old names are not accepted as aliases.

| Before | After |
|--------|--------|
| Product / repo | `ai-v-models`, AiVM | `haai`, HAAI |
| npm scope | `@ai-v-models/*` | `@haai/*` |
| CLI | `aivm` | `haai` |
| Env prefix | `AIVM_*` | `HAAI_*` |
| Data dir (local) | `~/.aivm` | `~/.haai` |
| Compose volume | `aivm-data` | `haai-data` |
| API keys / admin tokens | `aivm-sk-…` / `aivm-at-…` | `haai-sk-…` / `haai-at-…` (new issues only) |
| Session cookie | `aivm_session` | `haai_session` |
| Plugin / hook manifests | `aivm-plugin` / `aivm-hook` | `haai-plugin` / `haai-hook` |
| Webhook headers | `X-AIVM-*` | `X-HAAI-*` |
| Prometheus metrics | `aivm_*` | `haai_*` |

**Keys already stored in your database keep working** — clients must still send the same full secret string they were issued (including an `aivm-sk-` prefix). Only newly created credentials use `haai-` prefixes.

---

## Local / `pnpm` install

### 1. Update environment

Rename variables in `.env`, systemd units, shells, and MCP configs:

```bash
# examples
AIVM_PORT → HAAI_PORT
AIVM_DATA_DIR → HAAI_DATA_DIR
AIVM_ADMIN_TOKEN → HAAI_ADMIN_TOKEN
AIVM_API_KEY → HAAI_API_KEY
```

Use the new CLI: `haai` (or `pnpm haai …`).

### 2. Move the data directory

Stop the proxy first.

```bash
# Prefer this only when ~/.haai does not exist yet
mv ~/.aivm ~/.haai
```

**Pitfall:** if `~/.haai` already exists (for example after a first run of the renamed app), `mv ~/.aivm ~/.haai` nests the old tree as `~/.haai/.aivm/`. The app then reads an empty `~/.haai/data.db` and ignores your real database.

Fix a nested layout:

```bash
# Stop the app first
# Backup the accidental fresh install, then promote the nested data
mkdir -p ~/haai-fresh-backup
mv ~/.haai/data.db* ~/.haai/master.key ~/.haai/hooks ~/.haai/logs ~/.haai/plugins ~/haai-fresh-backup/ 2>/dev/null || true
mv ~/.haai/.aivm/* ~/.haai/
rmdir ~/.haai/.aivm

# You should see data.db, master.key, etc. directly under ~/.haai
ls -la ~/.haai
```

Alternatively, keep the old path without moving:

```bash
HAAI_DATA_DIR=~/.aivm pnpm start
```

### 3. Restart

```bash
pnpm install
pnpm build
pnpm start
# or: pnpm dev
```

You will need to sign in again (`haai_session` replaced `aivm_session`).

---

## Docker Compose

Compose now mounts **`haai-data` → `/data`** and sets **`HAAI_*`** inside the container. An old stack’s volume (often `…_aivm-data`) is **not** reused automatically — a new empty `…_haai-data` volume appears unless you copy data first.

### 1. Update host `.env`

Replace `AIVM_HOST_PROXY_PORT`, `AIVM_CORS_ORIGINS`, secrets, etc. with `HAAI_*` names (see [`.env.example`](../../.env.example)).

### 2. Stop the stack and identify volumes

```bash
docker compose down
docker volume ls | grep -E 'aivm|haai'
```

Typical names (project prefix = Compose project / directory name):

| Role | Example |
|------|---------|
| Old | `ai-v-models_aivm-data` |
| New | `ai-v-models_haai-data` or `haai_haai-data` |

Confirm the target name:

```bash
docker compose config --volumes
# → haai-data (logical); full Docker name is <project>_haai-data
```

Keep a stable project name if you rename the clone directory:

```bash
docker compose -p ai-v-models up -d
```

### 3. Copy the volume

```bash
OLD=ai-v-models_aivm-data          # adjust to your volume ls output
NEW=ai-v-models_haai-data          # adjust to <project>_haai-data

docker volume create "$NEW"

docker run --rm \
  -v "${OLD}:/from:ro" \
  -v "${NEW}:/to" \
  alpine sh -c 'cd /from && tar cf - . | tar xf - -C /to'

docker run --rm -v "${NEW}:/data" alpine ls -la /data
# Expect: data.db, master.key, hooks/, logs/, plugins/, …
```

### 4. Rebuild and start

```bash
docker compose up -d --build
```

When you are satisfied, remove the old volume:

```bash
docker volume rm ai-v-models_aivm-data
```

### Optional: mount the old volume without copying

```yaml
services:
  proxy:
    volumes:
      - old_data:/data

volumes:
  old_data:
    external: true
    name: ai-v-models_aivm-data
```

Prefer copying into `haai-data` for a permanent cutover.

---

## Plugins and hooks

Reinstall or republish packages so `package.json` uses `"haai-plugin"` / `"haai-hook"` instead of `"aivm-plugin"` / `"aivm-hook"`. Example plugins in this repo were updated accordingly.

External webhook receivers must verify **`X-HAAI-Signature`** and **`X-HAAI-Hook-Trigger`**.

---

## Observability

Update Grafana/Prometheus queries and recording rules from `aivm_*` to `haai_*`, and any job/service labels from `ai-v-models` to `haai`.

---

## Checklist

- [ ] Env vars renamed to `HAAI_*`
- [ ] Local data at `~/.haai` (not nested `~/.haai/.aivm`)
- [ ] Docker volume copied to `*_haai-data` (or external mount updated)
- [ ] `master.key` present next to `data.db`
- [ ] CLI / scripts use `haai`
- [ ] Plugin/hook manifests and webhook headers updated
- [ ] Metrics dashboards updated
- [ ] Git remote / clone URL: `https://github.com/j-norwood-young/haai`
