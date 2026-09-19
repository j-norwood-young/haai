import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { startRecordingUpstream, type StartedRecordingUpstream } from "./helpers/recording-upstream.js";
import { insertBackend, insertKey, insertVModel } from "./helpers/seed.js";

/**
 * vLLM separates reasoning into `message.reasoning` / `delta.reasoning`; oMLX separates
 * it into `message.reasoning_content` / `delta.reasoning_content` — same content, just a
 * naming disagreement (see docs/guide/debugging-thinking.md). Haai additively aliases
 * whichever name a backend used into the other, so clients can read either name
 * regardless of which backend actually served the request.
 *
 * Load-bearing rule under test: never fabricate a field when NEITHER name is present.
 */
describe("Reasoning field-name normalisation", () => {
  let vllmUpstream: StartedRecordingUpstream;
  let omlxUpstream: StartedRecordingUpstream;
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    vllmUpstream = await startRecordingUpstream({ models: ["vllm-model"], dialect: "vllm" });
    omlxUpstream = await startRecordingUpstream({ models: ["omlx-model"], dialect: "omlx" });
    proxy = await startTestProxy();

    const vllmBackendId = await insertBackend(proxy, {
      name: "vllm-backend",
      hostName: "vllm-host",
      baseUrl: vllmUpstream.url,
      provider: "vllm",
      availableModels: ["vllm-model"],
      lastHealthStatus: "healthy",
    });
    await insertVModel(proxy, {
      modelId: "vllm-chat",
      backends: [{ backendId: vllmBackendId, backendModelId: "vllm-model" }],
    });

    const omlxBackendId = await insertBackend(proxy, {
      name: "omlx-backend",
      hostName: "omlx-host",
      baseUrl: omlxUpstream.url,
      provider: "omlx",
      availableModels: ["omlx-model"],
      lastHealthStatus: "healthy",
    });
    await insertVModel(proxy, {
      modelId: "omlx-chat",
      backends: [{ backendId: omlxBackendId, backendModelId: "omlx-model" }],
    });

    ({ key: apiKey } = await insertKey(proxy));
  });

  afterAll(async () => {
    await proxy.stop();
    await vllmUpstream.stop();
    await omlxUpstream.stop();
  });

  async function chat(model: string, body: Record<string, unknown> = {}) {
    return fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "What is 17*23?" }],
        ...body,
      }),
    });
  }

  it("non-streaming: vLLM's native `reasoning` gains a `reasoning_content` alias", async () => {
    const res = await chat("vllm-chat", { stream: false });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { choices: Array<{ message: Record<string, unknown> }> };
    const message = data.choices[0]!.message;
    expect(message["reasoning"]).toBe("Let me think about this.");
    expect(message["reasoning_content"]).toBe("Let me think about this.");
  });

  it("non-streaming: oMLX's native `reasoning_content` gains a `reasoning` alias", async () => {
    const res = await chat("omlx-chat", { stream: false });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { choices: Array<{ message: Record<string, unknown> }> };
    const message = data.choices[0]!.message;
    expect(message["reasoning_content"]).toBe("Let me think about this.");
    expect(message["reasoning"]).toBe("Let me think about this.");
  });

  it("streaming: oMLX's delta.reasoning_content gains a delta.reasoning alias, and vLLM's own field survives byte-verbatim", async () => {
    const vllmRes = await chat("vllm-chat", { stream: true });
    const vllmText = await vllmRes.text();
    // vLLM is the canonical field name — the fast, byte-verbatim path — so the exact
    // substrings from the upstream must appear unmodified.
    expect(vllmText).toContain('"reasoning":"Let me "');
    expect(vllmText).toContain('"reasoning":"think about "');
    expect(vllmText).toContain('"reasoning":"this."');

    const omlxRes = await chat("omlx-chat", { stream: true });
    const omlxText = await omlxRes.text();
    expect(omlxText).toContain('"reasoning_content":"Let me "');
    // The alias must appear in the SAME delta chunk as the original.
    expect(omlxText).toMatch(/"reasoning_content":"Let me "[^}]*"reasoning":"Let me "|"reasoning":"Let me "[^}]*"reasoning_content":"Let me "/);
  });

  it("never fabricates a reasoning field when the backend sent none (enable_thinking:false)", async () => {
    const vllmRes = await chat("vllm-chat", {
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    });
    const vllmData = (await vllmRes.json()) as { choices: Array<{ message: Record<string, unknown> }> };
    expect(vllmData.choices[0]!.message["reasoning"]).toBeUndefined();
    expect(vllmData.choices[0]!.message["reasoning_content"]).toBeUndefined();

    const omlxRes = await chat("omlx-chat", {
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    });
    const omlxData = (await omlxRes.json()) as { choices: Array<{ message: Record<string, unknown> }> };
    expect(omlxData.choices[0]!.message["reasoning"]).toBeUndefined();
    expect(omlxData.choices[0]!.message["reasoning_content"]).toBeUndefined();
  });

  it("never fabricates completion_tokens_details for oMLX, which doesn't report one", async () => {
    const res = await chat("omlx-chat", { stream: false });
    const data = (await res.json()) as { usage?: { completion_tokens_details?: unknown } };
    expect(data.usage?.completion_tokens_details).toBeUndefined();
  });
});
