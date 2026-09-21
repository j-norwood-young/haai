import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { startRecordingUpstream, type StartedRecordingUpstream } from "./helpers/recording-upstream.js";
import { insertBackend, insertKey } from "./helpers/seed.js";

/**
 * GET /v1/models advertises reasoning capability using two de facto conventions
 * (OpenRouter's `supported_parameters`, Ollama's `capabilities`) plus a precise
 * `haai.reasoning` block for everything those two arrays can't express — chiefly the
 * "toggles but doesn't enforce a budget" state that a boolean can't distinguish from
 * "fully supports it".
 */
describe("Reasoning capability advertisement on /v1/models", () => {
  let vllmUpstream: StartedRecordingUpstream;
  let omlxUpstream: StartedRecordingUpstream;
  let genericUpstream: StartedRecordingUpstream;
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    vllmUpstream = await startRecordingUpstream({ models: ["vllm-model"], dialect: "vllm" });
    omlxUpstream = await startRecordingUpstream({ models: ["omlx-model"], dialect: "omlx" });
    genericUpstream = await startRecordingUpstream({ models: ["generic-model"], dialect: "vllm" });
    proxy = await startTestProxy();

    await insertBackend(proxy, {
      name: "vllm-backend",
      hostName: "vllm-host",
      baseUrl: vllmUpstream.url,
      provider: "vllm",
      availableModels: ["vllm-model"],
      modelCatalog: [{ id: "vllm-model", kind: "llm", source: "heuristic" }],
      lastHealthStatus: "healthy",
    });
    await insertBackend(proxy, {
      name: "omlx-backend",
      hostName: "omlx-host",
      baseUrl: omlxUpstream.url,
      provider: "omlx",
      availableModels: ["omlx-model"],
      modelCatalog: [{ id: "omlx-model", kind: "llm", source: "heuristic" }],
      lastHealthStatus: "healthy",
    });
    await insertBackend(proxy, {
      name: "generic-backend",
      hostName: "generic-host",
      baseUrl: genericUpstream.url,
      provider: "generic",
      availableModels: ["generic-model"],
      modelCatalog: [{ id: "generic-model", kind: "llm", source: "heuristic" }],
      lastHealthStatus: "healthy",
    });

    ({ key: apiKey } = await insertKey(proxy));
  });

  afterAll(async () => {
    await proxy.stop();
    await vllmUpstream.stop();
    await omlxUpstream.stop();
    await genericUpstream.stop();
  });

  async function listModels() {
    const res = await fetch(`${proxy.url}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      data: Array<{
        id: string;
        supported_parameters?: string[];
        capabilities?: string[];
        haai?: { provider?: string; reasoning?: Record<string, unknown> };
      }>;
    };
  }

  it("advertises vLLM as fully budget-capable", async () => {
    const data = await listModels();
    const entry = data.data.find((m) => m.id.startsWith("vllm-model:"));
    expect(entry).toBeDefined();
    expect(entry!.capabilities).toContain("thinking");
    expect(entry!.supported_parameters).toContain("reasoning");
    expect(entry!.supported_parameters).toContain("thinking_token_budget");
    expect(entry!.haai?.reasoning?.["budget"]).toEqual({ enforcement: "exact", param: "thinking_token_budget" });
    expect(entry!.haai?.reasoning?.["channel"]).toBe("reasoning");
  });

  it("advertises oMLX as thinking-capable but NOT claiming the 'reasoning' supported_parameter (it doesn't enforce a budget)", async () => {
    const data = await listModels();
    const entry = data.data.find((m) => m.id.startsWith("omlx-model:"));
    expect(entry).toBeDefined();
    expect(entry!.capabilities).toContain("thinking");
    // Claiming "reasoning" here would repeat the exact silent lie this feature exists
    // to eliminate: oMLX accepts a budget parameter without enforcing it.
    expect(entry!.supported_parameters ?? []).not.toContain("reasoning");
    expect(entry!.haai?.reasoning?.["budget"]).toEqual({
      enforcement: "accepted_not_enforced",
      param: "thinking_token_budget",
    });
    expect(entry!.haai?.reasoning?.["channel"]).toBe("reasoning_content");
    expect(entry!.haai?.reasoning?.["usage_reasoning_tokens"]).toBe(false);
  });

  it("advertises a generic (unverified) backend as having no reasoning capability", async () => {
    const data = await listModels();
    const entry = data.data.find((m) => m.id.startsWith("generic-model:"));
    expect(entry).toBeDefined();
    expect(entry!.capabilities ?? []).not.toContain("thinking");
    expect(entry!.supported_parameters ?? []).toEqual([]);
  });

  it("every reasoning-capable entry names both normalized field names", async () => {
    const data = await listModels();
    for (const id of ["vllm-model:", "omlx-model:"]) {
      const entry = data.data.find((m) => m.id.startsWith(id));
      expect(entry!.haai?.reasoning?.["normalized_fields"]).toEqual(["reasoning", "reasoning_content"]);
    }
  });
});
