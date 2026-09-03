import type { FastifyInstance } from "fastify";
import { eq, desc, gte, lt, and, isNull, type SQL } from "drizzle-orm";
import {
  usageRollups,
  usageEvents,
  backends as backendsTable,
  apiKeys,
  vmodels,
  vmodelBackends,
} from "@haai/core";
import { registry } from "../../metrics.js";
import type { AppContext } from "../../context.js";
import type { ProbeSample } from "../../live-stats.js";

// ── Breakdown helpers (pure, exported for unit tests) ────────────────────────

export type BreakdownDimension = "backend" | "vmodel" | "backendModel";
export type BreakdownRow = {
  backendId: string | null;
  vmodelId: string | null;
  backendModelId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ttftMs: number | null;
  durationMs: number;
  tps: number | null;
  toolCallCount: number;
  statusCode: number;
  timestamp: number;
};

export interface BreakdownGroup {
  key: string;
  backendId?: string;
  vmodelId?: string;
  backendModelId?: string;
  requests: number;
  share: number;
  errors: number;
  error_rate: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tool_calls: number;
  ttft_p50_ms?: number;
  ttft_p95_ms?: number;
  ttft_max_ms?: number;
  duration_p50_ms?: number;
  duration_p95_ms?: number;
  tps_avg?: number;
  tps_p50?: number;
  tps_max?: number;
  last_seen: number;
  sparkline: number[];
}

/** Nearest-rank percentile over a pre-sorted ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[idx]!;
}

export function aggregateBreakdown(
  rows: BreakdownRow[],
  by: BreakdownDimension,
  totalRequests: number,
  sinceMs: number,
  nowMs: number,
): BreakdownGroup[] {
  const buckets = 24;
  const span = Math.max(1, nowMs - sinceMs);
  const groups = new Map<
    string,
    {
      rows: BreakdownRow[];
      ttft: number[];
      duration: number[];
      tps: number[];
      sparkline: number[];
      lastSeen: number;
    }
  >();

  for (const row of rows) {
    const key =
      by === "backend"
        ? (row.backendId ?? "unknown")
        : by === "vmodel"
          ? (row.vmodelId ?? "direct")
          : `${row.backendId ?? "unknown"}::${row.backendModelId ?? "unknown"}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        rows: [],
        ttft: [],
        duration: [],
        tps: [],
        sparkline: new Array<number>(buckets).fill(0),
        lastSeen: 0,
      };
      groups.set(key, group);
    }

    group.rows.push(row);
    if (row.ttftMs !== null) group.ttft.push(row.ttftMs);
    group.duration.push(row.durationMs);
    if (row.tps !== null) group.tps.push(row.tps);
    const bucketIdx = Math.min(
      buckets - 1,
      Math.max(0, Math.floor(((row.timestamp - sinceMs) / span) * buckets)),
    );
    group.sparkline[bucketIdx] = (group.sparkline[bucketIdx] ?? 0) + 1;
    if (row.timestamp > group.lastSeen) group.lastSeen = row.timestamp;
  }

  const result: BreakdownGroup[] = [];
  for (const [key, group] of groups) {
    const first = group.rows[0]!;
    const requests = group.rows.length;
    const errors = group.rows.filter((r) => r.statusCode >= 400).length;
    const out: BreakdownGroup = {
      key,
      requests,
      share: totalRequests > 0 ? requests / totalRequests : 0,
      errors,
      error_rate: requests > 0 ? errors / requests : 0,
      prompt_tokens: group.rows.reduce((s, r) => s + r.promptTokens, 0),
      completion_tokens: group.rows.reduce((s, r) => s + r.completionTokens, 0),
      total_tokens: group.rows.reduce((s, r) => s + r.totalTokens, 0),
      tool_calls: group.rows.reduce((s, r) => s + r.toolCallCount, 0),
      last_seen: group.lastSeen,
      sparkline: group.sparkline,
    };
    if (by === "backend" && first.backendId != null) out.backendId = first.backendId;
    if (by === "vmodel" && first.vmodelId != null) out.vmodelId = first.vmodelId;
    if (by === "backendModel") {
      if (first.backendId != null) out.backendId = first.backendId;
      if (first.backendModelId != null) out.backendModelId = first.backendModelId;
    }

    if (group.ttft.length > 0) {
      const sorted = [...group.ttft].sort((a, b) => a - b);
      out.ttft_p50_ms = percentile(sorted, 50);
      out.ttft_p95_ms = percentile(sorted, 95);
      out.ttft_max_ms = sorted[sorted.length - 1]!;
    }
    if (group.duration.length > 0) {
      const sorted = [...group.duration].sort((a, b) => a - b);
      out.duration_p50_ms = percentile(sorted, 50);
      out.duration_p95_ms = percentile(sorted, 95);
    }
    if (group.tps.length > 0) {
      const sorted = [...group.tps].sort((a, b) => a - b);
      out.tps_avg = group.tps.reduce((s, v) => s + v, 0) / group.tps.length;
      out.tps_p50 = percentile(sorted, 50);
      out.tps_max = sorted[sorted.length - 1]!;
    }
    result.push(out);
  }

  result.sort((a, b) => b.requests - a.requests);
  return result;
}

/** Zero-filled buckets for events-mode rollups. */
export function fillBuckets(
  period: "minute" | "5min" | "15min",
  sinceMs: number,
  nowMs: number,
  limit: number,
): Array<{ timestamp: string; requests: number; tokens: number; errors: number }> {
  const bucketMs = period === "minute" ? 60_000 : period === "5min" ? 300_000 : 900_000;
  const start = Math.floor(sinceMs / bucketMs) * bucketMs;
  const end = Math.floor(nowMs / bucketMs) * bucketMs;
  const out: Array<{ timestamp: string; requests: number; tokens: number; errors: number }> = [];
  for (let t = start; t <= end && out.length < limit; t += bucketMs) {
    out.push({ timestamp: new Date(t).toISOString(), requests: 0, tokens: 0, errors: 0 });
  }
  return out;
}

