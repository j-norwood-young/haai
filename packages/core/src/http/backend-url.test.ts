import { describe, expect, it } from "vitest";
import { buildBackendApiUrl, buildBackendRootUrl } from "./backend-url.js";

describe("buildBackendApiUrl", () => {
  it("appends /v1 paths to a host-only base URL", () => {
    expect(buildBackendApiUrl("http://192.168.1.100:1234", "/v1/chat/completions")).toBe(
      "http://192.168.1.100:1234/v1/chat/completions",
    );
  });

  it("avoids duplicating /v1 when the base URL already includes it", () => {
    expect(buildBackendApiUrl("https://api.openai.com/v1", "/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildBackendApiUrl("https://api.openai.com/v1/", "/v1/models")).toBe(
      "https://api.openai.com/v1/models",
    );
  });

  it("accepts paths without a leading slash", () => {
    expect(buildBackendApiUrl("http://localhost:8080", "v1/embeddings")).toBe(
      "http://localhost:8080/v1/embeddings",
    );
  });
});

describe("buildBackendRootUrl", () => {
  it("strips a trailing /v1 segment before appending a non-OpenAI path", () => {
    expect(buildBackendRootUrl("http://192.168.1.100:1234/v1", "/api/v0/models")).toBe(
      "http://192.168.1.100:1234/api/v0/models",
    );
  });

  it("strips a trailing /v1/ segment (with trailing slash)", () => {
    expect(buildBackendRootUrl("http://192.168.1.100:1234/v1/", "/api/v0/models")).toBe(
      "http://192.168.1.100:1234/api/v0/models",
    );
  });

  it("leaves a host-only base URL unchanged", () => {
    expect(buildBackendRootUrl("http://localhost:11434", "/api/show")).toBe(
      "http://localhost:11434/api/show",
    );
  });

  it("strips a trailing slash from a host-only base URL", () => {
    expect(buildBackendRootUrl("http://localhost:11434/", "/api/show")).toBe(
      "http://localhost:11434/api/show",
    );
  });

  it("accepts paths without a leading slash", () => {
    expect(buildBackendRootUrl("http://localhost:1234/v1", "api/v0/models")).toBe(
      "http://localhost:1234/api/v0/models",
    );
  });

  it("does not double the /v1/api/v0 path this function exists to avoid", () => {
    expect(buildBackendRootUrl("http://host:1234/v1", "/api/v0/models")).not.toContain(
      "/v1/api/v0/models",
    );
  });
});
