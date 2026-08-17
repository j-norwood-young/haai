import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { recomputeAllVModelHealth } from "@haai/proxy/vmodel-health";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import {
  insertBackend,
  insertVModel,
  insertKey,
  setBackendHealth,
  listModelIds,
  chatCompletion,
  adminJson,
} from "./helpers/seed.js";

const ALIAS = "haai-chat";
const UPSTREAM = "test-model";

describe("v-model health states", () => {
  let healthyMock: StartedMockServer;
  let downMock: StartedMockServer;
  let proxy: TestProxy;
  let healthyBackendId: string;
  let downBackendId: string;
  let vmodelId: string;
  let apiKey: string;

  beforeAll(async () => {
    healthyMock = await startMockServer({
      hostName: "healthy-host",
      provider: "generic",
      models: [{ id: UPSTREAM }],
    });
    downMock = await startMockServer({
      hostName: "down-host",
      provider: "generic",
      models: [{ id: UPSTREAM }],
      fault: { alwaysDown: true },
    });
    proxy = await startTestProxy();

    healthyBackendId = await insertBackend(proxy, {
      name: "healthy-backend",
      hostName: "healthy-host",
      baseUrl: healthyMock.url,
      availableModels: [UPSTREAM],
      lastHealthStatus: "healthy",
    });
    downBackendId = await insertBackend(proxy, {
      name: "down-backend",
      hostName: "down-host",
      baseUrl: downMock.url,
      lastHealthStatus: "unhealthy",
    });
    vmodelId = await insertVModel(proxy, {
      modelId: ALIAS,
      displayName: "HAAI Chat",
      backends: [
        { backendId: healthyBackendId, backendModelId: UPSTREAM },
        { backendId: downBackendId, backendModelId: UPSTREAM },
      ],
    });
    const inserted = await insertKey(proxy, { name: "health-states" });
    apiKey = inserted.key;
    await recomputeAllVModelHealth(proxy.db);
  });

  afterAll(async () => {
    await proxy.stop();
    await healthyMock.stop();
    await downMock.stop();
  });

  async function applyState(state: "up" | "degraded" | "down"): Promise<void> {
    if (state === "up") {
      setBackendHealth(proxy, healthyBackendId, { status: "healthy", models: [UPSTREAM] });
      setBackendHealth(proxy, downBackendId, { status: "healthy", models: [UPSTREAM] });
    } else if (state === "degraded") {
      setBackendHealth(proxy, healthyBackendId, { status: "healthy", models: [UPSTREAM] });
      setBackendHealth(proxy, downBackendId, { status: "unhealthy", models: null });
    } else {
      setBackendHealth(proxy, healthyBackendId, { status: "unhealthy", models: null });
      setBackendHealth(proxy, downBackendId, { status: "unhealthy", models: null });
    }
    await recomputeAllVModelHealth(proxy.db);
  }

  it("lists and serves the alias when all mappings are up", async () => {
    await applyState("up");
    const ids = await listModelIds(proxy.url, apiKey);
    expect(ids).toContain(ALIAS);

    const res = await chatCompletion(proxy.url, apiKey, ALIAS);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("[DONE]");
  });

  it("lists and serves the alias when degraded (one mapping left)", async () => {
    await applyState("degraded");
    const ids = await listModelIds(proxy.url, apiKey);
    expect(ids).toContain(ALIAS);

    const res = await chatCompletion(proxy.url, apiKey, ALIAS);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("[DONE]");
  });

  it("lists the alias when down but chat returns 503", async () => {
    await applyState("down");
    const ids = await listModelIds(proxy.url, apiKey);
    expect(ids).toContain(ALIAS);

    const res = await chatCompletion(proxy.url, apiKey, ALIAS);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain(ALIAS);
    expect(body.error.message.toLowerCase()).not.toContain("not found");
  });

  it("lists the alias for keys with no passthroughs (alias, internal id, or unrestricted)", async () => {
    await applyState("up");

    const byAlias = await insertKey(proxy, {
      name: "alias-only",
      allowedModels: JSON.stringify([ALIAS]),
      allowedBackends: JSON.stringify([]),
    });
    expect(await listModelIds(proxy.url, byAlias.key)).toContain(ALIAS);
    expect((await chatCompletion(proxy.url, byAlias.key, ALIAS)).status).toBe(200);

    const byInternal = await insertKey(proxy, {
      name: "internal-id-only",
      allowedModels: JSON.stringify([vmodelId]),
      allowedBackends: JSON.stringify([]),
    });
    expect(await listModelIds(proxy.url, byInternal.key)).toContain(ALIAS);
    expect((await chatCompletion(proxy.url, byInternal.key, ALIAS)).status).toBe(200);

    const unrestricted = await insertKey(proxy, {
      name: "unrestricted-no-passthrough",
      allowedModels: null,
      allowedBackends: JSON.stringify([]),
    });
    expect(await listModelIds(proxy.url, unrestricted.key)).toContain(ALIAS);
    expect((await chatCompletion(proxy.url, unrestricted.key, ALIAS)).status).toBe(200);
  });

  it("rejects creating a key with no v-models and no passthroughs", async () => {
    const res = await adminJson(proxy, "POST", "/api/v1/keys", {
      name: "empty-access",
      allowedModels: [],
      allowedBackends: [],
    });
    expect(res.status).toBe(400);
  });
});