const SUB_HOUR_BUCKET_MS: Record<string, number> = {
  minute: 60_000,
  "5min": 300_000,
  "15min": 900_000,
};

function isSubHourPeriod(period: string): period is "minute" | "5min" | "15min" {
  return period in SUB_HOUR_BUCKET_MS;
}

function probeStatus(input: string | null | undefined): "healthy" | "degraded" | "unhealthy" {
  if (input === "degraded" || input === "unhealthy") return input;
  return "healthy";
}

interface MetricsFilters {
  keyId?: string;
  vmodelId?: string;
  backendId?: string;
  backendModelId?: string;
}

function parseSinceMs(since: string | undefined): number | undefined {
  if (!since) return undefined;
  if (/^\d+$/.test(since)) return parseInt(since, 10);
  const ms = Date.parse(since);
  return Number.isFinite(ms) ? ms : undefined;
}

function usageEventFilterConditions(filters: MetricsFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.keyId) conditions.push(eq(usageEvents.keyId, filters.keyId));
  if (filters.vmodelId) conditions.push(eq(usageEvents.vmodelId, filters.vmodelId));
  if (filters.backendId) conditions.push(eq(usageEvents.backendId, filters.backendId));
  if (filters.backendModelId) conditions.push(eq(usageEvents.backendModelId, filters.backendModelId));
  return conditions;
}

function bucketStartIso(period: string, timestampMs: number): string {
  const d = new Date(timestampMs);
  switch (period) {
    case "minute":
      d.setSeconds(0, 0);
      break;
    case "5min":
    case "15min": {
      const bucketMs = SUB_HOUR_BUCKET_MS[period]!;
      const floored = Math.floor(timestampMs / bucketMs) * bucketMs;
      return new Date(floored).toISOString();
    }
    case "hour":
      d.setMinutes(0, 0, 0);
      break;
    case "day":
      d.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      break;
    default:
      break;
  }
  return d.toISOString();
}

function singleRollupDimension(
  filters: MetricsFilters,
  period: string,
): "key" | "vmodel" | "backend" | "global" | "events" {
  if (isSubHourPeriod(period)) return "events";
  const dims = [filters.keyId, filters.vmodelId, filters.backendId].filter(Boolean).length;
  if (filters.backendModelId || dims > 1) return "events";
  if (filters.keyId) return "key";
  if (filters.vmodelId) return "vmodel";
  if (filters.backendId) return "backend";
  return "global";
}

