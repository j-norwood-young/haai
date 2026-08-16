# Audit Log

Security-relevant actions are recorded in the `audit_log` SQLite table.

## Recorded today

| Action | When |
|--------|------|
| `login` | Successful admin session created |
| `reveal_api_key` | Admin reveals a client key secret (show-once flow) |

Each entry includes:

- `userId`, `username`
- `action`
- `resourceType`, `resourceId` (when applicable)
- `detail` (JSON, when applicable)
- `ipAddress`
- `timestamp`

## Querying

There is no management API for audit logs yet. Query directly:

```bash
sqlite3 ~/.haai/data.db \
  "SELECT datetime(timestamp/1000,'unixepoch'), username, action, ipAddress FROM audit_log ORDER BY timestamp DESC LIMIT 20;"
```

## Retention

Audit rows are stored indefinitely in SQLite. Plan backup and retention according to your compliance requirements.

## Future

Additional events (key creation, backend changes, config edits) may be added. Check release notes for updates.

## Related

- [Security Overview](./security)
- [API Keys](./keys)
