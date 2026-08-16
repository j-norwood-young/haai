# API Reference

HAAI exposes two HTTP surfaces:

| Surface | Base path | Auth |
|---------|-----------|------|
| Management API | `/api/v1/` | Admin session cookie or Bearer token |
| Inference API | `/v1/` | Client API key (`Authorization: Bearer haai-sk-…`) |

## Guides

- [REST API Reference](./rest) — endpoint list with request/response examples

## Interactive explorer

Open the live OpenAPI spec in Swagger UI to browse and try endpoints:

**[Open Swagger UI →](../../api/docs/)**

The explorer is served from the same host as the admin UI (for example `http://localhost:4000/api/docs` in production or `http://localhost:5173/api/docs` during development).
