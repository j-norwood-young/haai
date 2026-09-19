import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startMockServer, type StartedMockServer } from "./helpers/mock-server.js";

describe("Mock backend fault injection", () => {
  describe("rate limiting", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({
        fault: { rateLimitPct: 100 }, // always rate limit
      });
    });

    afterAll(async () => {
      await mock.stop();
    });

    it("should return 429 when fault is rate-limit", async () => {
      const res = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-model-1",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(429);
    });
  });

  describe("error injection", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({ fault: { errorPct: 100 } });
    });

    afterAll(async () => mock.stop());

    it("should return 500 when fault is error", async () => {
      const res = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-model-1",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe("always down", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({ fault: { alwaysDown: true } });
    });

    afterAll(async () => mock.stop());

    it("should return 503 when always down", async () => {
      const res = await fetch(`${mock.url}/v1/models`);
      expect(res.status).toBe(503);
    });
  });

  describe("latency injection", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({ globalLatencyMs: 200 });
    });

    afterAll(async () => mock.stop());

    it("should add latency to responses", async () => {
      const start = Date.now();
      const res = await fetch(`${mock.url}/v1/models`);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(190); // allow small margin
    });
  });

  describe("non-streaming response", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({});
    });

    afterAll(async () => mock.stop());

    it("should return non-streaming JSON response", async () => {
      const res = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-model-1",
          messages: [{ role: "user", content: "hi" }],
          stream: false,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { choices: unknown[] };
      expect(data.choices).toHaveLength(1);
    });
  });

  describe("embeddings", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({ models: [{ id: "mock-embed-1", kind: "embeddings" }] });
    });

    afterAll(async () => mock.stop());

    it("should return embeddings", async () => {
      const res = await fetch(`${mock.url}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-embed-1",
          input: "hello world",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { data: Array<{ embedding: number[] }> };
      expect(data.data[0]?.embedding).toBeDefined();
      expect(data.data[0]?.embedding.length).toBeGreaterThan(0);
    });
  });

  describe("authentication", () => {
    let mock: StartedMockServer;

    beforeAll(async () => {
      mock = await startMockServer({ apiKey: "secret-key-123" });
    });

    afterAll(async () => mock.stop());

    it("should return 401 for missing API key", async () => {
      const res = await fetch(`${mock.url}/v1/models`);
      expect(res.status).toBe(401);
    });

    it("should succeed with correct API key", async () => {
      const res = await fetch(`${mock.url}/v1/models`, {
        headers: { Authorization: "Bearer secret-key-123" },
      });
      expect(res.status).toBe(200);
    });

    it("should return 401 for wrong API key", async () => {
      const res = await fetch(`${mock.url}/v1/models`, {
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.status).toBe(401);
    });
  });
});
