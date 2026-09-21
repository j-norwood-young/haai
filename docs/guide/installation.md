# Installation

## npm / npx (recommended)

**Requirements:** Node.js 22 or newer. No Docker, no pnpm, no git clone required.

```bash
# Run without installing (quickest):
npx @haai/haai serve

# Or install globally for repeated use:
npm i -g @haai/haai
haai serve
```

On first start, HAAI creates a data directory at `~/.haai/` (`%USERPROFILE%\.haai` on Windows) and an admin user with password `admin` — **change it immediately** in Settings.

```bash
# Change the listen address:
haai serve --port 8080 --host 0.0.0.0

# Skip auto-opening the browser:
haai serve --no-open
```

### Using pnpm?

If you install HAAI via pnpm (`pnpm add -g @haai/haai`), pnpm blocks dependency install scripts by default. Approve the native module builds once:

```bash
pnpm approve-builds   # approve better-sqlite3, isolated-vm, esbuild
```

## Which install method?

| Method          | When to use                                       |
|-----------------|---------------------------------------------------|
| **npm / npx**   | Quickstart, home server, no Docker available      |
| **Docker**      | Containerized environments, production, compose   |
| **From source** | Development, plugin/hook authoring, custom builds |

## Docker

```bash
docker compose up
```

Pulls `harbor.10layer.com/haai/haai:latest`. Data persists in the `haai-data` volume. Configuration can be passed via environment variables — see [Configuration](./configuration.md).

## From source

For development, custom builds, and plugin/hook authoring:

```bash
git clone https://github.com/j-norwood-young/haai.git
cd haai
pnpm install
pnpm build
pnpm start
```

### Requirements (source)

- **Node.js** 22 or later
- **pnpm** 9 or later — must match the `packageManager` field in the root `package.json`
- **Build toolchain** for native modules (`better-sqlite3`): Python 3, g++, and node-gyp

### Verify source build

```bash
pnpm start
curl http://localhost:4000/health
```

You should see `{"status":"ok",...}`. Continue with [Quick Start](./quickstart.md).

## Data directory

On first start, HAAI creates the data directory (overridable with `HAAI_DATA_DIR`):

```
.haai/
  config.yaml      # Optional declarative config
  data.db          # SQLite database
  master.key       # Encryption key for backend secrets (mode 0600)
  logs/            # Rotating log files
```

## Upgrading

- **npm install:** `npm i -g @haai/haai@latest` (or `pnpm add -g @haai/haai@latest`)
- **Docker:** `docker compose pull && docker compose up -d`
- **Source:** `git pull && pnpm install && pnpm build && pnpm start`

Database migrations run automatically on startup.