import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recomputeAllVModelHealth } from "@haai/proxy/vmodel-health";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertBackend, insertKey, insertVModel } from "./helpers/seed.js";

// Runs the built CLI (`pnpm --filter @haai/cli build`) against a real test proxy.
const cliEntry = fileURLToPath(new URL("../../../packages/cli/dist/index.js", import.meta.url));

// Async on purpose: the proxy runs in this process, so blocking would deadlock it.
function haai(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [cliEntry, ...args],
      { encoding: "utf8", env: { ...process.env, HAAI_API_KEY: "", HAAI_ADMIN_TOKEN: "", ...env } },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code;
        resolve({ status: err ? (typeof code === "number" ? code : 1) : 0, stdout, stderr });
      },
    );
  });
}

describe("haai models", () => {
  let proxy: TestProxy;
  let mock: StartedMockServer;
  let apiKey: string;

  beforeAll(async () => {
    proxy = await startTestProxy();
    mock = await startMockServer({
      hostName: "cli-host",
      provider: "generic",
      models: [{ id: "cli-model" }],
    });
    const backendId = await insertBackend(proxy, {
      name: "cli-backend",
      hostName: "cli-host",
      baseUrl: mock.url,
      availableModels: ["cli-model"],
      modelCatalog: [{ id: "cli-model", kind: "llm", source: "heuristic" }],
      lastHealthStatus: "healthy",
    });
    await insertVModel(proxy, {
      modelId: "cli-chat",
      backends: [{ backendId, backendModelId: "cli-model" }],
    });
    await recomputeAllVModelHealth(proxy.db);
    apiKey = (await insertKey(proxy)).key;
  });

  afterAll(async () => {
    await proxy.stop();
    await mock.stop();
  });

  it("lists the models the key can use, one per line", async () => {
    const { status, stdout } = await haai(["models", "-u", proxy.url, "-k", apiKey]);
    expect(status).toBe(0);
    expect(stdout.split("\n")).toContain("cli-chat");
  });

  it("reads the key from HAAI_API_KEY", async () => {
    const { status, stdout } = await haai(["models", "-u", proxy.url], { HAAI_API_KEY: apiKey });
    expect(status).toBe(0);
    expect(stdout.split("\n")).toContain("cli-chat");
  });

  it("fails with the proxy's message when the key is rejected", async () => {
    const { status, stdout, stderr } = await haai([
      "models",
      "-u",
      proxy.url,
      "-k",
      "haai-sk-not-a-real-key-000",
    ]);
    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/Request failed \(401\)/);
  });

  it("requires a key", async () => {
    const { status, stderr } = await haai(["models", "-u", proxy.url]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/Missing --key/);
  });
});
