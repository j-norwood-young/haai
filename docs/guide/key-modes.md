# Key Modes

Each backend has a **key mode** that controls how API keys are sent to the upstream.

## passthrough (default)

The client's HAAI key (`haai-sk-…`) is forwarded as `Authorization: Bearer` to the backend.

Use when:

- Your backend accepts any key or no key (typical homelab LM Studio / Ollama)
- You want clients to use backend-specific keys directly

## abstraction

The proxy stores the backend's real API key encrypted on disk and injects it on each request. Clients never see the upstream key.

Use when:

- Connecting to OpenAI, Anthropic-compatible gateways, or paid APIs
- You want to hide provider keys from application developers

```bash
haai backend add \
  --name openai-main \
  --base-url https://api.openai.com/v1 \
  --provider openai \
  --hostname cloud \
  --mode abstraction \
  --api-key sk-...
```

## Encryption

Abstraction-mode keys are encrypted with AES-256-GCM using `{HAAI_DATA_DIR}/master.key`. **Back up `master.key` securely.** If it is lost, you must re-enter backend API keys.

## Comparison

| | passthrough | abstraction |
|---|-------------|-------------|
| Client sees backend key | Sometimes | Never |
| Upstream receives | Client key | Stored backend key |
| Requires `master.key` | No | Yes |
| Typical use | Homelab LLMs | Cloud APIs |
