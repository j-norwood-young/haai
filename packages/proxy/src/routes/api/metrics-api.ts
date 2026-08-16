import type { FastifyInstance } from "fastify";
import { eq, desc, gte, and, isNull, type SQL } from "drizzle-orm";
import {
  usageRollups,
  usageEvents,
  backends as backendsTable,
  apiKeys,
  vmodels,
  vmodelBackends,
} from "@ai-v-models/core";
import { registry } from "../../metrics.js";
import type { AppContext } from "../../context.js";

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

function singleRollupDimension(filters: MetricsFilters): "key" | "vmodel" | "backend" | "global" | "events" {
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
    Querystring: MetricsFilters;
  }>("/api/v1/metrics/summary", async (req) => {
    const filters: MetricsFilters = {
      ...(req.query.keyId ? { keyId: req.query.keyId } : {}),
      ...(req.query.vmodelId ? { vmodelId: req.query.vmodelId } : {}),
      ...(req.query.backendId ? { backendId: req.query.backendId } : {}),
      ...(req.query.backendModelId ? { backendModelId: req.query.backendModelId } : {}),
    };

    const since = Date.now() - 86400 * 1000; // last 24h
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
      total_requests_24h: totalRequests,
      total_tokens_24h: totalTokens,
      error_rate_24h: errorRate,
      avg_ttft_ms: avgTtft,
      avg_tps: avgTps,
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

    const mode = singleRollupDimension(filters);

    if (mode === "events") {
      const sinceMs = parseSinceMs(since) ?? Date.now() - 48 * 3600 * 1000;
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
      return aggregateEventsToRollups(events, period, limitN);
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
    Querystring: MetricsFilters & { limit?: string; since?: string };
  }>("/api/v1/metrics/events", async (req) => {
    const { limit = "100", since, keyId, vmodelId, backendId, backendModelId } = req.query;
    const filters: MetricsFilters = {
      ...(keyId ? { keyId } : {}),
      ...(vmodelId ? { vmodelId } : {}),
      ...(backendId ? { backendId } : {}),
      ...(backendModelId ? { backendModelId } : {}),
    };

    const conditions = usageEventFilterConditions(filters);
    if (since) conditions.push(gte(usageEvents.timestamp, parseInt(since, 10)));

    const rows = await ctx.db.db
      .select({
        id: usageEvents.id,
        keyPrefix: apiKeys.prefix,
        vmodel: vmodels.modelId,
        backendModelId: usageEvents.backendModelId,
        endpoint: usageEvents.endpoint,
        statusCode: usageEvents.statusCode,
        totalTokens: usageEvents.totalTokens,
        durationMs: usageEvents.durationMs,
        tps: usageEvents.tps,
        error: usageEvents.error,
        timestamp: usageEvents.timestamp,
      })
      .from(usageEvents)
      .leftJoin(apiKeys, eq(usageEvents.keyId, apiKeys.id))
      .leftJoin(vmodels, eq(usageEvents.vmodelId, vmodels.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(usageEvents.timestamp))
      .limit(parseInt(limit, 10))
      .all();

    return rows.map((row) => ({
      id: row.id,
      keyPrefix: row.keyPrefix,
      vmodel: row.vmodel ?? row.backendModelId ?? "unknown",
      endpoint: row.endpoint,
      statusCode: row.statusCode,
      totalTokens: row.totalTokens,
      durationMs: row.durationMs,
      tps: row.tps,
      error: row.error,
      timestamp: row.timestamp,
    }));
  });
}