type EventAggRow = {
  timestamp: number;
  totalTokens: number;
  statusCode: number;
  durationMs: number;
  ttftMs: number | null;
  tps: number | null;
};

function aggregateEventsToRollups(
  events: EventAggRow[],
  period: string,
  limit: number,
): Array<{
  timestamp: string;
  requests: number;
  tokens: number;
  errors: number;
  avg_latency_ms?: number;
}> {
  const buckets = new Map<
    string,
    { requests: number; tokens: number; errors: number; durationSum: number }
  >();

  for (const event of events) {
    const bucket = bucketStartIso(period, event.timestamp);
    const existing = buckets.get(bucket) ?? { requests: 0, tokens: 0, errors: 0, durationSum: 0 };
    existing.requests += 1;
    existing.tokens += event.totalTokens;
    if (event.statusCode >= 400) existing.errors += 1;
    existing.durationSum += event.durationMs;
    buckets.set(bucket, existing);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([timestamp, row]) => {
      const out: {
        timestamp: string;
        requests: number;
        tokens: number;
        errors: number;
        avg_latency_ms?: number;
      } = {
        timestamp,
        requests: row.requests,
        tokens: row.tokens,
        errors: row.errors,
      };
      if (row.requests > 0) out.avg_latency_ms = row.durationSum / row.requests;
      return out;
    });
}

