import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import { backends as backendsTable, serializeModelCatalog } from "@haai/core";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertKey, listModelIds, adminJson } from "./helpers/seed.js";

describe("admin backend and v-model CRUD", () => {
  let mock: StartedMockServer;
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    mock = await startMockServer({
      hostName: "crud-host",
      provider: "generic",
      models: [{ id: "crud-model" }],
    });
    proxy = await startTestProxy();
    const inserted = await insertKey(proxy, { name: "crud-list" });
    apiKey = inserted.key;
  });

  afterAll(async () => {
    await proxy.stop();
    await mock.stop();
  });

  it("creates, updates, and deletes a backend", async () => {
    const created = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "crud-backend",
      displayName: "CRUD Backend",
      hostName: "crud-host",
      provider: "generic",
      baseUrl: mock.url,
    });
    expect(created.status).toBe(201);
    const backend = (await created.json()) as { id: string; name: string; displayName: string };
    expect(backend.id).toMatch(/^backend-/);

    const patched = await adminJson(proxy, "PATCH", `/api/v1/backends/${backend.id}`, {
      displayName: "CRUD Backend Renamed",
    });
    expect(patched.status).toBe(200);

    const listed = await adminJson(proxy, "GET", "/api/v1/backends");
    expect(listed.status).toBe(200);
    const backends = (await listed.json()) as Array<{ id: string; displayName: string }>;
    expect(backends.find((b) => b.id === backend.id)?.displayName).toBe("CRUD Backend Renamed");

    const deleted = await adminJson(proxy, "DELETE", `/api/v1/backends/${backend.id}`);
    expect(deleted.status).toBe(204);

    const after = await adminJson(proxy, "GET", `/api/v1/backends/${backend.id}`);
    expect(after.status).toBe(404);
  });

  it("rejects a second backend with a hostName already in use, even under a different provider", async () => {
    const first = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "dup-host-a",
      hostName: "shared-host",
      provider: "vllm",
      baseUrl: mock.url,
    });
    expect(first.status).toBe(201);
    const firstBackend = (await first.json()) as { id: string };

    // Same hostName, same provider -> rejected.
    const duplicateSameProvider = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "dup-host-b",
      hostName: "shared-host",
      provider: "vllm",
      baseUrl: mock.url,
    });
    expect(duplicateSameProvider.status).toBe(409);

    // Same hostName, DIFFERENT provider -> also rejected. hostName is the sole
    // differentiator in pass-through model ids; a different provider suffix isn't a
    // meaningful distinction to an end user picking a model from a list.
    const duplicateDifferentProvider = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "dup-host-c",
      hostName: "shared-host",
      provider: "lmstudio",
      baseUrl: mock.url,
    });
    expect(duplicateDifferentProvider.status).toBe(409);
    const body = (await duplicateDifferentProvider.json()) as { error: string };
    expect(body.error).toContain("shared-host");

    await adminJson(proxy, "DELETE", `/api/v1/backends/${firstBackend.id}`);
  });

  it("requires hostName when creating a backend", async () => {
    const res = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "no-host-backend",
      provider: "generic",
      baseUrl: mock.url,
    });
    expect(res.status).toBe(400);
  });

  it("creates, edits mappings, and deletes a v-model; empty mappings still list", async () => {
    const backendRes = await adminJson(proxy, "POST", "/api/v1/backends", {
      name: "vmodel-pool",
      hostName: "crud-host",
      provider: "generic",
      baseUrl: mock.url,
    });
    expect(backendRes.status).toBe(201);
    const backend = (await backendRes.json()) as { id: string };

    const empty = await adminJson(proxy, "POST", "/api/v1/vmodels", {
      modelId: "empty-alias",
      displayName: "Empty Alias",
    });
    expect(empty.status).toBe(201);
    const emptyVm = (await empty.json()) as { id: string; modelId: string };
    expect(await listModelIds(proxy.url, apiKey)).toContain("empty-alias");

    const created = await adminJson(proxy, "POST", "/api/v1/vmodels", {
      modelId: "crud-alias",
      displayName: "CRUD Alias",
      backends: [{ backendId: backend.id, backendModelId: "crud-model" }],
    });
    expect(created.status).toBe(201);
    const vm = (await created.json()) as {
      id: string;
      modelId: string;
      displayName: string;
      backends: Array<{ id: string }>;
    };
    expect(vm.modelId).toBe("crud-alias");
    expect(vm.backends).toHaveLength(1);

    const patched = await adminJson(proxy, "PATCH", `/api/v1/vmodels/${vm.id}`, {
      displayName: "CRUD Alias Renamed",
    });
    expect(patched.status).toBe(200);

    const removed = await adminJson(
      proxy,
      "DELETE",
      `/api/v1/vmodels/${vm.id}/backends/${vm.backends[0]!.id}`,
    );
    expect(removed.status).toBe(204);

    const added = await adminJson(proxy, "POST", `/api/v1/vmodels/${vm.id}/backends`, {
      backendId: backend.id,
      backendModelId: "crud-model",
    });
    expect(added.status).toBe(201);

    const deleted = await adminJson(proxy, "DELETE", `/api/v1/vmodels/${vm.id}`);
    expect(deleted.status).toBe(204);
    expect(await listModelIds(proxy.url, apiKey)).not.toContain("crud-alias");

    const gone = await adminJson(proxy, "GET", `/api/v1/vmodels/${vm.id}`);
    expect(gone.status).toBe(404);

    const stillEmpty = await adminJson(proxy, "GET", `/api/v1/vmodels/${emptyVm.id}`);
    expect(stillEmpty.status).toBe(200);
  });

  describe("v-model kind validation", () => {
    it("rejects adding a nonexistent backendId with 400, not 500", async () => {
      const created = await adminJson(proxy, "POST", "/api/v1/vmodels", {
        modelId: "kind-validation-alias-1",
      });
      const vm = (await created.json()) as { id: string };

      const res = await adminJson(proxy, "POST", `/api/v1/vmodels/${vm.id}/backends`, {
        backendId: "backend-does-not-exist",
        backendModelId: "whatever",
      });
      expect(res.status).toBe(400);
    });

    it("rejects adding a heuristically-embedding model to a chat v-model", async () => {
      const backendRes = await adminJson(proxy, "POST", "/api/v1/backends", {
        name: "kind-validation-backend-1",
        hostName: "kind-validation-host-1",
        provider: "generic",
        baseUrl: mock.url,
      });
      const backend = (await backendRes.json()) as { id: string };

      const created = await adminJson(proxy, "POST", "/api/v1/vmodels", {
        modelId: "kind-validation-chat-alias",
        kind: "chat",
      });
      const vm = (await created.json()) as { id: string };

      // No catalog seeded — classification falls back to the id heuristic, and
      // "bge-m3" positively classifies as an embedding model.
      const res = await adminJson(proxy, "POST", `/api/v1/vmodels/${vm.id}/backends`, {
        backendId: backend.id,
        backendModelId: "bge-m3",
      });
      expect(res.status).toBe(400);

      const vmAfter = await adminJson(proxy, "GET", `/api/v1/vmodels/${vm.id}`);
      const vmAfterBody = (await vmAfter.json()) as { backends: unknown[] };
      expect(vmAfterBody.backends).toHaveLength(0);
    });

    it("rejects creating an embedding v-model with a natively-classified chat member", async () => {
      const backendRes = await adminJson(proxy, "POST", "/api/v1/backends", {
        name: "kind-validation-backend-2",
        hostName: "kind-validation-host-2",
        provider: "generic",
        baseUrl: mock.url,
        // Avoid racing the immediate background health check the create route
        // schedules, which would overwrite the catalog seeded below.
        healthCheckEnabled: false,
      });
      const backend = (await backendRes.json()) as { id: string };

      // Simulate a health poll having positively classified this model as chat.
      proxy.db.db
        .update(backendsTable)
        .set({
          modelCatalog: serializeModelCatalog([{ id: "crud-model", kind: "llm", source: "native" }]),
        })
        .where(eq(backendsTable.id, backend.id))
        .run();

      const res = await adminJson(proxy, "POST", "/api/v1/vmodels", {
        modelId: "kind-validation-embed-alias",
        kind: "embedding",
        backends: [{ backendId: backend.id, backendModelId: "crud-model" }],
      });
      expect(res.status).toBe(400);

      const list = await adminJson(proxy, "GET", "/api/v1/vmodels");
      const all = (await list.json()) as Array<{ modelId: string }>;
      expect(all.find((v) => v.modelId === "kind-validation-embed-alias")).toBeUndefined();
    });

    it("infers kind:'embedding' when omitted and every member positively classifies as embeddings", async () => {
      const backendRes = await adminJson(proxy, "POST", "/api/v1/backends", {
        name: "kind-validation-backend-3",
        hostName: "kind-validation-host-3",
        provider: "generic",
        baseUrl: mock.url,
      });
      const backend = (await backendRes.json()) as { id: string };

      const created = await adminJson(proxy, "POST", "/api/v1/vmodels", {
        modelId: "kind-inferred-embed-alias",
        backends: [{ backendId: backend.id, backendModelId: "bge-m3" }],
      });
      expect(created.status).toBe(201);
      const vm = (await created.json()) as { kind: string };
      expect(vm.kind).toBe("embedding");
    });

    it("allows changing kind while no members are mapped, and rejects it once members exist", async () => {
      const backendRes = await adminJson(proxy, "POST", "/api/v1/backends", {
        name: "kind-validation-backend-4",
        hostName: "kind-validation-host-4",
        provider: "generic",
        baseUrl: mock.url,
      });
      const backend = (await backendRes.json()) as { id: string };

      const created = await adminJson(proxy, "POST", "/api/v1/vmodels", {
        modelId: "kind-patch-alias",
        kind: "chat",
      });
      const vm = (await created.json()) as { id: string };

      const patchedEmpty = await adminJson(proxy, "PATCH", `/api/v1/vmodels/${vm.id}`, {
        kind: "embedding",
      });
      expect(patchedEmpty.status).toBe(200);

      const added = await adminJson(proxy, "POST", `/api/v1/vmodels/${vm.id}/backends`, {
        backendId: backend.id,
        backendModelId: "bge-m3",
      });
      expect(added.status).toBe(201);

      const patchedWithMembers = await adminJson(proxy, "PATCH", `/api/v1/vmodels/${vm.id}`, {
        kind: "chat",
      });
      expect(patchedWithMembers.status).toBe(409);
    });
  });
});
