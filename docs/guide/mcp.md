# MCP Server

The **Model Context Protocol** server lets AI assistants (Cursor, Claude Desktop, etc.) manage HAAI through tools.

## Binary

```bash
node packages/mcp/dist/index.js
# package bin: haai-mcp
```

## Environment

| Variable | Description |
|----------|-------------|
| `HAAI_URL` | Proxy base URL (default `http://localhost:4000`) |
| `HAAI_ADMIN_TOKEN` | Admin Bearer token |

## Cursor configuration

Add to MCP settings (`.cursor/mcp.json` or Cursor settings):

```json
{
  "mcpServers": {
    "haai": {
      "command": "node",
      "args": ["/path/to/ai-reverse-proxy-cursor/packages/mcp/dist/index.js"],
      "env": {
        "HAAI_URL": "http://localhost:4000",
        "HAAI_ADMIN_TOKEN": "haai-at-..."
      }
    }
  }
}
```

Create an admin token in **Settings → Admin API Tokens** or via `haai admin-token create`.

## Available tools

| Tool | Description |
|------|-------------|
| `list_backends` | List configured backends |
| `add_backend` | Add a backend |
| `test_backend` | Test backend connectivity |
| `remove_backend` | Delete a backend |
| `list_vmodels` | List virtual models |
| `create_vmodel` | Create a v-model |
| `add_backend_to_vmodel` | Attach backend to v-model |
| `list_keys` | List API keys |
| `create_key` | Create a client key |
| `suspend_key` | Suspend a key |
| `get_metrics_summary` | 24h metrics summary |
| `get_key_logs` | Per-key request logs |

## Transport

Stdio only — the server communicates over stdin/stdout per the MCP specification.

## Related

- [CLI](./cli) — same operations from the terminal
- [REST API](../api/rest)
