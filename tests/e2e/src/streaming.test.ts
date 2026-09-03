import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { nanoid } from "nanoid";
import { generateApiKey, hashToken, encrypt } from "@haai/core";
import { backends as backendsTable, apiKeys, vmodels, vmodelBackends } from "@haai/core";
import { createHash } from "node:crypto";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

describe("Streaming proxy", () => {
  let mock: StartedMockServer;
  let proxy: TestProxy;
  let apiKey: string;
  let backendId: string;

  beforeAll(async () => {
    mock = await startMockServer({
      hostName: "test-host",
      provider: "generic",
      models: [{ id: "test-model" }],
    });

    proxy = await startTestProxy();

    // Insert backend
    backendId = `backend-${nanoid(8)}`;
    const now = Date.now();
    proxy.db.db.insert(backendsTable).values({
      id: backendId,
      name: "test-backend",
      displayName: "Test Backend",
      hostName: "test-host",
      provider: "generic",
      baseUrl: mock.url,
      keyMode: "passthrough",
      encryptedApiKey: null,
      enabled: true,
      weight: 1,
      maxConcurrency: 10,
      healthCheckEnabled: false,
      availableModels: JSON.stringify(["test-model"]),
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create API key
    const { key, prefix } = generateApiKey();
    apiKey = key;
    const keyHash = hashKey(key);

    proxy.db.db.insert(apiKeys).values({
      id: `key-${nanoid(8)}`,
      prefix,
      keyHash,
      name: "test-key",
      enabled: true,
      suspended: false,
      suspendedReason: null,
      expiresAt: null,
      allowedModels: null,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: true,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
      logRequests: true,
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  afterAll(async () => {
    await mock.stop();
    await proxy.stop();
  });

  it("should return 401 for /v1/models without auth", async () => {
    const res = await fetch(`${proxy.url}/v1/models`);
    expect(res.status).toBe(401);
  });

  it("should return models from /v1/models including namespaced backend models", async () => {
    const res = await fetch(`${proxy.url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { data: Array<{ id: string }> };
    expect(data.data).toBeDefined();
    // The mock backend's model should appear namespaced
    const modelIds = data.data.map((m) => m.id);
    expect(modelIds.some((id) => id.includes("test-host"))).toBe(true);
    expect(modelIds.some((id) => id.includes("test-model"))).toBe(true);
  });

  it("should stream a chat completion", async () => {
    const modelId = `test-model:test-host:generic`;
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
  });

  it("should return 401 for missing key", async () => {
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model:test-host:generic",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 401 for invalid key", async () => {
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer haai-sk-invalid-key-xyz",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model:test-host:generic",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 404 for unknown model", async () => {
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nonexistent-model:nowhere:provider",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(res.status).toBe(404);
  });

  it("should health check endpoint", async () => {
    const res = await fetch(`${proxy.url}/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as { status: string };
    expect(data.status).toBe("ok");
  });
});

describe("V-model routing", () => {
  let mock: StartedMockServer;
  let proxy: TestProxy;
  let apiKey: string;
  let backendId: string;
  let vmodelId: string;

  beforeAll(async () => {
    mock = await startMockServer({
      hostName: "vmodel-host",
      provider: "generic",
      models: [{ id: "underlying-model" }],
    });

    proxy = await startTestProxy();
    const now = Date.now();

    backendId = `backend-${nanoid(8)}`;
    proxy.db.db.insert(backendsTable).values({
      id: backendId,
      name: "vmodel-backend",
      displayName: "VModel Backend",
      hostName: "vmodel-host",
      provider: "generic",
      baseUrl: mock.url,
      keyMode: "passthrough",
      encryptedApiKey: null,
      enabled: true,
      weight: 1,
      maxConcurrency: 10,
      healthCheckEnabled: false,
      availableModels: JSON.stringify(["underlying-model"]),
      createdAt: now,
      updatedAt: now,
    }).run();

    vmodelId = `vmodel-${nanoid(8)}`;
    proxy.db.db.insert(vmodels).values({
      id: vmodelId,
      modelId: "smart-chat",
      displayName: "Smart Chat",
      description: null,
      balancingStrategy: "session-pin",
      streaming: true,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();

    proxy.db.db.insert(vmodelBackends).values({
      id: `vmb-${nanoid(8)}`,
      vmodelId,
      backendId,
      backendModelId: "underlying-model",
      weight: 1,
      enabled: true,
      createdAt: now,
    }).run();

    const { key, prefix } = generateApiKey();
    apiKey = key;
    proxy.db.db.insert(apiKeys).values({
      id: `key-${nanoid(8)}`,
      prefix,
      keyHash: hashKey(key),
      name: "vmodel-test-key",
      enabled: true,
      suspended: false,
      suspendedReason: null,
      expiresAt: null,
      allowedModels: null,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: false,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
      logRequests: true,
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  afterAll(async () => {
    await mock.stop();
    await proxy.stop();
  });

  it("should route via v-model alias", async () => {
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "smart-chat",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("[DONE]");
  });

  it("should include v-model in /v1/models list", async () => {
    const res = await fetch(`${proxy.url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { data: Array<{ id: string }> };
    const modelIds = data.data.map((m) => m.id);
    expect(modelIds).toContain("smart-chat");
  });

  it("should emit request-start/request-end SSE events around a streaming request", async () => {
    const controller = new AbortController();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const collector = (async () => {
      const res = await fetch(`${proxy.url}/api/v1/events`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let type = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7).trim();
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (data) {
            try {
              events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
            } catch {
              // ignore malformed
            }
          }
        }
      }
    })().catch(() => {});

    // Give the SSE connection time to register
    await new Promise((r) => setTimeout(r, 200));

    const chatRes = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "smart-chat",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });
    expect(chatRes.status).toBe(200);
    await chatRes.text();

    // Wait briefly for SSE events to land
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const start = events.find((e) => e.type === "request-start");
      const end = events.find((e) => e.type === "request-end");
      if (start && end) {
        expect(end.data["id"]).toBe(start.data["id"]);
        expect(end.data["statusCode"]).toBe(200);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    controller.abort();
    await collector;

    const liveRes = await fetch(`${proxy.url}/api/v1/metrics/live`, {
      headers: { Authorization: `Bearer ${proxy.adminToken}` },
    });
    const live = (await liveRes.json()) as { inFlight: unknown[]; inFlightTotal: number };
    expect(live.inFlight).toEqual([]);
    expect(live.inFlightTotal).toBe(0);
  });
});
