import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  usageEvents as usageEventsTable,
  vmodelBackends as vmodelBackendsTable,
} from "@haai/core";
import { recomputeAllVModelHealth } from "@haai/proxy/vmodel-health";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startRecordingUpstream, type StartedRecordingUpstream } from "./helpers/recording-upstream.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import {
  insertBackend,
  insertVModel,
  insertKey,
  chatCompletion,
  embeddingsRequest,
} from "./helpers/seed.js";

describe("embeddings routing and kind enforcement", () => {
  let proxy: TestProxy;
  let mock1: StartedMockServer;
  let mock2: StartedMockServer;
  let backend1: string;
  let backend2: string;
  let embedVModelAlias: string;
  let chatVModelAlias: string;
  let apiKey: string;

  beforeAll(async () => {
    proxy = await startTestProxy();

    mock1 = await startMockServer({
      hostName: "embed-host-1",
      provider: "lmstudio",
      models: [
        { id: "qwen3-8b", kind: "llm" },
        { id: "text-embed-nomic", kind: "embeddings" },
      ],
    });
    mock2 = await startMockServer({
      hostName: "embed-host-2",
      provider: "lmstudio",
      models: [{ id: "text-embed-nomic-2", kind: "embeddings" }],
    });

    backend1 = await insertBackend(proxy, {
      name: "embed-backend-1",
      hostName: mock1.config.hostName,
      baseUrl: mock1.url,
      provider: "lmstudio",
      availableModels: ["qwen3-8b", "text-embed-nomic"],
      modelCatalog: [
        { id: "qwen3-8b", kind: "llm", source: "native" },
        { id: "text-embed-nomic", kind: "embeddings", source: "native" },
      ],
      lastHealthStatus: "healthy",
    });
    backend2 = await insertBackend(proxy, {
      name: "embed-backend-2",
      hostName: mock2.config.hostName,
      baseUrl: mock2.url,
      provider: "lmstudio",
      availableModels: ["text-embed-nomic-2"],
      modelCatalog: [{ id: "text-embed-nomic-2", kind: "embeddings", source: "native" }],
      lastHealthStatus: "healthy",
    });

    embedVModelAlias = "my-embed-alias";
    await insertVModel(proxy, {
      modelId: embedVModelAlias,
      kind: "embedding",
      backends: [{ backendId: backend1, backendModelId: "text-embed-nomic" }],
    });

    chatVModelAlias = "my-chat-alias";
    await insertVModel(proxy, {
      modelId: chatVModelAlias,
      kind: "chat",
      backends: [{ backendId: backend1, backendModelId: "qwen3-8b" }],
    });

    const { key } = await insertKey(proxy, {
      allowedModels: null,
      allowedBackends: null,
      allowEmbeddings: true,
    });
    apiKey = key;
  });

  afterAll(async () => {
    await proxy.stop();
    await mock1.stop();
    await mock2.stop();
  });

  describe("kind guard — the reported bug", () => {
    it("rejects chat on an embedding v-model alias with 400 model_not_supported", async () => {
      const res = await chatCompletion(proxy.url, apiKey, embedVModelAlias);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code?: string; message: string } };
      expect(body.error.code).toBe("model_not_supported");
    });

    it("rejects chat on a namespaced pass-through embedding id with 400", async () => {
      const namespacedId = `text-embed-nomic:${mock1.config.hostName}:lmstudio`;
      const res = await chatCompletion(proxy.url, apiKey, namespacedId);
      expect(res.status).toBe(400);
    });

    it("never forwards a chat request for an embedding model to any upstream", async () => {
      const recording: StartedRecordingUpstream = await startRecordingUpstream({
        models: ["should-never-be-called"],
      });
      try {
        const backendId = await insertBackend(proxy, {
          name: "recording-embed-backend",
          hostName: "recording-embed-host",
          baseUrl: recording.url,
          provider: "generic",
          availableModels: ["some-embed-model"],
          modelCatalog: [{ id: "some-embed-model", kind: "embeddings", source: "heuristic" }],
          lastHealthStatus: "healthy",
        });
        await insertVModel(proxy, {
          modelId: "recording-embed-alias",
          kind: "embedding",
          backends: [{ backendId, backendModelId: "some-embed-model" }],
        });

        const res = await chatCompletion(proxy.url, apiKey, "recording-embed-alias");
        expect(res.status).toBe(400);
        expect(recording.received).toHaveLength(0);
      } finally {
        await recording.stop();
      }
    });

    it("rejects embeddings on a chat v-model alias with 400", async () => {
      const res = await embeddingsRequest(proxy.url, apiKey, chatVModelAlias);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code?: string; message: string } };
      expect(body.error.code).toBe("model_not_supported");
    });
  });

  describe("bad pre-existing row (kind mismatch introduced outside the API)", () => {
    it("marks the mapping unavailable and the chat alias returns 503", async () => {
      const badAlias = "legacy-chat-with-embed-member";
      const vmodelId = await insertVModel(proxy, { modelId: badAlias, kind: "chat" });
      // Bypass the admin API's validation entirely — simulate a row that predates this feature.
      const mappingId = `vmb-${nanoid(8)}`;
      proxy.db.db
        .insert(vmodelBackendsTable)
        .values({
          id: mappingId,
          vmodelId,
          backendId: backend1,
          backendModelId: "text-embed-nomic",
          weight: 1,
          enabled: true,
          createdAt: Date.now(),
        })
        .run();

      await recomputeAllVModelHealth(proxy.db);

      // resolveModelRoute's Guard B already drops the mismatched member at
      // resolution time (400), before ever reaching the health-derived 503 path.
      const res = await chatCompletion(proxy.url, apiKey, badAlias);
      expect(res.status).toBe(400);

      const mapping = await proxy.db.db
        .select()
        .from(vmodelBackendsTable)
        .where(eq(vmodelBackendsTable.id, mappingId))
        .get();
      expect(mapping?.unavailableReason).toBe("model_kind_mismatch");
      expect(mapping?.lastAvailable).toBe(false);
    });
  });

  describe("embedding v-models work end to end (new capability)", () => {
    it("serves an embedding v-model alias", async () => {
      const res = await embeddingsRequest(proxy.url, apiKey, embedVModelAlias);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
      expect(body.data[0]?.embedding.length).toBeGreaterThan(0);
    });

    it("serves a pass-through namespaced embedding id", async () => {
      const namespacedId = `text-embed-nomic:${mock1.config.hostName}:lmstudio`;
      const res = await embeddingsRequest(proxy.url, apiKey, namespacedId);
      expect(res.status).toBe(200);
    });

    it("records a usage_events row with endpoint /v1/embeddings and nonzero prompt tokens", async () => {
      const before = Date.now();
      const res = await embeddingsRequest(proxy.url, apiKey, embedVModelAlias, "hello world");
      expect(res.status).toBe(200);

      const rows = await proxy.db.db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.endpoint, "/v1/embeddings"))
        .all();
      const recent = rows.filter((r) => r.timestamp >= before);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent[recent.length - 1]?.promptTokens).toBeGreaterThan(0);
    });
  });

  describe("failover across embedding v-model members", () => {
    it("fails over to the second member when the first errors", async () => {
      // Force this backend's mock to always fail at the HTTP layer while the DB still
      // reports it healthy — exercising the retry/failover loop, not the health poll.
      const failingMock = await startMockServer({
        hostName: "embed-host-1-failing",
        provider: "lmstudio",
        models: [{ id: "text-embed-nomic", kind: "embeddings" }],
        fault: { alwaysDown: true },
      });
      const failingBackendId = await insertBackend(proxy, {
        name: "embed-backend-1-failing",
        hostName: failingMock.config.hostName,
        baseUrl: failingMock.url,
        provider: "lmstudio",
        availableModels: ["text-embed-nomic"],
        modelCatalog: [{ id: "text-embed-nomic", kind: "embeddings", source: "native" }],
        lastHealthStatus: "healthy",
      });

      try {
        const failoverAlias = "failover-embed-alias";
        await insertVModel(proxy, {
          modelId: failoverAlias,
          kind: "embedding",
          // round-robin with a fresh counter always tries index 0 first, making
          // which member fails first (and thus that failover actually happens)
          // deterministic instead of depending on session-pin's key hash.
          balancingStrategy: "round-robin",
          backends: [
            { backendId: failingBackendId, backendModelId: "text-embed-nomic" },
            { backendId: backend2, backendModelId: "text-embed-nomic-2" },
          ],
        });

        const before = Date.now();
        const res = await embeddingsRequest(proxy.url, apiKey, failoverAlias);
        expect(res.status).toBe(200);

        const rows = await proxy.db.db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.endpoint, "/v1/embeddings"))
          .all();
        const recent = rows.filter((r) => r.timestamp >= before);
        // One failing attempt against the down backend, one successful attempt against the healthy one.
        expect(recent.some((r) => r.statusCode >= 500)).toBe(true);
        expect(recent.some((r) => r.statusCode === 200)).toBe(true);
      } finally {
        await failingMock.stop();
      }
    });

    it("returns 503 when every member is down", async () => {
      const allDownMock = await startMockServer({
        hostName: "embed-all-down",
        provider: "lmstudio",
        models: [{ id: "text-embed-down", kind: "embeddings" }],
        fault: { alwaysDown: true },
      });
      try {
        const downBackendId = await insertBackend(proxy, {
          name: "embed-all-down-backend",
          hostName: allDownMock.config.hostName,
          baseUrl: allDownMock.url,
          provider: "lmstudio",
          availableModels: ["text-embed-down"],
          modelCatalog: [{ id: "text-embed-down", kind: "embeddings", source: "native" }],
          lastHealthStatus: "healthy",
        });
        const alias = "all-down-embed-alias";
        await insertVModel(proxy, {
          modelId: alias,
          kind: "embedding",
          backends: [{ backendId: downBackendId, backendModelId: "text-embed-down" }],
        });

        const res = await embeddingsRequest(proxy.url, apiKey, alias);
        expect(res.status).toBe(503);
      } finally {
        await allDownMock.stop();
      }
    });
  });

  describe("key scope enforcement", () => {
    it("rejects an embedding request when the key has allowEmbeddings:false", async () => {
      const { key: restrictedKey } = await insertKey(proxy, {
        allowedModels: null,
        allowedBackends: null,
        allowEmbeddings: false,
      });

      const aliasRes = await embeddingsRequest(proxy.url, restrictedKey, embedVModelAlias);
      expect(aliasRes.status).toBe(403);

      const namespacedId = `text-embed-nomic:${mock1.config.hostName}:lmstudio`;
      const passthroughRes = await embeddingsRequest(proxy.url, restrictedKey, namespacedId);
      expect(passthroughRes.status).toBe(403);
    });

    it("rejects an embedding v-model not in the key's allowedModels", async () => {
      const { key: scopedKey } = await insertKey(proxy, {
        allowedModels: JSON.stringify(["some-other-alias"]),
        allowedBackends: null,
        allowEmbeddings: true,
      });

      const res = await embeddingsRequest(proxy.url, scopedKey, embedVModelAlias);
      expect(res.status).toBe(403);
    });
  });
});
