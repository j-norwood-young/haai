import { describe, expect, it } from "vitest";
import type { AppConfig } from "@ai-v-models/core";
import { isRunningInDocker, resolvePublicBaseUrl, resolveWebUiUrl } from "./startup-banner.js";

const config = {
  server: { host: "0.0.0.0", port: 4000 },
} as AppConfig;

const devConfig = {
  server: { host: "0.0.0.0", port: 4001 },
} as AppConfig;

function restoreEnv(keys: string[], snapshot: Record<string, string | undefined>) {
  for (const key of keys) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

describe("resolvePublicBaseUrl", () => {
  const keys = ["AIVM_URL", "AIVM_DOCKER"];

  it("uses bind port when not in Docker", () => {
    const env = snapshotEnv(keys);
    delete process.env["AIVM_URL"];
    delete process.env["AIVM_DOCKER"];
    expect(resolvePublicBaseUrl(devConfig)).toBe("http://localhost:4001");
    restoreEnv(keys, env);
  });

  it("ignores AIVM_URL outside Docker", () => {
    const env = snapshotEnv(keys);
    process.env["AIVM_URL"] = "http://localhost:4001";
    delete process.env["AIVM_DOCKER"];
    expect(resolvePublicBaseUrl(devConfig)).toBe("http://localhost:4001");
    restoreEnv(keys, env);
  });

  it("uses AIVM_URL in Docker", () => {
    const env = snapshotEnv(keys);
    process.env["AIVM_DOCKER"] = "1";
    process.env["AIVM_URL"] = "http://localhost:4001/";
    expect(resolvePublicBaseUrl(config)).toBe("http://localhost:4001");
    restoreEnv(keys, env);
  });
});

describe("resolveWebUiUrl", () => {
  const keys = ["AIVM_WEB_URL", "AIVM_DOCKER", "AIVM_DEV", "AIVM_DEV_WEB_PORT"];

  it("uses Vite dev port in dev mode", () => {
    const env = snapshotEnv(keys);
    delete process.env["AIVM_DOCKER"];
    process.env["AIVM_DEV"] = "1";
    delete process.env["AIVM_WEB_URL"];
    expect(resolveWebUiUrl("http://localhost:4001")).toBe("http://localhost:5173");
    restoreEnv(keys, env);
  });

  it("uses AIVM_WEB_URL in Docker", () => {
    const env = snapshotEnv(keys);
    process.env["AIVM_DOCKER"] = "1";
    process.env["AIVM_WEB_URL"] = "http://localhost:5174";
    expect(resolveWebUiUrl("http://localhost:4001")).toBe("http://localhost:5174");
    restoreEnv(keys, env);
  });

  it("uses bundled proxy URL in production", () => {
    const env = snapshotEnv(keys);
    delete process.env["AIVM_DOCKER"];
    delete process.env["AIVM_DEV"];
    delete process.env["AIVM_WEB_URL"];
    expect(resolveWebUiUrl("http://localhost:4000")).toBe("http://localhost:4000");
    restoreEnv(keys, env);
  });
});

describe("isRunningInDocker", () => {
  it("returns true when AIVM_DOCKER=1", () => {
    const prev = process.env["AIVM_DOCKER"];
    process.env["AIVM_DOCKER"] = "1";
    expect(isRunningInDocker()).toBe(true);
    if (prev === undefined) delete process.env["AIVM_DOCKER"];
    else process.env["AIVM_DOCKER"] = prev;
  });
});
