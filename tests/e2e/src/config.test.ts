import { describe, it, expect } from "vitest";
import { loadConfig } from "@haai/core";
import { getMasterKey, encrypt, decrypt } from "@haai/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Configuration loading", () => {
  it("should load defaults when no config exists", () => {
    const config = loadConfig({ configFile: "/nonexistent/config.yaml" });
    expect(config.server.port).toBe(4000);
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.log.level).toBe("info");
    expect(config.metrics.enabled).toBe(true);
  });

  it("should respect environment variables", () => {
    process.env["HAAI_PORT"] = "5000";
    process.env["HAAI_LOG_LEVEL"] = "debug";
    const config = loadConfig({ configFile: "/nonexistent/config.yaml" });
    expect(config.server.port).toBe(5000);
    expect(config.log.level).toBe("debug");
    // Cleanup
    delete process.env["HAAI_PORT"];
    delete process.env["HAAI_LOG_LEVEL"];
  });

  it("should use dev port when HAAI_DEV=1", () => {
    process.env["HAAI_DEV"] = "1";
    const config = loadConfig({ configFile: "/nonexistent/config.yaml" });
    expect(config.server.port).toBe(4001);
    delete process.env["HAAI_DEV"];
  });

  it("should allow HAAI_PORT to override dev default", () => {
    process.env["HAAI_DEV"] = "1";
    process.env["HAAI_PORT"] = "5000";
    const config = loadConfig({ configFile: "/nonexistent/config.yaml" });
    expect(config.server.port).toBe(5000);
    delete process.env["HAAI_DEV"];
    delete process.env["HAAI_PORT"];
  });

  it("should coerce string env vars to numbers", () => {
    process.env["HAAI_PORT"] = "3999";
    const config = loadConfig({ configFile: "/nonexistent/config.yaml" });
    expect(typeof config.server.port).toBe("number");
    expect(config.server.port).toBe(3999);
    delete process.env["HAAI_PORT"];
  });
});

describe("Crypto", () => {
  let tmpDir: string;

  it("should generate and persist master key", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "haai-crypto-test-"));
    const key1 = getMasterKey(tmpDir);
    const key2 = getMasterKey(tmpDir); // Should load same key
    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
  });

  it("should encrypt and decrypt strings", () => {
    const masterKey = getMasterKey(tmpDir);
    const plaintext = "my-secret-api-key-12345";
    const encrypted = encrypt(plaintext, masterKey);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for same plaintext (random IV)", () => {
    const masterKey = getMasterKey(tmpDir);
    const plaintext = "same-plaintext";
    const enc1 = encrypt(plaintext, masterKey);
    const enc2 = encrypt(plaintext, masterKey);
    expect(enc1).not.toBe(enc2); // Different IVs
    expect(decrypt(enc1, masterKey)).toBe(plaintext);
    expect(decrypt(enc2, masterKey)).toBe(plaintext);
  });

  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
