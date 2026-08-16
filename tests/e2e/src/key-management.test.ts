import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { generateApiKey, apiKeys, backends as backendsTable, tokenBudgetCounters } from "@ai-v-models/core";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function insertBackend(proxy: TestProxy, mockUrl: string): Promise<string> {
  const id = `backend-${nanoid(8)}`;
  const now = Date.now();
  proxy.db.db.insert(backendsTable).values({
    id, name: `backend-${id}`, displayName: "Test", hostName: "test",
    provider: "generic", baseUrl: mockUrl, keyMode: "passthrough",
    encryptedApiKey: null, enabled: true, weight: 1, maxConcurrency: 10,
    healthCheckEnabled: false,
    availableModels: JSON.stringify(["test-model"]),
    createdAt: now, updatedAt: now,
  }).run();
  return id;
}

async function insertKey(
  proxy: TestProxy,
  overrides: Partial<typeof apiKeys.$inferInsert> = {},
): Promise<string> {
  const { key, prefix } = generateApiKey();
  const now = Date.now();
  proxy.db.db.insert(apiKeys).values({
    id: `key-${nanoid(8)}`, prefix, keyHash: hashKey(key), name: "test",
    enabled: true, suspended: false, suspendedReason: null, expiresAt: null,
    allowedModels: null, allowToolCalling: true, allowVision: false,
    allowEmbeddings: false, rateLimitRpm: null, tokenBudgetHour: null,
    tokenBudgetDay: null, tokenBudgetWeek: null, tokenBudgetMonth: null,
    logRequests: true, createdAt: now, updatedAt: now,
    ...overrides,
  }).run();
  return key;
}

describe("Key management", () => {
  let mock: StartedMockServer;
  let proxy: TestProxy;
  let backendId: string;

  beforeAll(async () => {
    mock = await startMockServer({ models: [{ id: "test-model" }], hostName: "test", provider: "generic" });
    proxy = await startTestProxy();
    backendId = await insertBackend(proxy, mock.url);
  });

  afterAll(async () => {
    await mock.stop();
    await proxy.stop();
  });

  const modelId = "test-model:test:generic";

  it("should reject disabled key", async () => {
    const key = await insertKey(proxy, { enabled: false });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("should reject suspended key", async () => {
    const key = await insertKey(proxy, { suspended: true, suspendedReason: "test" });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("should reject expired key", async () => {
    const key = await insertKey(proxy, { expiresAt: Date.now() - 1000 });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("should reject key with v-model restriction and no pass-through backends", async () => {
    const key = await insertKey(proxy, {
      allowedModels: JSON.stringify(["other-model"]),
      allowedBackends: JSON.stringify([]),
    });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("should reject when token budget exceeded", async () => {
    const { key, prefix } = generateApiKey();
    const keyId = `key-${nanoid(8)}`;
    const now = Date.now();

    proxy.db.db.insert(apiKeys).values({
      id: keyId, prefix, keyHash: hashKey(key), name: "budget-test",
      enabled: true, suspended: false, suspendedReason: null, expiresAt: null,
      allowedModels: null, allowToolCalling: true, allowVision: false,
      allowEmbeddings: false, rateLimitRpm: null, tokenBudgetHour: 1, // tiny budget
      tokenBudgetDay: null, tokenBudgetWeek: null, tokenBudgetMonth: null,
      logRequests: false, createdAt: now, updatedAt: now,
    }).run();

    // Manually set the counter to exceed budget
    const hourBucket = new Date();
    hourBucket.setMinutes(0, 0, 0);
    proxy.db.db.insert(tokenBudgetCounters).values({
      id: `tbc-${keyId}-hour-${hourBucket.toISOString()}`,
      keyId, period: "hour", bucket: hourBucket.toISOString(),
      tokensUsed: 100, updatedAt: now,
    }).run();

    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
  });

  it("should allow valid key with pass-through backend access", async () => {
    const key = await insertKey(proxy, { allowedBackends: JSON.stringify([backendId]) });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
  });
});
