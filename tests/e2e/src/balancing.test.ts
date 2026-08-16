import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { BackendBalancer } from "@haai/proxy/balancer";
import type { BackendCandidate } from "@haai/proxy/balancer";
import type { Backend } from "@haai/core";

function makeCandidate(id: string, overrides: Partial<Backend> = {}): BackendCandidate {
  const backendModelId = "model";
  return {
    backendId: id,
    backend: {
      id,
      name: id,
      displayName: id,
      hostName: "test",
      provider: "generic",
      baseUrl: "http://localhost",
      keyMode: "passthrough",
      encryptedApiKey: null,
      enabled: true,
      weight: 1,
      maxConcurrency: 10,
      healthCheckEnabled: true,
      lastHealthCheck: null,
      lastHealthStatus: "healthy",
      lastLatencyMs: 100,
      lastHealthError: null,
      availableModels: JSON.stringify([backendModelId]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    } as Backend,
    backendModelId,
    weight: 1,
  };
}

describe("BackendBalancer", () => {
  it("round-robin distributes evenly", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      makeCandidate("a"),
      makeCandidate("b"),
      makeCandidate("c"),
    ];

    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 30; i++) {
      const selected = balancer.select(candidates, "round-robin");
      expect(selected).not.toBeNull();
      counts[selected!.backendId as keyof typeof counts]++;
    }

    // Each should get ~10 (allow ±1 for rounding)
    expect(counts.a).toBe(10);
    expect(counts.b).toBe(10);
    expect(counts.c).toBe(10);
  });

  it("session-pin consistently maps session to same backend", () => {
    const balancer = new BackendBalancer();
    const candidates = [makeCandidate("a"), makeCandidate("b"), makeCandidate("c")];

    const sessionKey = "user-session-123";
    const first = balancer.select(candidates, "session-pin", sessionKey);
    expect(first).not.toBeNull();

    // Same session should always hit same backend
    for (let i = 0; i < 10; i++) {
      const result = balancer.select(candidates, "session-pin", sessionKey);
      expect(result?.backendId).toBe(first?.backendId);
    }
  });

  it("session-pin maps different sessions to potentially different backends", () => {
    const balancer = new BackendBalancer();
    const candidates = [makeCandidate("a"), makeCandidate("b"), makeCandidate("c")];

    const sessions = Array.from({ length: 100 }, (_, i) => `session-${i}`);
    const backendHits = new Set<string>();

    for (const session of sessions) {
      const result = balancer.select(candidates, "session-pin", session);
      if (result) backendHits.add(result.backendId);
    }

    // With 100 sessions, all 3 backends should get some traffic
    expect(backendHits.size).toBe(3);
  });

  it("weighted strategy respects weights", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      { ...makeCandidate("heavy"), weight: 3 },
      { ...makeCandidate("light"), weight: 1 },
    ];

    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 1000; i++) {
      const result = balancer.select(candidates, "weighted");
      if (result) counts[result.backendId as keyof typeof counts]++;
    }

    // heavy should get ~75%, light ~25%
    expect(counts.heavy).toBeGreaterThan(600);
    expect(counts.light).toBeGreaterThan(150);
  });

  it("least-connections routes to backend with fewer connections", () => {
    const balancer = new BackendBalancer();
    const candidates = [makeCandidate("busy"), makeCandidate("free")];

    // Simulate busy backend with more connections
    balancer.incrementConcurrency("busy");
    balancer.incrementConcurrency("busy");
    balancer.incrementConcurrency("busy");

    for (let i = 0; i < 10; i++) {
      const result = balancer.select(candidates, "least-connections");
      expect(result?.backendId).toBe("free");
    }
  });

  it("least-latency routes to backend with lower latency", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      makeCandidate("slow", { lastLatencyMs: 1000 }),
      makeCandidate("fast", { lastLatencyMs: 50 }),
    ];

    for (let i = 0; i < 5; i++) {
      const result = balancer.select(candidates, "least-latency");
      expect(result?.backendId).toBe("fast");
    }
  });

  it("skips unhealthy backends without requiring an open circuit", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      makeCandidate("healthy", { lastHealthStatus: "healthy" }),
      makeCandidate("unhealthy", { lastHealthStatus: "unhealthy" }),
    ];

    for (let i = 0; i < 10; i++) {
      const result = balancer.select(candidates, "round-robin");
      expect(result?.backendId).toBe("healthy");
    }
  });

  it("skips mappings whose model is missing from inventory", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      makeCandidate("has-model"),
      makeCandidate("missing-model", { availableModels: JSON.stringify(["other-model"]) }),
    ];

    for (let i = 0; i < 5; i++) {
      const result = balancer.select(candidates, "round-robin");
      expect(result?.backendId).toBe("has-model");
    }
  });

  it("returns null when all mappings are unavailable", () => {
    const balancer = new BackendBalancer();
    const candidates = [
      makeCandidate("a", { lastHealthStatus: "unhealthy" }),
      makeCandidate("b", { availableModels: JSON.stringify([]) }),
    ];
    expect(balancer.select(candidates, "round-robin")).toBeNull();
  });

  it("concurrency tracking", () => {
    const balancer = new BackendBalancer();
    expect(balancer.getConcurrency("test")).toBe(0);
    balancer.incrementConcurrency("test");
    balancer.incrementConcurrency("test");
    expect(balancer.getConcurrency("test")).toBe(2);
    balancer.decrementConcurrency("test");
    expect(balancer.getConcurrency("test")).toBe(1);
  });
});
