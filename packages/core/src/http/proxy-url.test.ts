import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProxyCandidateUrls, resolveDefaultProxyUrl } from "./proxy-url.js";

describe("defaultProxyCandidateUrls", () => {
  it("lists production then dev ports", () => {
    expect(defaultProxyCandidateUrls()).toEqual([
      "http://localhost:4000",
      "http://localhost:4001",
    ]);
  });
});

describe("resolveDefaultProxyUrl", () => {
  afterEach(() => {
    delete process.env["HAAI_URL"];
    vi.unstubAllGlobals();
  });

  it("uses explicitUrl over env and probe", async () => {
    process.env["HAAI_URL"] = "http://localhost:4000";
    const fetchMock = vi.fn();
    await expect(
      resolveDefaultProxyUrl({ explicitUrl: "http://localhost:9999/", fetch: fetchMock }),
    ).resolves.toBe("http://localhost:9999");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses HAAI_URL when set", async () => {
    process.env["HAAI_URL"] = "http://example.test:5555/";
    const fetchMock = vi.fn();
    await expect(resolveDefaultProxyUrl({ fetch: fetchMock })).resolves.toBe(
      "http://example.test:5555",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns first healthy candidate", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(":4000")) return new Response(null, { status: 503 });
      if (url.includes(":4001")) return new Response("{}", { status: 200 });
      return new Response(null, { status: 404 });
    });
    await expect(resolveDefaultProxyUrl({ fetch: fetchMock as typeof fetch })).resolves.toBe(
      "http://localhost:4001",
    );
  });

  it("prefers production port when both are healthy", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(resolveDefaultProxyUrl({ fetch: fetchMock as typeof fetch })).resolves.toBe(
      "http://localhost:4000",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to production default when nothing responds", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("refused");
    });
    await expect(resolveDefaultProxyUrl({ fetch: fetchMock as typeof fetch })).resolves.toBe(
      "http://localhost:4000",
    );
  });
});
