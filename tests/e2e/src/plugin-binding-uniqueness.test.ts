import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertBackend, insertKey, insertVModel, adminJson } from "./helpers/seed.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";

describe("a plugin binds to a scope once", () => {
  let proxy: TestProxy;
  let vmodelId: string;
  let otherVModelId: string;
  const now = Date.now();

  const addPlugin = (id: string, name: string) =>
    proxy.db.sqlite
      .prepare(
        `INSERT INTO plugins (id, name, source, manifest, enabled, created_at, updated_at)
         VALUES (?, ?, 'local:/none', '{"hooks":[]}', 1, ?, ?)`,
      )
      .run(id, name, now, now);
  const bind = (pluginId: string, body: Record<string, unknown>) =>
    adminJson(proxy, "POST", `/api/v1/plugins/${pluginId}/bindings`, body);
  const boundCount = (pluginId: string) =>
    (proxy.db.sqlite.prepare("SELECT count(*) n FROM plugin_bindings WHERE plugin_id = ?").get(pluginId) as { n: number }).n;

  beforeAll(async () => {
    proxy = await startTestProxy();
    addPlugin("plugin-a", "Alpha");
    addPlugin("plugin-b", "Beta");
    vmodelId = await insertVModel(proxy, { modelId: "uniq-vm" });
    otherVModelId = await insertVModel(proxy, { modelId: "uniq-vm-2" });
  });

  afterAll(async () => {
    await proxy.stop();
  });

  it("rejects binding the same plugin to the same v-model twice", async () => {
    expect((await bind("plugin-a", { scopeType: "vmodel", scopeId: vmodelId })).status).toBe(201);

    const again = await bind("plugin-a", { scopeType: "vmodel", scopeId: vmodelId });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "binding_exists", error: expect.stringContaining("Alpha") });
    expect(boundCount("plugin-a")).toBe(1);
  });

  it("rejects a second global binding, backend binding and key binding", async () => {
    const backendId = await insertBackend(proxy, { name: "uniq-be", hostName: "uniq-host", baseUrl: "http://127.0.0.1:1" });
    const { id: keyId } = await insertKey(proxy, { name: "uniq-key" });

    for (const body of [
      { scopeType: "global" },
      { scopeType: "backend", scopeId: backendId },
      { scopeType: "key", scopeId: keyId },
    ]) {
      expect((await bind("plugin-b", body)).status, JSON.stringify(body)).toBe(201);
      expect((await bind("plugin-b", body)).status, `duplicate ${JSON.stringify(body)}`).toBe(409);
    }
    expect(boundCount("plugin-b")).toBe(3);
  });

  it("still allows the same plugin on another scope, and another plugin on the same scope", async () => {
    expect((await bind("plugin-a", { scopeType: "vmodel", scopeId: otherVModelId })).status).toBe(201);
    expect((await bind("plugin-b", { scopeType: "vmodel", scopeId: vmodelId })).status).toBe(201);
  });

  it("requires a scope ID for every scope but global", async () => {
    const res = await bind("plugin-a", { scopeType: "vmodel" });
    expect(res.status).toBe(400);
    expect((await bind("plugin-a", { scopeType: "backend", scopeId: "   " })).status).toBe(400);
  });

  it("lets exactly one of several simultaneous identical requests win", async () => {
    addPlugin("plugin-race", "Race");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => bind("plugin-race", { scopeType: "vmodel", scopeId: vmodelId })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    expect(boundCount("plugin-race")).toBe(1);
  });

  it("does the same for backend models mapped to a v-model", async () => {
    const backendId = await insertBackend(proxy, { name: "uniq-be-2", hostName: "uniq-host-2", baseUrl: "http://127.0.0.1:2" });
    const map = () => adminJson(proxy, "POST", `/api/v1/vmodels/${vmodelId}/backends`, { backendId, backendModelId: "m1" });

    const results = await Promise.all(Array.from({ length: 6 }, map));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);

    const rows = proxy.db.sqlite
      .prepare("SELECT count(*) n FROM vmodel_backends WHERE vmodel_id = ? AND backend_id = ? AND backend_model_id = 'm1'")
      .get(vmodelId, backendId) as { n: number };
    expect(rows.n).toBe(1);
  });
});
