# Thinking budgets across mixed backends

Symptom: a reasoning model (e.g. Qwen3 served by vLLM) honours thinking-budget
parameters when you call it directly, but seems to ignore them — or lose the
reasoning trace entirely — when the same request goes through Haai.

**Haai forwards the request body byte-for-byte.** It has no allowlist and no
schema for `/v1/chat/completions` — every field you send, known or not,
survives the trip to the upstream except `model`, which is rewritten to the
backend's model id. This is covered by
`tests/e2e/src/thinking-passthrough.test.ts` in this repo.

The actual cause, confirmed against a live 3-backend v-model in this project:
**a v-model can fan a single alias out across backends that don't all support
the same thinking mechanism.** vLLM *enforces* a reasoning token budget; some
other engines (measured: [oMLX](./providers/omlx.md)) accept the same
parameter and silently ignore it. `session-pin` (the default balancing
strategy) locks one API key to one backend for its lifetime, so the same
client could get a real budget on some keys and none at all on others, purely
by which backend it happened to pin to — with no error.

**As of this version, Haai fixes this automatically**: it detects when a
request needs a reasoning budget enforced and steers it to a backend that can
actually do that, falls back gracefully (with a warning) when none is
available, and normalises reasoning field names across backends. The rest of
this page explains the mechanism and gives you tools to verify it yourself.

## The parameter that actually works

Use **`thinking_token_budget`** (a top-level field, not nested in
`chat_template_kwargs`). Measured directly against vLLM 0.28 + Qwen3: budget
50 → exactly 49 reasoning tokens; budget 200 → exactly 199. It also works
identically under streaming.

Two params that look plausible but are NOT reliable budget controls:
- `chat_template_kwargs.thinking_budget` — wrong name, silently ignored by
  every engine we've tested. Haai rescues this into a real
  `thinking_token_budget` for you (see below), but don't rely on the
  original name doing anything on its own.
- `reasoning_effort` — accepted, but measured **non-monotonic** on vLLM
  (`"low"` produced *more* reasoning tokens than `"high"`). Haai maps effort
  levels (`low`/`medium`/`high`/…) to a concrete `thinking_token_budget` on
  budget-enforcing backends, but don't use effort as a precise lever on its
  own, and expect a `reasoning_effort_unreliable` info-level warning when you
  send it.

`chat_template_kwargs.enable_thinking: false` reliably turns thinking off on
every engine we've measured, and — unlike budgeting — **never affects
routing**: a backend that can't think at all trivially satisfies "don't
think".

