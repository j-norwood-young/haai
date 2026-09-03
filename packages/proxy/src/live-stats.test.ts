import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiveStatsTracker } from "./live-stats.js";
import type { SseEmitter } from "./sse.js";

interface MockSse {
  emitter: SseEmitter;
  events: Array<{ type: string; data: unknown }>;
  setClientCount(n: number): void;
}

function mockSse(): MockSse {
  const events: Array<{ type: string; data: unknown }> = [];
  let clients = 0;
  const emitter = {
    broadcast: (type: string, data: unknown) => {
      events.push({ type, data });
    },
    get clientCount() {
      return clients;
    },
  } as unknown as SseEmitter;
  return { emitter, events, setClientCount: (n: number) => (clients = n) };
}

function baseReq(overrides: Record<string, unknown> = {}) {
  return {
    keyPrefix: "sk_abc",
    vmodelId: "vm-1",
    vmodelName: "smart-chat",
    backendId: "backend-1",
    backendName: "Backend One",
    backendModelId: "gpt-x",
    stream: true,
    attempt: 1,
    ...overrides,
  };
}

describe("LiveStatsTracker", () => {
  let sse: MockSse;
  let tracker: LiveStatsTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    sse = mockSse();
    tracker = new LiveStatsTracker(sse.emitter);
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  it("tracks start/progress/end lifecycle and emits request events", () => {
    const id = tracker.startRequest(baseReq());
    expect(tracker.snapshot().inFlightTotal).toBe(1);

    tracker.progress(id, 5);
    tracker.progress(id, 9);

    tracker.end(id, { statusCode: 200, durationMs: 1234 });
    expect(tracker.snapshot().inFlightTotal).toBe(0);

    const types = sse.events.map((e) => e.type);
    expect(types).toContain("request-start");
    expect(types).toContain("request-end");
    const endEvent = sse.events.find((e) => e.type === "request-end");
    expect(endEvent?.data).toMatchObject({ id, statusCode: 200, durationMs: 1234, backendId: "backend-1" });
  });

  it("firstToken is recorded once", () => {
    const id = tracker.startRequest(baseReq());
    tracker.firstToken(id);
    const snap1 = tracker.snapshot().inFlight[0]!;
    tracker.firstToken(id);
    const snap2 = tracker.snapshot().inFlight[0]!;
    expect(snap1.firstTokenAt).toBe(snap2.firstTokenAt);
    expect(snap1.firstTokenAt).not.toBeNull();
  });

  it("accumulates token deltas into the current second", () => {
    const id = tracker.startRequest(baseReq());
    tracker.progress(id, 3);
    tracker.progress(id, 7);
    tracker.progress(id, 7); // no delta
    tracker.tick();

    const series = tracker.snapshot().series;
    expect(series).toHaveLength(1);
    expect(series[0]!.tokens).toBe(7);
    expect(series[0]!.inFlight).toBe(1);
  });

  it("increments completed/errors on tick", () => {
    const id1 = tracker.startRequest(baseReq());
    tracker.end(id1, { statusCode: 200, durationMs: 10 });
    const id2 = tracker.startRequest(baseReq());
    tracker.end(id2, { statusCode: 500, durationMs: 10 });
    tracker.tick();
    const point = tracker.snapshot().series[0]!;
    expect(point.completed).toBe(2);
    expect(point.errors).toBe(1);
  });

  it("ring buffer caps at 600 points", () => {
    for (let i = 0; i < 610; i++) tracker.tick();
    expect(tracker.snapshot().series).toHaveLength(600);
  });

  it("sweeps orphan requests older than 10 minutes", () => {
    tracker.startRequest(baseReq());
    vi.advanceTimersByTime(11 * 60 * 1000);
    tracker.tick();
    expect(tracker.snapshot().inFlightTotal).toBe(0);
    const endEvent = sse.events.find((e) => e.type === "request-end");
    expect(endEvent?.data).toMatchObject({ statusCode: 0 });
  });

  it("caps probes at 120 per backend", () => {
    for (let i = 0; i < 130; i++) {
      tracker.recordProbe("backend-1", { t: i, status: "healthy", latencyMs: 10 });
    }
    const snap = tracker.snapshot();
    expect(snap.backends).toHaveLength(1);
    expect(snap.backends[0]!.probes).toHaveLength(120);
    expect(snap.backends[0]!.probes[0]!.t).toBe(10);
  });

  it("snapshot returns capped in-flight list with totals", () => {
    for (let i = 0; i < 60; i++) {
      tracker.startRequest(baseReq({ backendId: `b-${i}` }));
    }
    const snap = tracker.snapshot();
    expect(snap.inFlightTotal).toBe(60);
    expect(snap.inFlight).toHaveLength(50);
  });

  it("tick emits live-tick only when there are SSE clients", () => {
    tracker.start();
    sse.setClientCount(0);
    tracker.tick();
    expect(sse.events.some((e) => e.type === "live-tick")).toBe(false);

    sse.setClientCount(2);
    tracker.tick();
    const tickEvent = sse.events.find((e) => e.type === "live-tick");
    expect(tickEvent).toBeDefined();
    expect(tickEvent?.data).toMatchObject({ inFlightTotal: 0 });
  });
});
