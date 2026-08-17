import { describe, it, beforeAll, afterAll, expect } from "vitest";
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
});
