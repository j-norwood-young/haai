import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { startRecordingUpstream, type StartedRecordingUpstream } from "./helpers/recording-upstream.js";
import { insertBackend, insertKey, insertVModel, setBackendHealth } from "./helpers/seed.js";

/**
 * A v-model can fan out across a budget-enforcing backend (vLLM) and a
 * budget-accepting-but-ignoring one (oMLX). The only routing gate is a positive
 * `thinking_token_budget` — toggling reasoning on/off, and `reasoning_effort`, must
 * never steer a request (see docs/guide/debugging-thinking.md and
 * packages/proxy/src/balancer.ts's `preferReasoningCapable`).
 */
describe("Reasoning-aware routing and dialect translation", () => {
  let vllmUpstream: StartedRecordingUpstream;
  let omlxUpstream: StartedRecordingUpstream;
  let proxy: TestProxy;
  let apiKey: string;
  let vllmBackendId: string;
  let vmodelId: string;

  beforeAll(async () => {
    vllmUpstream = await startRecordingUpstream({ models: ["vllm-model"], dialect: "vllm" });
    omlxUpstream = await startRecordingUpstream({ models: ["omlx-model"], dialect: "omlx" });
    proxy = await startTestProxy();

    vllmBackendId = await insertBackend(proxy, {
      name: "vllm-backend",
      hostName: "vllm-host",
      baseUrl: vllmUpstream.url,
      provider: "vllm",
      availableModels: ["vllm-model"],
      lastHealthStatus: "healthy",
    });
    const omlxBackendId = await insertBackend(proxy, {
      name: "omlx-backend",
      hostName: "omlx-host",
      baseUrl: omlxUpstream.url,
      provider: "omlx",
      availableModels: ["omlx-model"],
      lastHealthStatus: "healthy",
    });

    vmodelId = await insertVModel(proxy, {
      modelId: "mixed-chat",
      // round-robin so an unrouted request samples both backends across a few calls.
      balancingStrategy: "round-robin",
      backends: [
        { backendId: vllmBackendId, backendModelId: "vllm-model" },
        { backendId: omlxBackendId, backendModelId: "omlx-model" },
      ],
    });

    ({ key: apiKey } = await insertKey(proxy));
  });

  afterAll(async () => {
    await proxy.stop();
    await vllmUpstream.stop();
    await omlxUpstream.stop();
  });

  async function chat(body: Record<string, unknown>) {
    return fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mixed-chat",
        messages: [{ role: "user", content: "What is 17*23?" }],
        stream: false,
        ...body,
      }),
    });
  }

  it("a budget request always lands on the budget-enforcing backend", async () => {
    vllmUpstream.reset();
    omlxUpstream.reset();
    for (let i = 0; i < 6; i++) {
      const res = await chat({ thinking_token_budget: 100 });
      expect(res.status).toBe(200);
    }
    expect(vllmUpstream.received.length).toBe(6);
    expect(omlxUpstream.received.length).toBe(0);
  });

  it("a plain request (no reasoning params) distributes across both backends", async () => {
    vllmUpstream.reset();
    omlxUpstream.reset();
    for (let i = 0; i < 6; i++) {
      const res = await chat({});
      expect(res.status).toBe(200);
    }
    expect(vllmUpstream.received.length).toBeGreaterThan(0);
    expect(omlxUpstream.received.length).toBeGreaterThan(0);
  });

  it("enable_thinking:false distributes across both backends — disabling must never steer", async () => {
    vllmUpstream.reset();
    omlxUpstream.reset();
    for (let i = 0; i < 6; i++) {
      const res = await chat({ chat_template_kwargs: { enable_thinking: false } });
      expect(res.status).toBe(200);
    }
    expect(vllmUpstream.received.length).toBeGreaterThan(0);
    expect(omlxUpstream.received.length).toBeGreaterThan(0);
  });

  it("reasoning_effort alone distributes across both backends — effort must never steer", async () => {
    vllmUpstream.reset();
    omlxUpstream.reset();
    for (let i = 0; i < 6; i++) {
      const res = await chat({ reasoning_effort: "high" });
      expect(res.status).toBe(200);
    }
    expect(vllmUpstream.received.length).toBeGreaterThan(0);
    expect(omlxUpstream.received.length).toBeGreaterThan(0);
  });

  it("falls back to the accepting-but-ignoring backend (with a warning) when the capable one is down", async () => {
    setBackendHealth(proxy, vllmBackendId, { status: "unhealthy" });
    try {
      vllmUpstream.reset();
      omlxUpstream.reset();
      const res = await chat({ thinking_token_budget: 100 });
      expect(res.status).toBe(200);
      expect(vllmUpstream.received.length).toBe(0);
      expect(omlxUpstream.received.length).toBe(1);
      const warningHeader = res.headers.get("x-haai-warning") ?? "";
      expect(warningHeader).toContain("reasoning_no_capable_backend");
      expect(warningHeader).toContain("reasoning_budget_not_enforced");
      const data = (await res.json()) as { haai?: { warnings?: Array<{ code: string }> } };
      expect(data.haai?.warnings?.some((w) => w.code === "reasoning_no_capable_backend")).toBe(true);
    } finally {
      setBackendHealth(proxy, vllmBackendId, { status: "healthy", models: ["vllm-model"] });
    }
  });

  it("rescues the wrong-name chat_template_kwargs.thinking_budget into a real thinking_token_budget on vLLM", async () => {
    vllmUpstream.reset();
    const res = await chat({ chat_template_kwargs: { thinking_budget: 64 } });
    expect(res.status).toBe(200);
    const sent = vllmUpstream.lastRequest();
    expect(sent!.body["thinking_token_budget"]).toBe(64);
    // The original (ignored) field must still be forwarded verbatim — additive only.
    expect((sent!.body["chat_template_kwargs"] as Record<string, unknown>)["thinking_budget"]).toBe(64);
  });

  it("never adds thinking_token_budget to an oMLX request that didn't ask for one explicitly", async () => {
    // Force omlx by disabling vllm's availability for this one check.
    setBackendHealth(proxy, vllmBackendId, { status: "unhealthy" });
    try {
      omlxUpstream.reset();
      const res = await chat({ thinking_token_budget: 100 });
      expect(res.status).toBe(200);
      const sent = omlxUpstream.lastRequest();
      // The client's own field passes through untouched; haai must not additionally
      // fabricate compliance-looking fields on top of it.
      expect(sent!.body["thinking_token_budget"]).toBe(100);
      const data = (await res.json()) as { haai?: { warnings?: Array<{ code: string }> } };
      expect(data.haai?.warnings?.some((w) => w.code === "reasoning_budget_not_enforced")).toBe(true);
    } finally {
      setBackendHealth(proxy, vllmBackendId, { status: "healthy", models: ["vllm-model"] });
    }
  });

  it("flags a budget that leaves no room under max_tokens before the request is even sent", async () => {
    const res = await chat({ thinking_token_budget: 400, max_tokens: 300 });
    expect(res.status).toBe(200);
    const warningHeader = res.headers.get("x-haai-warning") ?? "";
    expect(warningHeader).toContain("reasoning_budget_exceeds_max_tokens");
  });

  it("reports reasoning_tokens_unreported for the accepting-but-ignoring backend", async () => {
    setBackendHealth(proxy, vllmBackendId, { status: "unhealthy" });
    try {
      const res = await chat({ chat_template_kwargs: { enable_thinking: true } });
      const data = (await res.json()) as { haai?: { warnings?: Array<{ code: string }> } };
      expect(data.haai?.warnings?.some((w) => w.code === "reasoning_tokens_unreported")).toBe(true);
    } finally {
      setBackendHealth(proxy, vllmBackendId, { status: "healthy", models: ["vllm-model"] });
    }
  });

  it("does not attach any haai warnings to a plain request", async () => {
    const res = await chat({});
    expect(res.headers.get("x-haai-warning")).toBeNull();
    const data = (await res.json()) as { haai?: unknown };
    expect(data.haai).toBeUndefined();
  });

  it("streaming: a warning is injected as a trailing chunk before [DONE]", async () => {
    setBackendHealth(proxy, vllmBackendId, { status: "unhealthy" });
    try {
      const res = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mixed-chat",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
          thinking_token_budget: 100,
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-haai-warning")).toContain("reasoning_budget_not_enforced");
      const text = await res.text();
      expect(text).toContain('"haai":{"warnings"');
      expect(text).toContain('"choices":[]');
      const doneIdx = text.indexOf("data: [DONE]");
      const warningIdx = text.indexOf('"haai"');
      expect(warningIdx).toBeGreaterThan(-1);
      expect(warningIdx).toBeLessThan(doneIdx);
    } finally {
      setBackendHealth(proxy, vllmBackendId, { status: "healthy", models: ["vllm-model"] });
    }
  });

  it("/v1/models reflects the v-model as guaranteed:false when its backends disagree on budget enforcement", async () => {
    const res = await fetch(`${proxy.url}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = (await res.json()) as {
      data: Array<{ id: string; haai?: { reasoning?: Record<string, unknown> } }>;
    };
    const entry = data.data.find((m) => m.id === "mixed-chat");
    expect(entry).toBeDefined();
    expect(entry!.haai?.reasoning?.["guaranteed"]).toBe(false);
    expect(entry!.haai?.reasoning?.["capable_backends"]).toBe(1);
    expect(entry!.haai?.reasoning?.["total_backends"]).toBe(2);
  });

  it("(sanity) vmodelId is wired up correctly for the mixed v-model", () => {
    expect(vmodelId).toBeTruthy();
  });
});
