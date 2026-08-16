import type { FastifyInstance } from "fastify";
import { eq, desc, gte, and } from "drizzle-orm";
import { usageRollups, usageEvents, backends as backendsTable, apiKeys, vmodels } from "@ai-v-models/core";
import { registry } from "../../metrics.js";
import type { AppContext } from "../../context.js";

export async function metricsApiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Prometheus metrics endpoint (standard scrape path)
  if (ctx.config.metrics.enabled) {
    app.get("/metrics", async (_req, reply) => {
      const metrics = await registry.metrics();
      return reply.header("Content-Type", registry.contentType).send(metrics);
    });
  }

  // Global stats summary
  app.get("/api/v1/metrics/summary", async () => {
    const since = Date.now() - 86400 * 1000; // last 24h
    const events = await ctx.db.db
      .select()
      .from(usageEvents)
      .where(gte(usageEvents.timestamp, since))
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

    const backendRows = await ctx.db.db.select().from(backendsTable).all();

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
    };
  });

  // Time series rollups
  app.get<{
    Querystring: {
      period?: string;
      keyId?: string;
      vmodelId?: string;
      backendId?: string;
      since?: string;
      limit?: string;
    };
  }>("/api/v1/metrics/rollups", async (req) => {
    const { period = "hour", keyId, vmodelId, backendId, since, limit = "48" } = req.query;

    const conditions = [eq(usageRollups.period, period)];
    if (keyId) conditions.push(eq(usageRollups.keyId, keyId));
    if (vmodelId) conditions.push(eq(usageRollups.vmodelId, vmodelId));
    if (backendId) conditions.push(eq(usageRollups.backendId, backendId));

    const rows = await ctx.db.db
      .select()
      .from(usageRollups)
      .where(and(...conditions))
      .orderBy(desc(usageRollups.bucket))
      .limit(parseInt(limit, 10))
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
  app.get<{ Querystring: { limit?: string; since?: string; keyId?: string; vmodelId?: string } }>(
    "/api/v1/metrics/events",
    async (req) => {
      const { limit = "100", since, keyId, vmodelId } = req.query;

      const conditions = [];
      if (since) conditions.push(gte(usageEvents.timestamp, parseInt(since, 10)));
      if (keyId) conditions.push(eq(usageEvents.keyId, keyId));
      if (vmodelId) conditions.push(eq(usageEvents.vmodelId, vmodelId));

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
    },
  );
}