export async function metricsApiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Prometheus metrics endpoint (standard scrape path)
  if (ctx.config.metrics.enabled) {
    app.get("/metrics", async (_req, reply) => {
      const metrics = await registry.metrics();
      return reply.header("Content-Type", registry.contentType).send(metrics);
    });
  }

  // Global stats summary
  app.get<{
    Querystring: MetricsFilters & { since?: string };
  }>("/api/v1/metrics/summary", async (req) => {
    const filters: MetricsFilters = {
      ...(req.query.keyId ? { keyId: req.query.keyId } : {}),
      ...(req.query.vmodelId ? { vmodelId: req.query.vmodelId } : {}),
      ...(req.query.backendId ? { backendId: req.query.backendId } : {}),
      ...(req.query.backendModelId ? { backendModelId: req.query.backendModelId } : {}),
    };

    const since = parseSinceMs(req.query.since) ?? Date.now() - 86400 * 1000;
    const eventConditions = [gte(usageEvents.timestamp, since), ...usageEventFilterConditions(filters)];
    const events = await ctx.db.db
      .select()
      .from(usageEvents)
      .where(and(...eventConditions))
      .all();

    const totalRequests = events.length;
    const totalTokens = events.reduce((s, e) => s + e.totalTokens, 0);
    const errorRate = totalRequests > 0 ? events.filter((e) => e.statusCode >= 400).length / totalRequests : 0;
    const ttftEvents = events.filter((e) => e.ttftMs !== null);
    const tpsEvents = events.filter((e) => e.tps !== null);
    const avgTtft =
      ttftEvents.length > 0
        ? ttftEvents.reduce((s, e) => s + (e.ttftMs ?? 0), 0) / ttftEvents.length
        : undefined;
    const avgTps =
      tpsEvents.length > 0 ? tpsEvents.reduce((s, e) => s + (e.tps ?? 0), 0) / tpsEvents.length : undefined;

    const sortedTtft = ttftEvents.map((e) => e.ttftMs ?? 0).sort((a, b) => a - b);
    const sortedDuration = events.map((e) => e.durationMs).sort((a, b) => a - b);
    const sortedTps = tpsEvents.map((e) => e.tps ?? 0).sort((a, b) => a - b);

    const previousWindowMs = Date.now() - since;
    const prevConditions = [
      gte(usageEvents.timestamp, since - previousWindowMs),
      lt(usageEvents.timestamp, since),
      ...usageEventFilterConditions(filters),
    ];
    const prevEvents = await ctx.db.db
      .select({
        totalTokens: usageEvents.totalTokens,
        statusCode: usageEvents.statusCode,
        ttftMs: usageEvents.ttftMs,
        tps: usageEvents.tps,
      })
      .from(usageEvents)
      .where(and(...prevConditions))
      .all();

    const prevTotalRequests = prevEvents.length;
    const prevTotalTokens = prevEvents.reduce((s, e) => s + e.totalTokens, 0);
    const prevErrorRate =
      prevTotalRequests > 0 ? prevEvents.filter((e) => e.statusCode >= 400).length / prevTotalRequests : 0;
    const prevTtftEvents = prevEvents.filter((e) => e.ttftMs !== null);
    const prevTpsEvents = prevEvents.filter((e) => e.tps !== null);
    const prevAvgTtft =
      prevTtftEvents.length > 0
        ? prevTtftEvents.reduce((s, e) => s + (e.ttftMs ?? 0), 0) / prevTtftEvents.length
        : undefined;
    const prevAvgTps =
      prevTpsEvents.length > 0
        ? prevTpsEvents.reduce((s, e) => s + (e.tps ?? 0), 0) / prevTpsEvents.length
        : undefined;

    const previous: {
      total_requests: number;
      total_tokens: number;
      error_rate: number;
      avg_ttft_ms?: number;
      avg_tps?: number;
    } = {
      total_requests: prevTotalRequests,
      total_tokens: prevTotalTokens,
      error_rate: prevErrorRate,
    };
    if (prevAvgTtft !== undefined) previous.avg_ttft_ms = prevAvgTtft;
    if (prevAvgTps !== undefined) previous.avg_tps = prevAvgTps;

    const summary: Record<string, unknown> = {
      total_requests_24h: totalRequests,
      total_tokens_24h: totalTokens,
      error_rate_24h: errorRate,
      avg_ttft_ms: avgTtft,
      avg_tps: avgTps,
    };
    if (sortedTtft.length > 0) {
      summary.p50_ttft_ms = percentile(sortedTtft, 50);
      summary.p95_ttft_ms = percentile(sortedTtft, 95);
    }
    if (sortedDuration.length > 0) {
      summary.p50_duration_ms = percentile(sortedDuration, 50);
      summary.p95_duration_ms = percentile(sortedDuration, 95);
    }
    if (sortedTps.length > 0) {
      summary.p50_tps = percentile(sortedTps, 50);
      summary.max_tps = sortedTps[sortedTps.length - 1]!;
    }
    summary.previous = previous;

    const allBackendRows = await ctx.db.db.select().from(backendsTable).all();
    const backendRows = filters.backendId
      ? allBackendRows.filter((b) => b.id === filters.backendId)
      : allBackendRows;
    const backendNameById = new Map(
      allBackendRows.map((b) => [b.id, b.displayName || b.name] as const),
    );

    let vmodelRows = await ctx.db.db.select().from(vmodels).all();
    if (filters.vmodelId) {
      vmodelRows = vmodelRows.filter((vm) => vm.id === filters.vmodelId);
    }
    const mappingRows = await ctx.db.db.select().from(vmodelBackends).all();
    const mappingsByVmodel = new Map<string, typeof mappingRows>();
    for (const m of mappingRows) {
      if (filters.backendId && m.backendId !== filters.backendId) continue;
      if (filters.backendModelId && m.backendModelId !== filters.backendModelId) continue;
      const list = mappingsByVmodel.get(m.vmodelId) ?? [];
      list.push(m);
      mappingsByVmodel.set(m.vmodelId, list);
    }

    return {
      ...summary,
      backends: backendRows.map((b) => {
        const entry: {
          id: string;
          name: string;
          health: "healthy" | "degraded" | "unhealthy" | "unknown";
          enabled: boolean;
          latency_ms?: number;
          error?: string;
          checked_at?: number;
        } = {
          id: b.id,
          name: b.displayName || b.name,
          health: (b.lastHealthStatus ?? "unknown") as "healthy" | "degraded" | "unhealthy" | "unknown",
          enabled: b.enabled,
        };
        if (b.lastLatencyMs != null) entry.latency_ms = b.lastLatencyMs;
        if (b.lastHealthError) entry.error = b.lastHealthError;
        if (b.lastHealthCheck != null) entry.checked_at = b.lastHealthCheck;
        return entry;
      }),
      vmodels: vmodelRows.map((vm) => {
        const mappings = (mappingsByVmodel.get(vm.id) ?? [])
          .filter((m) => m.enabled)
          .map((m) => {
            const mapping: {
              id: string;
              backendId: string;
              backendName: string;
              backendModelId: string;
              available: boolean | null;
              reason?: string;
            } = {
              id: m.id,
              backendId: m.backendId,
              backendName: backendNameById.get(m.backendId) ?? m.backendId,
              backendModelId: m.backendModelId,
              available: m.lastAvailable,
            };
            if (m.unavailableReason) mapping.reason = m.unavailableReason;
            return mapping;
          });

        const entry: {
          id: string;
          name: string;
          modelId: string;
          health: "healthy" | "degraded" | "unhealthy" | "unknown";
          enabled: boolean;
          error?: string;
          checked_at?: number;
          mappings: typeof mappings;
        } = {
          id: vm.id,
          name: vm.displayName || vm.modelId,
          modelId: vm.modelId,
          health: (vm.lastHealthStatus ?? "unknown") as
            | "healthy"
            | "degraded"
            | "unhealthy"
            | "unknown",
          enabled: vm.enabled,
          mappings,
        };
        if (vm.lastHealthError) entry.error = vm.lastHealthError;
        if (vm.lastHealthCheck != null) entry.checked_at = vm.lastHealthCheck;
        return entry;
      }),
    };
  });

  // Time series rollups
  app.get<{
    Querystring: MetricsFilters & {
      period?: string;
      since?: string;
      limit?: string;
    };
  }>("/api/v1/metrics/rollups", async (req) => {
    const {
      period = "hour",
      keyId,
      vmodelId,
      backendId,
      backendModelId,
      since,
      limit = "48",
    } = req.query;
    const limitN = parseInt(limit, 10);
    const filters: MetricsFilters = {
      ...(keyId ? { keyId } : {}),
      ...(vmodelId ? { vmodelId } : {}),
      ...(backendId ? { backendId } : {}),
      ...(backendModelId ? { backendModelId } : {}),
    };

    const mode = singleRollupDimension(filters, period);

    if (mode === "events") {
      const limitN2 = limitN;
      const defaultSince = isSubHourPeriod(period)
        ? Date.now() - limitN2 * SUB_HOUR_BUCKET_MS[period]!
        : Date.now() - 48 * 3600 * 1000;
      const sinceMs = parseSinceMs(since) ?? defaultSince;
      const conditions = [gte(usageEvents.timestamp, sinceMs), ...usageEventFilterConditions(filters)];
      const events = await ctx.db.db
        .select({
          timestamp: usageEvents.timestamp,
          totalTokens: usageEvents.totalTokens,
          statusCode: usageEvents.statusCode,
          durationMs: usageEvents.durationMs,
          ttftMs: usageEvents.ttftMs,
          tps: usageEvents.tps,
        })
        .from(usageEvents)
        .where(and(...conditions))
        .all();
      const aggregated = aggregateEventsToRollups(events, period, limitN2);

      // Zero-fill gaps so charts don't skip empty buckets (events mode only).
      if (isSubHourPeriod(period)) {
        const byTimestamp = new Map(aggregated.map((r) => [r.timestamp, r]));
        const filled = fillBuckets(period, sinceMs, Date.now(), limitN2).map((empty) => {
          const row = byTimestamp.get(empty.timestamp);
          if (!row) return empty;
          const merged: typeof empty & { avg_latency_ms?: number } = {
            timestamp: row.timestamp,
            requests: row.requests,
            tokens: row.tokens,
            errors: row.errors,
          };
          if (row.avg_latency_ms !== undefined) merged.avg_latency_ms = row.avg_latency_ms;
          return merged;
        });
        return filled;
      }
      return aggregated;
    }

    const conditions = [eq(usageRollups.period, period)];
    if (mode === "key" && keyId) {
      conditions.push(eq(usageRollups.keyId, keyId));
    } else if (mode === "vmodel" && vmodelId) {
      conditions.push(eq(usageRollups.vmodelId, vmodelId));
    } else if (mode === "backend" && backendId) {
      conditions.push(eq(usageRollups.backendId, backendId));
    } else {
      // Unfiltered charts use the global (undimensioned) rollup series only.
      // Per-key/vmodel/backend rows would otherwise appear as separate bars and inflate volume.
      conditions.push(isNull(usageRollups.keyId));
      conditions.push(isNull(usageRollups.vmodelId));
      conditions.push(isNull(usageRollups.backendId));
    }

    if (since) {
      const sinceBucket = /^\d+$/.test(since) ? new Date(parseInt(since, 10)).toISOString() : since;
      conditions.push(gte(usageRollups.bucket, sinceBucket));
    }

    const rows = await ctx.db.db
      .select()
      .from(usageRollups)
      .where(and(...conditions))
      .orderBy(desc(usageRollups.bucket))
      .limit(limitN)
      .all();

    return rows.reverse().map((row) => ({
      timestamp: row.bucket,
      requests: row.requestCount,
      tokens: row.totalTokens,
      errors: row.errorCount,
      avg_latency_ms: row.avgDurationMs ?? undefined,
    }));
  });

  // Recent events
  app.get<{
    Querystring: MetricsFilters & { limit?: string; since?: string; errorsOnly?: string };
  }>("/api/v1/metrics/events", async (req) => {
    const { limit = "100", since, keyId, vmodelId, backendId, backendModelId, errorsOnly } = req.query;
    const filters: MetricsFilters = {
      ...(keyId ? { keyId } : {}),
      ...(vmodelId ? { vmodelId } : {}),
      ...(backendId ? { backendId } : {}),
      ...(backendModelId ? { backendModelId } : {}),
    };

    const conditions = usageEventFilterConditions(filters);
    if (since) conditions.push(gte(usageEvents.timestamp, parseInt(since, 10)));
    if (errorsOnly === "true") conditions.push(gte(usageEvents.statusCode, 400));

    const rows = await ctx.db.db
      .select({
        id: usageEvents.id,
        keyPrefix: apiKeys.prefix,
        vmodel: vmodels.modelId,
        backendId: usageEvents.backendId,
        backendDisplayName: backendsTable.displayName,
        backendName: backendsTable.name,
        backendModelId: usageEvents.backendModelId,
        endpoint: usageEvents.endpoint,
        statusCode: usageEvents.statusCode,
        totalTokens: usageEvents.totalTokens,
        promptTokens: usageEvents.promptTokens,
        completionTokens: usageEvents.completionTokens,
        ttftMs: usageEvents.ttftMs,
        durationMs: usageEvents.durationMs,
        tps: usageEvents.tps,
        error: usageEvents.error,
        timestamp: usageEvents.timestamp,
      })
      .from(usageEvents)
      .leftJoin(apiKeys, eq(usageEvents.keyId, apiKeys.id))
      .leftJoin(vmodels, eq(usageEvents.vmodelId, vmodels.id))
      .leftJoin(backendsTable, eq(usageEvents.backendId, backendsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(usageEvents.timestamp))
      .limit(parseInt(limit, 10))
      .all();

    return rows.map((row) => {
      const out: {
        id: string;
        keyPrefix: string | null;
        vmodel: string;
        backendId?: string;
        backendName?: string;
        endpoint: string;
        statusCode: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
        ttftMs?: number;
        durationMs: number;
        tps: number | null;
        error: string | null;
        timestamp: number;
      } = {
        id: row.id,
        keyPrefix: row.keyPrefix,
        vmodel: row.vmodel ?? row.backendModelId ?? "unknown",
        endpoint: row.endpoint,
        statusCode: row.statusCode,
        totalTokens: row.totalTokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        durationMs: row.durationMs,
        tps: row.tps,
        error: row.error,
        timestamp: row.timestamp,
      };
      if (row.backendId != null) out.backendId = row.backendId;
      if (row.backendId != null) {
        out.backendName = row.backendDisplayName || row.backendName || row.backendId;
      }
      if (row.ttftMs !== null) out.ttftMs = row.ttftMs;
      return out;
    });
  });

  // Live operations snapshot (in-memory tracker)
  app.get("/api/v1/metrics/live", async () => {
    const snapshot = ctx.live.snapshot();
    const allBackends = await ctx.db.db.select().from(backendsTable).all();
    const infoById = new Map(
      allBackends.map(
        (b) =>
          [
            b.id,
            {
              name: b.displayName || b.name,
              maxConcurrency: b.maxConcurrency,
              enabled: b.enabled,
              lastHealthStatus: (b.lastHealthStatus ?? null) as
                | "healthy"
                | "degraded"
                | "unhealthy"
                | null,
            },
          ] as const,
      ),
    );

    return {
      now: snapshot.now,
      startedAt: snapshot.startedAt,
      series: snapshot.series,
      inFlight: snapshot.inFlight,
      inFlightTotal: snapshot.inFlightTotal,
      backends: snapshot.backends.map((b) => {
        const info = infoById.get(b.backendId);
        const out: {
          backendId: string;
          backendName: string;
          concurrency: number;
          circuit: "closed" | "open" | "half-open";
          probes: ProbeSample[];
          max_concurrency?: number;
          enabled?: boolean;
          lastHealthStatus?: "healthy" | "degraded" | "unhealthy" | "unknown";
        } = {
          backendId: b.backendId,
          backendName: info?.name ?? b.backendId,
          concurrency: b.concurrency,
          circuit: b.circuit,
          probes: b.probes,
        };
        if (info?.maxConcurrency != null) out.max_concurrency = info.maxConcurrency;
        if (info) out.enabled = info.enabled;
        out.lastHealthStatus = info?.lastHealthStatus ?? "unknown";
        return out;
      }),
    };
  });

  // Per-backend / per-model performance breakdown with percentiles
  app.get<{
    Querystring: MetricsFilters & { by?: string; since?: string };
  }>("/api/v1/metrics/breakdown", async (req, reply) => {
    const { by = "backend", since, keyId, vmodelId, backendId, backendModelId } = req.query;
    if (by !== "backend" && by !== "vmodel" && by !== "backendModel") {
      return reply.status(400).send({
        error: { message: `Invalid 'by' value: '${by}'. Expected backend | vmodel | backendModel` },
      });
    }
    const byDimension: BreakdownDimension = by;

    const now = Date.now();
    const sinceMs = parseSinceMs(since) ?? now - 86400 * 1000;
    const filters: MetricsFilters = {
      ...(keyId ? { keyId } : {}),
      ...(vmodelId ? { vmodelId } : {}),
      ...(backendId ? { backendId } : {}),
      ...(backendModelId ? { backendModelId } : {}),
    };

    const conditions = [gte(usageEvents.timestamp, sinceMs), ...usageEventFilterConditions(filters)];
    const rows = await ctx.db.db
      .select({
        backendId: usageEvents.backendId,
        vmodelId: usageEvents.vmodelId,
        backendModelId: usageEvents.backendModelId,
        promptTokens: usageEvents.promptTokens,
        completionTokens: usageEvents.completionTokens,
        totalTokens: usageEvents.totalTokens,
        ttftMs: usageEvents.ttftMs,
        durationMs: usageEvents.durationMs,
        tps: usageEvents.tps,
        toolCallCount: usageEvents.toolCallCount,
        statusCode: usageEvents.statusCode,
        timestamp: usageEvents.timestamp,
      })
      .from(usageEvents)
      .where(and(...conditions))
      .all();

    const totalRequests = rows.length;
    const groups = aggregateBreakdown(rows, byDimension, totalRequests, sinceMs, now);

    // Resolve display names
    const backendRows = await ctx.db.db.select().from(backendsTable).all();
    const vmodelRows = await ctx.db.db.select().from(vmodels).all();
    const backendNameById = new Map(
      backendRows.map((b) => [b.id, b.displayName || b.name] as const),
    );
    const vmodelNameById = new Map(
      vmodelRows.map((vm) => [vm.id, vm.displayName || vm.modelId] as const),
    );

    const withNames = groups.map((group) => {
      let name = group.key;
      if (byDimension === "backend") {
        name = group.backendId
          ? (backendNameById.get(group.backendId) ?? "(deleted)")
          : "(deleted)";
      } else if (byDimension === "vmodel") {
        name =
          group.key === "direct"
            ? "Direct"
            : group.vmodelId
              ? (vmodelNameById.get(group.vmodelId) ?? "(deleted)")
              : "(deleted)";
      } else {
        const parts = [backendNameById.get(group.backendId ?? "") ?? "(deleted)", group.backendModelId ?? "(deleted)"];
        name = parts.join(" / ");
      }
      return { ...group, name };
    });

    return { by: byDimension, since: sinceMs, groups: withNames };
  });
}
