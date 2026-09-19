import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertBackend, insertKey, insertVModel } from "./helpers/seed.js";

/**
 * Opt-in live differential tests against a real vLLM-compatible upstream.
 *
 * These are skipped by default (and therefore in CI) because they depend on network
 * access to a real box. Run them by hand when diagnosing a real "thinking budget is
 * lost through Haai" report:
 *
 *   HAAI_LIVE_UPSTREAM=http://ripper:8000/v1 pnpm --filter @haai/e2e exec vitest run thinking-live
 *
 * Each case sends the identical request body twice — once straight to
 * HAAI_LIVE_UPSTREAM, once through a freshly seeded Haai proxy with exactly one backend
 * pointed at that same URL — and asserts the two agree. Deliberately no absolute
 * token-count assertions: the model is non-deterministic across calls. Deliberately no
 * `reasoning_effort` case: manual probing against ripper showed "low" producing *more*
 * reasoning than "high", so it's not a usable ground truth.
 */
const LIVE_UPSTREAM = process.env.HAAI_LIVE_UPSTREAM;
const LIVE_MODEL = process.env.HAAI_LIVE_MODEL ?? "Qwen3.6-35B-A3B";

interface Usage {
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

async function chatCompletionDirect(
  base: string,
  body: Record<string, unknown>,
): Promise<{ status: number; usage: Usage | undefined; text: string }> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (body["stream"] === true) {
    // Pull the last SSE data line that carries a `usage` field.
    const usageLine = [...text.matchAll(/^data: (\{.*"usage".*\})$/gm)].pop();
    const usage = usageLine ? (JSON.parse(usageLine[1]!) as { usage: Usage }).usage : undefined;
    return { status: res.status, usage, text };
  }
  const parsed = text ? (JSON.parse(text) as { usage?: Usage }) : {};
  return { status: res.status, usage: parsed.usage, text };
}

describe.skipIf(!LIVE_UPSTREAM)("Thinking budget: live differential (Haai vs. direct)", () => {
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    if (!LIVE_UPSTREAM) return;
    proxy = await startTestProxy();

    const backendId = await insertBackend(proxy, {
      name: "live-vllm",
      hostName: "live-vllm-host",
      baseUrl: LIVE_UPSTREAM,
      provider: "vllm",
      availableModels: [LIVE_MODEL],
      lastHealthStatus: "healthy",
    });

    await insertVModel(proxy, {
      modelId: "live-thinking-chat",
      backends: [{ backendId, backendModelId: LIVE_MODEL }],
    });

    ({ key: apiKey } = await insertKey(proxy));
  }, 30_000);

  afterAll(async () => {
    await proxy?.stop();
  });

  it(
    "produces reasoning tokens by default, identically via direct and via Haai",
    async () => {
      const body = {
        messages: [{ role: "user", content: "What is 17*23? Think it through." }],
        max_tokens: 300,
        stream: false,
      };

      const direct = await chatCompletionDirect(LIVE_UPSTREAM!, { ...body, model: LIVE_MODEL });
      expect(direct.status).toBe(200);
      expect(direct.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBeGreaterThan(0);

      const res = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: "live-thinking-chat" }),
      });
      expect(res.status).toBe(200);
      const parsed = (await res.json()) as { usage?: Usage };
      expect(parsed.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "chat_template_kwargs.enable_thinking:false drives reasoning to zero, identically via direct and via Haai",
    async () => {
      const body = {
        messages: [{ role: "user", content: "What is 17*23?" }],
        max_tokens: 300,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      };

      const direct = await chatCompletionDirect(LIVE_UPSTREAM!, { ...body, model: LIVE_MODEL });
      expect(direct.status).toBe(200);
      expect(direct.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBe(0);

      const res = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: "live-thinking-chat" }),
      });
      expect(res.status).toBe(200);
      const parsed = (await res.json()) as { usage?: Usage };
      // The load-bearing assertion: if this is nonzero while `direct` is zero, Haai (or
      // something between the client and ripper) is genuinely dropping the param.
      expect(parsed.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBe(0);
    },
    120_000,
  );

  it(
    "streams delta.reasoning and a reasoning-token usage chunk identically via direct and via Haai",
    async () => {
      const body = {
        messages: [{ role: "user", content: "What is 17*23? Think it through." }],
        max_tokens: 300,
        stream: true,
        stream_options: { include_usage: true },
      };

      const direct = await chatCompletionDirect(LIVE_UPSTREAM!, { ...body, model: LIVE_MODEL });
      expect(direct.status).toBe(200);
      expect(direct.text).toContain('"reasoning"');
      expect(direct.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBeGreaterThan(0);

      const res = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: "live-thinking-chat" }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"reasoning"');
      const usageLine = [...text.matchAll(/^data: (\{.*"usage".*\})$/gm)].pop();
      const usage = usageLine ? (JSON.parse(usageLine[1]!) as { usage: Usage }).usage : undefined;
      expect(usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBeGreaterThan(0);
    },
    120_000,
  );
});

