import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { adminJson } from "./helpers/seed.js";

interface PluginRow {
  id: string;
  name: string;
  version: string | null;
  source: string;
  upgradedFrom?: string | null;
  bindings: Array<{ id: string; scopeType: string }>;
}

describe("plugin install: unique names and upgrades", () => {
  let proxy: TestProxy;
  let workDir: string;

  /** Write a minimal installable plugin package and return its `local:` source */
  function makePlugin(dir: string, opts: { name: string; version: string; marker?: string }): string {
    const packageDir = join(workDir, dir);
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: dir,
        type: "module",
        main: "dist/index.js",
        "haai-plugin": { name: opts.name, version: opts.version, hooks: ["onRequest"] },
      }),
    );
    writeFileSync(
      join(packageDir, "dist", "index.js"),
      `export default { hooks: { onRequest(req) { return { ...req, marker: ${JSON.stringify(opts.marker ?? opts.version)} }; } } };`,
    );
    return `local:${packageDir}`;
  }

  const install = (body: Record<string, unknown>) => adminJson(proxy, "POST", "/api/v1/plugins", body);
  const list = async () => (await (await adminJson(proxy, "GET", "/api/v1/plugins")).json()) as PluginRow[];

  beforeAll(async () => {
    proxy = await startTestProxy();
    workDir = mkdtempSync(join(tmpdir(), "haai-plugin-e2e-"));
  });

  afterAll(async () => {
    await proxy.stop();
    rmSync(workDir, { recursive: true, force: true });
  });

  it("installs a plugin, then refuses the same name again at the same version", async () => {
    const source = makePlugin("alpha-1", { name: "Alpha", version: "1.0.0" });

    const first = await install({ source });
    expect(first.status).toBe(201);

    const again = await install({ source });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "name_taken", name: "Alpha" });
    expect((await list()).filter((p) => p.name === "Alpha")).toHaveLength(1);
  });

  it("treats names case-insensitively, including a name override", async () => {
    const source = makePlugin("alpha-dup", { name: "Something Else", version: "1.0.0" });
    const res = await install({ source, name: "  ALPHA " });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "name_taken" });
  });

  it("allows the same plugin under a different name", async () => {
    const source = makePlugin("alpha-2", { name: "Alpha", version: "1.0.0" });
    const res = await install({ source, name: "Alpha Copy" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as PluginRow).name).toBe("Alpha Copy");
  });

  it("refuses an older version under an existing name", async () => {
    const source = makePlugin("alpha-old", { name: "Alpha", version: "0.9.0" });
    const res = await install({ source });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "name_taken" });
  });

  it("asks for confirmation on a newer version, and changes nothing until confirmed", async () => {
    const before = (await list()).find((p) => p.name === "Alpha")!;
    const source = makePlugin("alpha-2-0", { name: "Alpha", version: "1.1.0" });

    const res = await install({ source });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "upgrade_available",
      name: "Alpha",
      pluginId: before.id,
      currentVersion: "1.0.0",
      newVersion: "1.1.0",
    });

    const after = (await list()).find((p) => p.name === "Alpha")!;
    expect(after.version).toBe("1.0.0");
    expect(after.source).toBe(before.source);
  });

  it("upgrades in place when confirmed, keeping the plugin ID and its bindings", async () => {
    const before = (await list()).find((p) => p.name === "Alpha")!;
    const bound = await adminJson(proxy, "POST", `/api/v1/plugins/${before.id}/bindings`, { scopeType: "global" });
    expect(bound.status).toBeLessThan(300);

    const source = makePlugin("alpha-2-0", { name: "Alpha", version: "1.1.0" });
    const res = await install({ source, upgrade: true });
    expect(res.status).toBe(200);
    const upgraded = (await res.json()) as PluginRow;
    expect(upgraded).toMatchObject({ id: before.id, version: "1.1.0", source, upgradedFrom: "1.0.0" });

    const plugins = await list();
    expect(plugins.filter((p) => p.name === "Alpha")).toHaveLength(1);
    // The index endpoint carries each plugin's bindings (the Plugins page renders them)
    expect(plugins.find((p) => p.id === before.id)?.bindings).toMatchObject([{ scopeType: "global" }]);
    expect(plugins.find((p) => p.name === "Alpha Copy")?.bindings).toEqual([]);

    const detail = (await (await adminJson(proxy, "GET", `/api/v1/plugins/${before.id}`)).json()) as {
      bindings: unknown[];
    };
    expect(detail.bindings).toHaveLength(1);
  });

  it("does not let `upgrade: true` bypass the name check for a non-newer version", async () => {
    const source = makePlugin("alpha-stale", { name: "Alpha", version: "1.0.5" });
    const res = await install({ source, upgrade: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "name_taken" });
  });

  it("rejects renaming a plugin to a name that's taken", async () => {
    const plugins = await list();
    const copy = plugins.find((p) => p.name === "Alpha Copy")!;
    const res = await adminJson(proxy, "PATCH", `/api/v1/plugins/${copy.id}`, { name: "alpha" });
    expect(res.status).toBe(409);

    const self = await adminJson(proxy, "PATCH", `/api/v1/plugins/${copy.id}`, { name: "Alpha Copy" });
    expect(self.status).toBe(200);
  });
});
