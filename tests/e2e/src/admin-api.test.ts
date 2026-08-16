import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { apiKeys, backends as backendsTable, generateApiKey } from "@haai/core";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

describe("admin API body-less JSON requests", () => {
  let proxy: TestProxy;
  let mock: StartedMockServer;
  let backendId: string;

  beforeAll(async () => {
    mock = await startMockServer({
      hostName: "empty-body-host",
      provider: "generic",
      models: [{ id: "test-model" }],
    });

    proxy = await startTestProxy();
    const now = Date.now();
    backendId = `backend-${nanoid(8)}`;

    proxy.db.db.insert(backendsTable).values({
      id: backendId,
      name: "empty-body-backend",
      displayName: "Empty Body Backend",
      hostName: "empty-body-host",
      provider: "generic",
      baseUrl: mock.url,
      keyMode: "passthrough",
      encryptedApiKey: null,
      enabled: true,
      weight: 1,
      maxConcurrency: 10,
      healthCheckEnabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  afterAll(async () => {
    await proxy.stop();
    await mock.stop();
  });

  async function postWithEmptyJsonBody(path: string): Promise<Response> {
    return fetch(`${proxy.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxy.adminToken}`,
      },
    });
  }

  it("accepts POST /api/v1/auth/logout with Content-Type but no body", async () => {
    const res = await postWithEmptyJsonBody("/api/v1/auth/logout");
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });

  it("accepts POST /api/v1/backends/:id/test with Content-Type but no body", async () => {
    const res = await postWithEmptyJsonBody(`/api/v1/backends/${backendId}/test`);
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("accepts POST /api/v1/keys/:id/resume with Content-Type but no body", async () => {
    const now = Date.now();
    const keyId = `key-${nanoid(8)}`;
    proxy.db.db.insert(apiKeys).values({
      id: keyId,
      prefix: "test",
      keyHash: hashKey("sk-test"),
      name: "test-key",
      enabled: true,
      suspended: true,
      suspendedReason: "test",
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

    const res = await postWithEmptyJsonBody(`/api/v1/keys/${keyId}/resume`);
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });

  it("accepts POST with Content-Type and charset but no body", async () => {
    const res = await fetch(`${proxy.url}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});