/**
 * Second opt-in suite: point at a real, already-configured v-model (by its modelId) on
 * a *running* Haai instance and check whether every candidate backend behind it treats
 * `enable_thinking:false` the same way.
 *
 * `session-pin` (the default balancing strategy) locks a given API key to one backend
 * for its lifetime, so a single key can never sample the rest of the pool — you need one
 * key per backend you want to observe. Pass as many keys as you have via
 * HAAI_PROXY_KEYS (comma-separated); each is tried once.
 *
 * A backend's response is classified as:
 *   - "confirmed-off"          — reports completion_tokens_details.reasoning_tokens === 0
 *                                 and no reasoning text. Thinking was toggled off correctly.
 *   - "confirmed-ignored"      — produced reasoning anyway. A real bug: this backend does
 *                                 not honour the flag at all.
 *   - "no-reasoning-telemetry" — the response carries neither a `reasoning` field nor
 *                                 completion_tokens_details at all, so there's no signal
 *                                 either way. Measured live against an MLX-served model:
 *                                 this is what MLX backends behind a fanned-out v-model
 *                                 return, indistinguishable from "thinking never happened"
 *                                 — this is the shape of the original complaint.
 *
 * The test fails if any backend is "confirmed-ignored", or if backends disagree on
 * classification — that disagreement (one backend reports proper reasoning telemetry,
 * another reports none at all) is what makes "thinking budgets work directly but seem
 * lost through Haai" true for *some* requests and not others, purely due to which
 * backend `session-pin` happened to route to.
 *
 *   HAAI_PROXY_URL=http://localhost:4001 \
 *     HAAI_PROXY_KEYS=haai-sk-aaa,haai-sk-bbb,haai-sk-ccc \
 *     HAAI_FANOUT_VMODEL=test pnpm --filter @haai/e2e exec vitest run thinking-live
 */
