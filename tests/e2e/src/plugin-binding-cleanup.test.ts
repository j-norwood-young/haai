import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertBackend, insertKey, insertVModel, adminJson } from "./helpers/seed.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";

interface PluginWithBindings {
  id: string;
  bindings: Array<{ scopeType: string; scopeId: string | null }>;
}

describe("deleting a scope removes its plugin bindings", () => {
  let proxy: TestProxy;
  let pluginId: string;

  const bind = (scopeType: string, scopeId?: string) =>
    adminJson(proxy, "POST", `/api/v1/plugins/${pluginId}/bindings`, { scopeType, scopeId });
  const bindings = async () => {
    const plugins = (await (await adminJson(proxy, "GET", "/api/v1/plugins")).json()) as PluginWithBindings[];
    return plugins.find((p) => p.id === pluginId)!.bindings.map((b) => `${b.scopeType}:${b.scopeId ?? ""}`);
  };

  beforeAll(async () => {
    proxy = await startTestProxy();
    // Bindings need a plugin row; the bundle is never run here
    const now = Date.now();
    pluginId = "plugin-cleanup";
    proxy.db.sqlite
      .prepare(
        `INSERT INTO plugins (id, name, source, manifest, enabled, created_at, updated_at)
         VALUES (?, 'Cleanup', 'local:/none', '{"name":"Cleanup","hooks":[]}', 1, ?, ?)`,
      )
      .run(pluginId, now, now);
  });

  afterAll(async () => {
    await proxy.stop();
  });

  it("removes bindings for a deleted v-model, backend and key — and only those", async () => {
    const backendId = await insertBackend(proxy, { name: "cleanup-be", hostName: "cleanup-host", baseUrl: "http://127.0.0.1:1" });
    const otherBackendId = await insertBackend(proxy, { name: "cleanup-be-2", hostName: "cleanup-host-2", baseUrl: "http://127.0.0.1:2" });
    const vmodelId = await insertVModel(proxy, { modelId: "cleanup-vm" });
    const { id: keyId } = await insertKey(proxy, { name: "cleanup-key" });

    for (const [type, id] of [["vmodel", vmodelId], ["backend", backendId], ["backend", otherBackendId], ["key", keyId]] as const) {
      expect((await bind(type, id)).status).toBeLessThan(300);
    }
    expect((await bind("global")).status).toBeLessThan(300);
    expect(await bindings()).toHaveLength(5);

    expect((await adminJson(proxy, "DELETE", `/api/v1/vmodels/${vmodelId}`)).status).toBe(204);
    expect(await bindings()).not.toContain(`vmodel:${vmodelId}`);

    expect((await adminJson(proxy, "DELETE", `/api/v1/backends/${backendId}`)).status).toBe(204);
    expect(await bindings()).not.toContain(`backend:${backendId}`);

    expect((await adminJson(proxy, "DELETE", `/api/v1/keys/${keyId}`)).status).toBe(204);

    // Untouched: the other backend's binding and the global one
    expect((await bindings()).sort()).toEqual(["backend:" + otherBackendId, "global:"].sort());
  });
});
