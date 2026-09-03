import { nanoid } from "nanoid";
import type { SseEmitter } from "./sse.js";
import type { BackendBalancer } from "./balancer.js";
import type { CircuitState } from "./circuit-breaker.js";

export type RequestPhase =
  | "connecting"
  | "waiting_first_token"
  | "streaming"
  | "buffering";

export interface InFlightRequest {
  id: string;
  keyPrefix: string;
  vmodelId: string | null;
  vmodelName: string;
  backendId: string;
  backendName: string;
  backendModelId: string;
  stream: boolean;
  startedAt: number;
  firstTokenAt: number | null;
  completionTokens: number;
  attempt: number;
}

export interface LivePoint {
  t: number;
  completed: number;
  errors: number;
  tokens: number;
  inFlight: number;
}

export interface ProbeSample {
  t: number;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
}

export interface LiveBackendEntry {
  backendId: string;
  concurrency: number;
  circuit: CircuitState;
  probes: ProbeSample[];
}

export interface LiveSnapshot {
  now: number;
  startedAt: number;
  inFlight: InFlightRequest[];
  inFlightTotal: number;
  series: LivePoint[];
  backends: LiveBackendEntry[];
}

export interface LiveTickPayload {
  point: LivePoint;
  inFlight: InFlightRequest[];
  inFlightTotal: number;
  backends: Array<{ backendId: string; concurrency: number; circuit: CircuitState }>;
}

const MAX_POINTS = 600;
const MAX_INFLIGHT_SNAPSHOT = 50;
const MAX_PROBES = 120;
const ORPHAN_MAX_AGE_MS = 10 * 60 * 1000;
const TICK_MS = 1000;

function secondAligned(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

export class LiveStatsTracker {
  private readonly startedAt = Date.now();
  private entries = new Map<string, InFlightRequest>();
  private series: LivePoint[] = [];
  private probes = new Map<string, ProbeSample[]>();
  private completedThisSecond = 0;
  private errorsThisSecond = 0;
  private tokensThisSecond = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sse?: SseEmitter,
    private readonly balancer?: BackendBalancer,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  startRequest(
    req: Omit<InFlightRequest, "id" | "startedAt" | "firstTokenAt" | "completionTokens">,
  ): string {
    const entry: InFlightRequest = {
      ...req,
      id: nanoid(12),
      startedAt: Date.now(),
      firstTokenAt: null,
      completionTokens: 0,
    };
    this.entries.set(entry.id, entry);
    this.sse?.broadcast("request-start", entry);
    return entry.id;
  }

  firstToken(id: string): void {
    const entry = this.entries.get(id);
    if (entry && entry.firstTokenAt === null) {
      entry.firstTokenAt = Date.now();
    }
  }

  progress(id: string, completionTokensSoFar: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const delta = Math.max(0, completionTokensSoFar - entry.completionTokens);
    entry.completionTokens = completionTokensSoFar;
    this.tokensThisSecond += delta;
  }

  end(id: string, result: { statusCode: number; durationMs: number }): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.completedThisSecond += 1;
    if (result.statusCode >= 400) this.errorsThisSecond += 1;
    this.sse?.broadcast("request-end", {
      id,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      backendId: entry.backendId,
    });
  }

  recordProbe(backendId: string, sample: ProbeSample): void {
    const list = this.probes.get(backendId) ?? [];
    list.push(sample);
    if (list.length > MAX_PROBES) list.splice(0, list.length - MAX_PROBES);
    this.probes.set(backendId, list);
  }

  /** Push the current second's counters into the ring buffer and broadcast. */
  tick(): void {
    const now = Date.now();
    this.sweepOrphans(now);

    const point: LivePoint = {
      t: secondAligned(now),
      completed: this.completedThisSecond,
      errors: this.errorsThisSecond,
      tokens: this.tokensThisSecond,
      inFlight: this.entries.size,
    };
    this.completedThisSecond = 0;
    this.errorsThisSecond = 0;
    this.tokensThisSecond = 0;

    this.series.push(point);
    if (this.series.length > MAX_POINTS) {
      this.series.splice(0, this.series.length - MAX_POINTS);
    }

    if (this.sse && this.sse.clientCount > 0) {
      const inFlight = this.inFlightCapped();
      const backends = [...this.balancer?.getAllConcurrency().keys() ?? []].map((backendId) => ({
        backendId,
        concurrency: this.balancer?.getConcurrency(backendId) ?? 0,
        circuit: this.balancer?.getCircuitState(backendId) ?? "closed",
      }));
      this.sse.broadcast("live-tick", {
        point,
        inFlight,
        inFlightTotal: this.entries.size,
        backends,
      } satisfies LiveTickPayload);
    }
  }

  snapshot(): LiveSnapshot {
    const now = Date.now();
    this.sweepOrphans(now);

    const backendIds = new Set<string>([
      ...(this.balancer?.getAllConcurrency().keys() ?? []),
      ...this.probes.keys(),
    ]);

    return {
      now,
      startedAt: this.startedAt,
      inFlight: this.inFlightCapped(),
      inFlightTotal: this.entries.size,
      series: [...this.series],
      backends: [...backendIds].map((backendId) => ({
        backendId,
        concurrency: this.balancer?.getConcurrency(backendId) ?? 0,
        circuit: this.balancer?.getCircuitState(backendId) ?? "closed",
        probes: [...(this.probes.get(backendId) ?? [])],
      })),
    };
  }

  private inFlightCapped(): InFlightRequest[] {
    const all = [...this.entries.values()];
    return all.slice(Math.max(0, all.length - MAX_INFLIGHT_SNAPSHOT));
  }

  private sweepOrphans(now: number): void {
    for (const entry of this.entries.values()) {
      if (now - entry.startedAt > ORPHAN_MAX_AGE_MS) {
        this.end(entry.id, { statusCode: 0, durationMs: now - entry.startedAt });
      }
    }
  }
}
