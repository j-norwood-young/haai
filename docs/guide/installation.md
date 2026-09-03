# Installation

## From source

```bash
git clone https://github.com/j-norwood-young/haai.git
cd haai
pnpm install
pnpm build
```

### Requirements

- **Node.js** 22 or later
- **pnpm** 9 or later — must match the `packageManager` field in the root `package.json`
- **Build toolchain** for native modules (`better-sqlite3`): Python 3, g++, and node-gyp

### Verify

```bash
pnpm start
curl http://localhost:4000/health
```

You should see `{"status":"ok",...}`.

Continue with [Quick Start](./quickstart.md).

## Docker

```bash
docker compose up
```

Pulls `harbor.10layer.com/haai/haai:latest`. Data persists in the `haai-data` volume. Configuration can be passed via environment variables — see [Configuration](./configuration.md).

## Data directory

On first start, HAAI creates `~/.haai/`:

```
~/.haai/
  config.yaml      # Optional declarative config
  data.db          # SQLite database
  master.key       # Encryption key for backend secrets (mode 0600)
  logs/            # Rotating log files
```

Override the location with `HAAI_DATA_DIR`.

## Upgrading

```bash
git pull
pnpm install
pnpm build
pnpm start
```

Database migrations run automatically on startup.
