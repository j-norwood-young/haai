# oMLX

[oMLX](https://github.com/jundot/omlx) is an OpenAI/Anthropic-compatible LLM inference
server for Apple Silicon, commonly run on port **8000**. Use the `omlx` provider label
for it.

## Setup

```bash
haai backend add \
  --name mac-studio \
  --base-url http://mac-studio.local:8000 \
  --provider omlx \
  --hostname mac-studio \
  --mode abstraction \
  --api-key $OMLX_API_KEY
```

oMLX requires an API key for non-loopback access — see its docs for `--api-key` /
`OMLX_API_KEY`.

## Reasoning / thinking support

Measured against oMLX serving `Qwen3.6-35B-A3B-UD-MLX-4bit` — see
[Thinking budgets across mixed backends](../debugging-thinking.md) for the full matrix
and how Haai handles the gap automatically.

| | oMLX | vLLM, for comparison |
| --- | --- | --- |
| Toggle thinking (`chat_template_kwargs.enable_thinking`) | ✅ honoured | ✅ honoured |
| Separate reasoning field | ✅ `reasoning_content` / `delta.reasoning_content` | ✅ `reasoning` / `delta.reasoning` |
| `thinking_token_budget` **enforced** | ❌ accepted, silently ignored | ✅ exact |
| `usage.completion_tokens_details.reasoning_tokens` | ❌ absent | ✅ present |
| `stream_options.include_usage` | ✅ honoured | ✅ honoured |

**The one real gap: oMLX accepts `thinking_token_budget` without enforcing it.** Haai
detects this (`reasoning.budget.enforcement: "accepted_not_enforced"` for the `omlx`
provider default) and, when a v-model mixes an oMLX backend with a budget-enforcing one,
steers budgeted requests away from oMLX automatically. If oMLX is the only backend
available, the request still runs — with an `X-HAAI-Warning:
reasoning_budget_not_enforced` header and a matching `haai.warnings[]` entry, rather than
silently under-delivering.

Haai also aliases `reasoning_content` into `reasoning` (and vice versa) on every
response, so clients don't need to special-case oMLX to read reasoning output.

If a future oMLX version starts enforcing budgets, override the default per backend
without touching `provider` (which is part of the published model-id and can't be
changed after creation):

```bash
curl -X PATCH -H "Authorization: Bearer $HAAI_ADMIN_TOKEN" \
  http://localhost:4001/api/v1/backends/<id> \
  -H 'Content-Type: application/json' \
  -d '{"reasoningCaps": {"budget": {"enforcement": "exact"}}}'
```

## Model IDs

```
Qwen3.6-35B-A3B-UD-MLX-4bit:mac-studio:omlx
```

## Tips

- oMLX's `GET /v1/models` reports `max_model_len` per model but no capability metadata —
  Haai's own `GET /v1/models` fills that gap (see
  [Thinking budgets across mixed backends](../debugging-thinking.md#checking-capability-on-get-v1models)).
- oMLX also exposes an Anthropic-compatible `/v1/messages` endpoint; Haai only proxies
  the OpenAI-compatible `/v1/chat/completions` surface.
