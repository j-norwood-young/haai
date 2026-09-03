import { describe, it, expect } from "vitest";
import { aggregateBreakdown, percentile, type BreakdownRow } from "./routes/api/metrics-api.js";

function row(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    backendId: "backend-1",
    vmodelId: "vm-1",
    backendModelId: "gpt-x",
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    ttftMs: 100,
    durationMs: 500,
    tps: 40,
    toolCallCount: 0,
    statusCode: 200,
    timestamp: 1000,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns the only sample for a single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("uses nearest-rank for even counts", () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 50)).toBe(2);
  });

  it("computes p95 correctly", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile(sorted, 0)).toBe(1);
  });
});

describe("aggregateBreakdown", () => {
  const sinceMs = 0;
  const nowMs = 24_000;

  it("groups by backend", () => {
    const rows = [
      row({ backendId: "a", ttftMs: 100 }),
      row({ backendId: "a", ttftMs: 200 }),
      row({ backendId: "b", ttftMs: 300 }),
    ];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe("a");
    expect(groups[0]!.requests).toBe(2);
    expect(groups[0]!.backendId).toBe("a");
    expect(groups[0]!.ttft_p50_ms).toBe(100);
    expect(groups[0]!.ttft_p95_ms).toBe(200);
    expect(groups[0]!.ttft_max_ms).toBe(200);
  });

  it("groups by vmodel with direct for null vmodelId", () => {
    const rows = [row({ vmodelId: null }), row({ vmodelId: "vm-1" })];
    const groups = aggregateBreakdown(rows, "vmodel", rows.length, sinceMs, nowMs);
    const keys = groups.map((g) => g.key).sort();
    expect(keys).toEqual(["direct", "vm-1"]);
    const direct = groups.find((g) => g.key === "direct")!;
    expect(direct.vmodelId).toBeUndefined();
  });

  it("groups by backendModel with composite key", () => {
    const rows = [row({ backendId: "a", backendModelId: "m1" })];
    const groups = aggregateBreakdown(rows, "backendModel", rows.length, sinceMs, nowMs);
    expect(groups[0]!.key).toBe("a::m1");
    expect(groups[0]!.backendId).toBe("a");
    expect(groups[0]!.backendModelId).toBe("m1");
  });

  it("shares sum to 1", () => {
    const rows = [row(), row(), row({ backendId: "b" }), row({ backendId: "c" })];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    const total = groups.reduce((s, g) => s + g.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("omits percentile fields when no samples", () => {
    const rows = [row({ ttftMs: null, tps: null })];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    expect(groups[0]!.ttft_p50_ms).toBeUndefined();
    expect(groups[0]!.ttft_p95_ms).toBeUndefined();
    expect(groups[0]!.ttft_max_ms).toBeUndefined();
    expect(groups[0]!.tps_avg).toBeUndefined();
    expect(groups[0]!.tps_p50).toBeUndefined();
    expect(groups[0]!.duration_p50_ms).toBeDefined();
  });

  it("computes error rate", () => {
    const rows = [row(), row({ statusCode: 500 })];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    expect(groups[0]!.errors).toBe(1);
    expect(groups[0]!.error_rate).toBe(0.5);
  });

  it("produces 24 sparkline buckets", () => {
    const rows = [row({ timestamp: 100 }), row({ timestamp: 23_000 })];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    expect(groups[0]!.sparkline).toHaveLength(24);
    expect(groups[0]!.sparkline[0]).toBe(1);
    expect(groups[0]!.sparkline[23]).toBe(1);
  });

  it("sorts by requests desc and tracks last_seen", () => {
    const rows = [
      row({ backendId: "small", timestamp: 500 }),
      row({ backendId: "big" }),
      row({ backendId: "big", timestamp: 900 }),
    ];
    const groups = aggregateBreakdown(rows, "backend", rows.length, sinceMs, nowMs);
    expect(groups[0]!.key).toBe("big");
    expect(groups[0]!.last_seen).toBe(1000);
  });
});