const FANOUT_PROXY_URL = process.env.HAAI_PROXY_URL;
const FANOUT_PROXY_KEYS = (process.env.HAAI_PROXY_KEYS ?? process.env.HAAI_PROXY_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const FANOUT_VMODEL = process.env.HAAI_FANOUT_VMODEL;

type ThinkingSupport = "confirmed-off" | "confirmed-ignored" | "no-reasoning-telemetry";

function classifyThinkingSupport(
  message: Record<string, unknown> | undefined,
  usage: Usage | undefined,
): ThinkingSupport {
  const hasReasoningField = !!message && "reasoning" in message;
  const reasoningText = (message?.["reasoning"] as string | undefined) ?? "";
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;

  if (!hasReasoningField && reasoningTokens === undefined) {
    return "no-reasoning-telemetry";
  }
  if (reasoningText.length > 0 || (reasoningTokens ?? 0) > 0) {
    return "confirmed-ignored";
  }
  return "confirmed-off";
}

describe.skipIf(!(FANOUT_PROXY_URL && FANOUT_PROXY_KEYS.length > 0 && FANOUT_VMODEL))(
  "Thinking budget: real v-model fan-out check",
  () => {
    it(
      "every backend behind the v-model agrees on how enable_thinking:false is reported",
      async () => {
        const byBackend = new Map<string, ThinkingSupport>();

        for (const key of FANOUT_PROXY_KEYS) {
          const res = await fetch(`${FANOUT_PROXY_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: FANOUT_VMODEL,
              messages: [{ role: "user", content: "What is 17*23?" }],
              max_tokens: 300,
              stream: false,
              chat_template_kwargs: { enable_thinking: false },
            }),
          });
          expect(res.status).toBe(200);
          const parsed = (await res.json()) as {
            model?: string;
            choices?: Array<{ message?: Record<string, unknown> }>;
            usage?: Usage;
          };
          const servedBy = parsed.model ?? "unknown";
          byBackend.set(servedBy, classifyThinkingSupport(parsed.choices?.[0]?.message, parsed.usage));
        }

        const report = [...byBackend.entries()].map(([m, c]) => `${m} -> ${c}`).join("; ");
        const ignored = [...byBackend.entries()].filter(([, c]) => c === "confirmed-ignored");
        const distinctClassifications = new Set(byBackend.values());

        expect(byBackend.size, "no distinct backends were sampled — add more keys").toBeGreaterThan(0);
        expect(ignored, `backends that ignore enable_thinking:false entirely: ${report}`).toEqual([]);
        expect(
          distinctClassifications.size,
          `backends behind '${FANOUT_VMODEL}' disagree on thinking support: ${report}`,
        ).toBe(1);
      },
      180_000,
    );
  },
);

/**
 * Third opt-in suite: the direct regression test for the original report, against real
 * hardware. Seeds a FRESH temporary v-model (its own temp SQLite DB — nothing written to
 * your real ~/.haai/data.db) with one vLLM-dialect backend and one oMLX-dialect backend,
 * both pointed at real boxes, and proves the capability-aware balancer in
 * packages/proxy/src/balancer.ts actually steers budgeted requests to the one that can
 * honour them — every time, regardless of which backend session-pin would otherwise have
 * picked.
 *
 *   HAAI_LIVE_VLLM=http://ripper:8000/v1 HAAI_LIVE_OMLX=http://jasons-mac-studio:8000/v1 \
 *     HAAI_LIVE_OMLX_KEY=... HAAI_LIVE_VLLM_MODEL=Qwen3.6-35B-A3B \
 *     HAAI_LIVE_OMLX_MODEL=Qwen3.6-35B-A3B-UD-MLX-4bit \
 *     pnpm --filter @haai/e2e exec vitest run thinking-live
 */
const LIVE_VLLM = process.env.HAAI_LIVE_VLLM;
const LIVE_OMLX = process.env.HAAI_LIVE_OMLX;
const LIVE_VLLM_MODEL = process.env.HAAI_LIVE_VLLM_MODEL ?? "Qwen3.6-35B-A3B";
const LIVE_OMLX_MODEL = process.env.HAAI_LIVE_OMLX_MODEL ?? "Qwen3.6-35B-A3B-UD-MLX-4bit";
const LIVE_OMLX_KEY = process.env.HAAI_LIVE_OMLX_KEY;

describe.skipIf(!(LIVE_VLLM && LIVE_OMLX))(
  "Thinking budget: capability-aware routing against real hardware",
  () => {
    let proxy: TestProxy;
    let apiKey: string;

    beforeAll(async () => {
      if (!LIVE_VLLM || !LIVE_OMLX) return;
      proxy = await startTestProxy();

      const vllmBackendId = await insertBackend(proxy, {
        name: "live-vllm",
        hostName: "live-vllm-host",
        baseUrl: LIVE_VLLM,
        provider: "vllm",
        availableModels: [LIVE_VLLM_MODEL],
        lastHealthStatus: "healthy",
      });
      const omlxBackendId = await insertBackend(proxy, {
        name: "live-omlx",
        hostName: "live-omlx-host",
        baseUrl: LIVE_OMLX,
        provider: "omlx",
        availableModels: [LIVE_OMLX_MODEL],
        lastHealthStatus: "healthy",
        ...(LIVE_OMLX_KEY ? { apiKey: LIVE_OMLX_KEY } : {}),
      });

      await insertVModel(proxy, {
        modelId: "live-mixed-chat",
        balancingStrategy: "round-robin",
        backends: [
          { backendId: vllmBackendId, backendModelId: LIVE_VLLM_MODEL },
          { backendId: omlxBackendId, backendModelId: LIVE_OMLX_MODEL },
        ],
      });

      ({ key: apiKey } = await insertKey(proxy));
    }, 30_000);

    afterAll(async () => {
      await proxy?.stop();
    });

    it(
      "a thinking_token_budget request always lands on the real vLLM box, never the real oMLX box",
      async () => {
        // max_tokens well above the budget — avoids the truncation trap that produced a
        // wrong measurement earlier in this project (see docs/guide/debugging-thinking.md).
        const body = {
          model: "live-mixed-chat",
          messages: [{ role: "user", content: "What is 17*23? Think it through." }],
          max_tokens: 1500,
          thinking_token_budget: 60,
          stream: false,
        };
        const servedBy = new Set<string>();
        for (let i = 0; i < 4; i++) {
          const res = await fetch(`${proxy.url}/v1/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(res.status).toBe(200);
          const data = (await res.json()) as { model?: string; usage?: Usage };
          servedBy.add(data.model ?? "unknown");
          // Every call must land on vLLM and report an honoured budget — this is the
          // exact scenario that, before this fix, session-pinned unpredictably to oMLX.
          expect(data.model).toBe(LIVE_VLLM_MODEL);
          expect(data.usage?.completion_tokens_details?.reasoning_tokens ?? 0).toBeLessThanOrEqual(65);
        }
        expect(servedBy).toEqual(new Set([LIVE_VLLM_MODEL]));
      },
      180_000,
    );
  },
);