Ground truth for whether thinking happened:
- Non-streaming: `choices[0].message.reasoning` (vLLM) or
  `choices[0].message.reasoning_content` (oMLX) — Haai now adds whichever
  name is missing, so **either name works regardless of backend**. Also
  `usage.completion_tokens_details.reasoning_tokens` (vLLM only; absent, not
  zero, on backends that don't itemise it).
- Streaming: `choices[0].delta.reasoning` / `delta.reasoning_content`
  (same aliasing applies), and a final usage chunk if you send
  `stream_options: { include_usage: true }`.

## The truncation trap

A reasoning request with `max_tokens` too close to (or below) the reasoning
budget yields **partial chain-of-thought bleeding into `content`** and
`finish_reason: "length"` — on every engine tested. This produced a wrong
measurement while this feature was being built. Haai now warns about it
pre-flight (`reasoning_budget_exceeds_max_tokens`,
`reasoning_max_tokens_too_small`) before the request even goes out. Rule of
thumb: `max_tokens` should exceed your `thinking_token_budget` by at least
500.

## How Haai's capability-aware routing works

Each backend has resolved **reasoning capabilities**
(`packages/proxy/src/reasoning/`, `@haai/core`'s `resolveReasoningCaps`):
whether it can toggle thinking, whether it *enforces* a requested budget
(`"exact"`) or merely *accepts and ignores* one (`"accepted_not_enforced"`),
which field name it returns reasoning under, and whether it reports
`reasoning_tokens` in `usage`. These default per `provider` (only `vllm` and
`omlx` are measured so far — see `packages/core/src/reasoning/profiles.ts`)
and can be overridden per backend via `PATCH /api/v1/backends/:id` with a
`reasoningCaps` JSON override, without touching `provider` (which is part of
the published model-id and can't be changed after creation).

**The only routing gate is a positive `thinking_token_budget`.** Toggling
reasoning on/off, and `reasoning_effort` alone, never steer a request — both
measured engines toggle fine, and effort is unreliable on both, so gating on
it would just narrow the pool for no benefit. When a budget is requested,
[`preferReasoningCapable`](../../packages/proxy/src/balancer.ts) narrows the
candidate pool to budget-enforcing backends — but only as a *soft*
preference: if none is available, the request still runs on whatever's left,
with a warning attached, rather than failing.

### Reading the warnings

Every response may carry warnings when the client's reasoning intent
couldn't be fully honoured — an additive, namespaced `haai.warnings[]` array
in the JSON body (non-streaming and buffered), an injected trailing SSE
chunk with `choices: []` and the same shape (streaming), and an
`X-HAAI-Warning` header with just the comma-joined codes (all paths,
including the raw byte-verbatim streaming fast path, since it's set at
`writeHead` time before any upstream bytes arrive).

| Code | Meaning |
| --- | --- |
| `reasoning_budget_not_enforced` | Backend accepted the budget param but doesn't enforce it (the oMLX case) |
| `reasoning_budget_unsupported` | Backend has no budget mechanism at all |
| `reasoning_toggle_unsupported` | Backend can't be told to stop thinking |
| `reasoning_tokens_unreported` | Backend doesn't report `reasoning_tokens` in `usage` |
| `reasoning_no_capable_backend` | A capable backend is configured but currently unavailable |
| `reasoning_budget_exceeds_max_tokens` / `reasoning_max_tokens_too_small` | The truncation trap, caught pre-flight |
| `reasoning_effort_unreliable` | `reasoning_effort` was sent; not a reliable lever on measured backends |

There's no OpenAI standard for this — the closest de facto conventions are
OpenRouter's `supported_parameters[]` and Ollama's `capabilities[]`, both of
which Haai also emits on `GET /v1/models` (see below). Unknown top-level
response fields are ignored by the official SDKs, so `haai.*` is safe to
leave attached even for clients that don't look for it.

## Checking capability on `GET /v1/models`

Every model entry carries `supported_parameters` (OpenRouter-style; only
claims `"reasoning"` when a backend actually *enforces* a budget — claiming
it for an accept-but-ignore backend would repeat the exact silent lie this
feature exists to eliminate), `capabilities` (Ollama-style; `"thinking"` for
any backend that can think at all, budget or not), and a precise
`haai.reasoning` block. V-model entries aggregate over their live member
backends and report `guaranteed: false` plus `capable_backends: n` /
`total_backends: m` when the pool disagrees — this alone tells you whether a
v-model alias is safe to send budgets to, without any curl probing:

```bash
curl -s -H "Authorization: Bearer $HAAI_KEY" http://localhost:4001/v1/models \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)
for m in d["data"]:
    r = m.get("haai", {}).get("reasoning")
    if r: print(m["id"], "->", r)'
```

## curl runbook

The proxy's dev instance listens on **4001**, not 4000 — `HAAI_DEV=1` forces
4001 and ignores `HAAI_PORT` when it's set to 4000. Check with:

```bash
curl -s http://localhost:4001/health   # or :4000 in a production deployment
```

You'll need a Haai API key (`haai-sk-…`), not your admin token:

```bash
haai key list
# or, via the admin API:
curl -s -H "Authorization: Bearer $HAAI_ADMIN_TOKEN" http://localhost:4001/api/v1/keys
curl -s -H "Authorization: Bearer $HAAI_ADMIN_TOKEN" http://localhost:4001/api/v1/keys/<id>/secret
```

Reusable probe — prints reasoning tokens, which model answered, and any
Haai warnings:

```bash
probe() {  # usage: probe <base-url> <bearer-token-or-empty> <json-body>
  curl -sD /tmp/haai-probe-headers -m 120 "$1/chat/completions" -H 'Content-Type: application/json' \
    ${2:+-H "Authorization: Bearer $2"} -d "$3" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
msg = (d.get("choices") or [{}])[0].get("message", {})
u = d.get("usage", {})
print("served_by_model:", d.get("model"))
print("reasoning:", msg.get("reasoning") or msg.get("reasoning_content"))
print("reasoning_tokens:", u.get("completion_tokens_details", {}).get("reasoning_tokens"))
print("haai_warnings:", [w["code"] for w in d.get("haai", {}).get("warnings", [])])
'
  grep -i x-haai-warning /tmp/haai-probe-headers
}
```

```bash
BODY_ON='{"model":"MODEL","messages":[{"role":"user","content":"What is 17*23?"}],"max_tokens":1500,"thinking_token_budget":100}'
BODY_OFF='{"model":"MODEL","messages":[{"role":"user","content":"What is 17*23?"}],"max_tokens":300,"chat_template_kwargs":{"enable_thinking":false}}'

# A. Direct to the vLLM box — the baseline that "works".
probe http://ripper:8000/v1 "" "${BODY_ON//MODEL/Qwen3.6-35B-A3B}"    # expect reasoning_tokens ~100
probe http://ripper:8000/v1 "" "${BODY_OFF//MODEL/Qwen3.6-35B-A3B}"   # expect reasoning_tokens == 0

# B. Through Haai, same body, using your v-model alias.
probe http://localhost:4001/v1 "$HAAI_KEY" "${BODY_ON//MODEL/YOUR_VMODEL}"
probe http://localhost:4001/v1 "$HAAI_KEY" "${BODY_OFF//MODEL/YOUR_VMODEL}"
```

`served_by_model` in the budgeted call (A vs B) should now match even with a
mixed v-model — that's the capability routing working. If it doesn't, check
`GET /v1/models` for that v-model's `haai.reasoning.capable_backends` first;
`guaranteed: false` with `capable_backends: 0` means no backend behind that
alias can ever enforce a budget, which is a configuration gap, not a bug.

### Streaming check

```bash
curl -s -N -m 60 http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer $HAAI_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"YOUR_VMODEL","messages":[{"role":"user","content":"hi"}],
       "max_tokens":1500,"thinking_token_budget":100,
       "stream":true,"stream_options":{"include_usage":true}}' \
| grep -Ec '"reasoning"|"reasoning_content"'
```

### Don't use `haai prompt` to test this

The CLI's request body is built from only `model`, `messages`, and `stream`
(no way to pass `thinking_token_budget` or any other param), and its
streaming output only prints `delta.content` — reasoning deltas are
invisible even if the upstream sends them. If your original test was via
`haai prompt`, that alone explains the symptom; use curl instead.

## Automated tests

- `pnpm --filter @haai/e2e test` runs the full reasoning suite:
  `thinking-passthrough.test.ts` (byte-faithful request passthrough),
  `reasoning-normalize.test.ts` (bidirectional field aliasing, never
  fabricated), `reasoning-routing.test.ts` (capability-aware routing,
  fallback, warnings, the `thinking_token_budget` rescue), and
  `reasoning-models.test.ts` (`/v1/models` advertisement).
- `HAAI_LIVE_UPSTREAM=http://ripper:8000/v1 pnpm --filter @haai/e2e exec vitest run thinking-live`
  — a live differential test against a real vLLM box.
- `HAAI_LIVE_VLLM=http://ripper:8000/v1 HAAI_LIVE_OMLX=http://your-omlx:8000/v1 HAAI_LIVE_OMLX_KEY=... pnpm --filter @haai/e2e exec vitest run thinking-live`
  — the direct regression test for the original report against real
  hardware: seeds a temporary mixed v-model and proves every budgeted
  request lands on the vLLM box, never the oMLX one.
- `HAAI_PROXY_URL=http://localhost:4001 HAAI_PROXY_KEYS=haai-sk-a,haai-sk-b,... HAAI_FANOUT_VMODEL=test pnpm --filter @haai/e2e exec vitest run thinking-live`
  samples every backend behind a real v-model (one key per backend, since
  `session-pin` locks a key to one backend).
