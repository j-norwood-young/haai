import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { nanoid } from "nanoid";
import { generateApiKey, hashToken, encrypt } from "@ai-v-models/core";
import { backends as backendsTable, apiKeys, vmodels, vmodelBackends } from "@ai-v-models/core";
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
        Authorization: "Bearer aivm-sk-invalid-key-xyz",
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
});
