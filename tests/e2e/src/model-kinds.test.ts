import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { checkAndPersistBackendHealth } from "@haai/proxy/health";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertBackend, insertVModel, insertKey, adminJson } from "./helpers/seed.js";
import { backends as backendsTable } from "@haai/core";
import { eq } from "drizzle-orm";

interface ModelListEntry {
  id: string;
  type?: string;
}

async function getModels(proxyUrl: string, apiKey: string): Promise<ModelListEntry[]> {
  const res = await fetch(`${proxyUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { data: ModelListEntry[] };
  return data.data;
}

describe("model kind classification", () => {
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    proxy = await startTestProxy();
    const { key } = await insertKey(proxy, { allowedModels: null, allowedBackends: null });
    apiKey = key;
  });

  afterAll(async () => proxy.stop());

  describe("GET /v1/models — type field", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({
        hostName: "lmstudio-host",
        provider: "lmstudio",
        models: [
          { id: "qwen3-8b", kind: "llm" },
          { id: "text-embed-nomic", kind: "embeddings" },
          { id: "vision-model", kind: "vlm" },
        ],
      });
      await insertBackend(proxy, {
        name: "lmstudio-backend",
        hostName: mock.config.hostName,
        baseUrl: mock.url,
        provider: "lmstudio",
        availableModels: ["qwen3-8b", "text-embed-nomic", "vision-model"],
        modelCatalog: [
          { id: "qwen3-8b", kind: "llm", source: "native" },
          { id: "text-embed-nomic", kind: "embeddings", source: "native" },
          { id: "vision-model", kind: "vlm", source: "native" },
        ],
      });
    });

    afterAll(async () => mock.stop());

    it("reports each model's native kind", async () => {
      const models = await getModels(proxy.url, apiKey);
      const byId = new Map(
        models
          .filter((m) => m.id.startsWith("qwen3-8b:") || m.id.startsWith("text-embed-nomic:") || m.id.startsWith("vision-model:"))
          .map((m) => [m.id.split(":")[0], m.type]),
      );
      expect(byId.get("qwen3-8b")).toBe("llm");
      expect(byId.get("text-embed-nomic")).toBe("embeddings");
      expect(byId.get("vision-model")).toBe("vlm");
    });

    it("never emits 'unknown' on the wire", async () => {
      const models = await getModels(proxy.url, apiKey);
      expect(models.every((m) => m.type !== "unknown")).toBe(true);
    });
  });

  describe("generic backend — heuristic fallback", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({
        hostName: "generic-host",
        provider: "generic",
        models: [{ id: "mock-model-1" }, { id: "bge-m3" }],
      });
      await insertBackend(proxy, {
        name: "generic-backend",
        hostName: mock.config.hostName,
        baseUrl: mock.url,
        provider: "generic",
        availableModels: ["mock-model-1", "bge-m3"],
        // No modelCatalog seeded — classification falls back to the id heuristic.
      });
    });

    afterAll(async () => mock.stop());

    it("classifies an ordinary-looking id as llm", async () => {
      const models = await getModels(proxy.url, apiKey);
      const entry = models.find((m) => m.id.startsWith("mock-model-1:"));
      expect(entry?.type).toBe("llm");
    });

    it("classifies an embedding-looking id as embeddings via the name heuristic", async () => {
      const models = await getModels(proxy.url, apiKey);
      const entry = models.find((m) => m.id.startsWith("bge-m3:"));
      expect(entry?.type).toBe("embeddings");
    });
  });

  describe("v-model kind", () => {
    it("reports 'llm' for a chat v-model and 'embeddings' for an embedding v-model", async () => {
      await insertVModel(proxy, { modelId: "my-chat-alias", kind: "chat" });
      await insertVModel(proxy, { modelId: "my-embed-alias", kind: "embedding" });

      const models = await getModels(proxy.url, apiKey);
      expect(models.find((m) => m.id === "my-chat-alias")?.type).toBe("llm");
      expect(models.find((m) => m.id === "my-embed-alias")?.type).toBe("embeddings");
    });
  });

  describe("health poll integration", () => {
    it("persists a native model catalog from an LM Studio probe, and available_models stays a plain string[]", async () => {
      const mock = await startMockServer({
        hostName: "poll-lmstudio",
        provider: "lmstudio",
        models: [
          { id: "chat-model", kind: "llm" },
          { id: "embed-model", kind: "embeddings" },
        ],
      });
      try {
        const backendId = await insertBackend(proxy, {
          name: "poll-lmstudio-backend",
          hostName: mock.config.hostName,
          baseUrl: mock.url,
          provider: "lmstudio",
        });

        await checkAndPersistBackendHealth(
          proxy.db,
          proxy.masterKey,
          {
            id: backendId,
            baseUrl: mock.url,
            name: "poll-lmstudio-backend",
            provider: "lmstudio",
            keyMode: "passthrough",
            encryptedApiKey: null,
          },
          5000,
        );

        const row = await proxy.db.db
          .select()
          .from(backendsTable)
          .where(eq(backendsTable.id, backendId))
          .get();

        expect(row?.lastHealthStatus).toBe("healthy");
        const availableModels = JSON.parse(row?.availableModels ?? "[]") as string[];
        expect(new Set(availableModels)).toEqual(new Set(["chat-model", "embed-model"]));

        const catalog = JSON.parse(row?.modelCatalog ?? "[]") as Array<{
          id: string;
          kind: string;
          source: string;
        }>;
        const byId = new Map(catalog.map((e) => [e.id, e]));
        expect(byId.get("chat-model")).toMatchObject({ kind: "llm", source: "native" });
        expect(byId.get("embed-model")).toMatchObject({ kind: "embeddings", source: "native" });
      } finally {
        await mock.stop();
      }
    });

    it("tolerates a backend with no probe endpoint (generic provider) without affecting health", async () => {
      const mock = await startMockServer({
        hostName: "poll-generic",
        provider: "generic",
        models: [{ id: "mock-model-1" }],
      });
      try {
        const backendId = await insertBackend(proxy, {
          name: "poll-generic-backend",
          hostName: mock.config.hostName,
          baseUrl: mock.url,
          provider: "generic",
        });

        const result = await checkAndPersistBackendHealth(
          proxy.db,
          proxy.masterKey,
          {
            id: backendId,
            baseUrl: mock.url,
            name: "poll-generic-backend",
            provider: "generic",
            keyMode: "passthrough",
            encryptedApiKey: null,
          },
          5000,
        );

        expect(result.status).toBe("healthy");
        expect(result.latencyMs).toBeLessThan(2000);

        const row = await proxy.db.db
          .select()
          .from(backendsTable)
          .where(eq(backendsTable.id, backendId))
          .get();
        const catalog = JSON.parse(row?.modelCatalog ?? "[]") as Array<{ id: string; source: string }>;
        expect(catalog.find((e) => e.id === "mock-model-1")?.source).toBe("heuristic");
      } finally {
        await mock.stop();
      }
    });

    it("classifies an Ollama embedding model from /api/show", async () => {
      const mock = await startMockServer({
        hostName: "poll-ollama",
        provider: "ollama",
        models: [{ id: "nomic-embed-text:latest", kind: "embeddings" }],
      });
      try {
        const backendId = await insertBackend(proxy, {
          name: "poll-ollama-backend",
          hostName: mock.config.hostName,
          baseUrl: mock.url,
          provider: "ollama",
        });

        await checkAndPersistBackendHealth(
          proxy.db,
          proxy.masterKey,
          {
            id: backendId,
            baseUrl: mock.url,
            name: "poll-ollama-backend",
            provider: "ollama",
            keyMode: "passthrough",
            encryptedApiKey: null,
          },
          5000,
        );

        const row = await proxy.db.db
          .select()
          .from(backendsTable)
          .where(eq(backendsTable.id, backendId))
          .get();
        const catalog = JSON.parse(row?.modelCatalog ?? "[]") as Array<{
          id: string;
          kind: string;
          source: string;
        }>;
        expect(catalog.find((e) => e.id === "nomic-embed-text:latest")).toMatchObject({
          kind: "embeddings",
          source: "native",
        });
      } finally {
        await mock.stop();
      }
    });
  });

  describe("GET /api/v1/available-models", () => {
    it("exposes modelKind alongside the unchanged backend-model/vmodel type", async () => {
      const mock = await startMockServer({
        hostName: "avail-host",
        provider: "lmstudio",
        models: [{ id: "avail-embed", kind: "embeddings" }],
      });
      try {
        await insertBackend(proxy, {
          name: "avail-backend",
          hostName: mock.config.hostName,
          baseUrl: mock.url,
          provider: "lmstudio",
          modelCatalog: [{ id: "avail-embed", kind: "embeddings", source: "native" }],
        });
        await insertVModel(proxy, { modelId: "avail-vmodel-embed", kind: "embedding" });

        const res = await adminJson(proxy, "GET", "/api/v1/available-models");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          models: Array<{ id: string; type: string; modelKind: string }>;
        };

        const backendEntry = body.models.find((m) => m.id.startsWith("avail-embed:"));
        expect(backendEntry).toMatchObject({ type: "backend-model", modelKind: "embeddings" });

        const vmodelEntry = body.models.find((m) => m.id === "avail-vmodel-embed");
        expect(vmodelEntry).toMatchObject({ type: "vmodel", modelKind: "embeddings" });
      } finally {
        await mock.stop();
      }
    });
  });
});
