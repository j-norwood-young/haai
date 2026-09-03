import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertUsageEvent, adminJson } from "./helpers/seed.js";

describe("live metrics API", () => {
  let proxy: TestProxy;
  let backendId: string;

  beforeAll(async () => {
    proxy = await startTestProxy();
    const now = Date.now();

    backendId = "backend-live-1";
    insertUsageEvent(proxy, {
      timestamp: now - 3600 * 1000,
      totalTokens: 30,
      ttftMs: 100,
      durationMs: 500,
      tps: 40,
      statusCode: 200,
      backendId,
      vmodelId: "vm-1",
      backendModelId: "gpt-x",
    });
    insertUsageEvent(proxy, {
      timestamp: now - 1800 * 1000,
      totalTokens: 60,
      ttftMs: 300,
      durationMs: 900,
      tps: 66,
      statusCode: 500,
      backendId,
      vmodelId: "vm-1",
      backendModelId: "gpt-x",
    });
  });

  afterAll(async () => {
    await proxy.stop();
  });

  it("summary includes percentiles and previous window", async () => {
    const res = await adminJson(
      proxy,
      "GET",
      `/api/v1/metrics/summary?since=${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      p50_ttft_ms?: number;
      p95_ttft_ms?: number;
      previous?: unknown;
    };
    expect(body.p50_ttft_ms).toBe(100);
    expect(body.p95_ttft_ms).toBe(300);
    expect(body.previous).toBeDefined();
  });

  it("breakdown by backend returns groups with names and percentiles", async () => {
    const res = await adminJson(proxy, "GET", "/api/v1/metrics/breakdown?by=backend");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      by: string;
      groups: Array<{
        key: string;
        name: string;
        requests: number;
        ttft_p50_ms?: number;
        ttft_p95_ms?: number;
        errors: number;
      }>;
    };
    expect(body.by).toBe("backend");
    expect(body.groups).toHaveLength(1);
    const group = body.groups[0]!;
    expect(group.key).toBe(backendId);
    expect(group.name).toBe("(deleted)"); // no backends row seeded for this id
    expect(group.requests).toBe(2);
    expect(group.errors).toBe(1);
    expect(group.ttft_p50_ms).toBe(100);
    expect(group.ttft_p95_ms).toBe(300);
  });

  it("breakdown rejects invalid by with 400", async () => {
    const res = await adminJson(proxy, "GET", "/api/v1/metrics/breakdown?by=bogus");
    expect(res.status).toBe(400);
  });

  it("rollups minute period returns zero-filled buckets", async () => {
    const res = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=minute&limit=10");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ timestamp: string; requests: number }>;
    expect(rows).toHaveLength(10);
    // Buckets are minute-aligned and contiguous
    const ts = rows.map((r) => new Date(r.timestamp).getTime());
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]! - ts[i - 1]!).toBe(60_000);
    }
  });

  it("rollups 5min period returns zero-filled buckets", async () => {
    const res = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=5min&limit=6");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ timestamp: string }>;
    expect(rows).toHaveLength(6);
  });

  it("events errorsOnly returns only failures with backend fields", async () => {
    const res = await adminJson(
      proxy,
      "GET",
      `/api/v1/metrics/events?errorsOnly=true&since=${Date.now() - 24 * 3600 * 1000}`,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      statusCode: number;
      backendId?: string;
      backendName?: string;
      ttftMs?: number;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(rows.every((r) => r.backendId === backendId)).toBe(true);
  });

  it("live snapshot has the right shape", async () => {
    const res = await adminJson(proxy, "GET", "/api/v1/metrics/live");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      now: number;
      startedAt: number;
      series: Array<{ t: number; completed: number; tokens: number; inFlight: number }>;
      inFlight: unknown[];
      inFlightTotal: number;
      backends: Array<{ backendId: string; circuit: string; concurrency: number; probes: unknown[] }>;
    };
    expect(body.now).toBeGreaterThan(0);
    expect(body.startedAt).toBeGreaterThan(0);
    expect(Array.isArray(body.series)).toBe(true);
    expect(body.inFlight).toEqual([]);
    expect(body.inFlightTotal).toBe(0);
    expect(Array.isArray(body.backends)).toBe(true);
    for (const b of body.backends) {
      expect(b.circuit).toBe("closed");
    }
  });
});
