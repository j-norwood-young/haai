import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { DbClient } from "@ai-v-models/core";
import { usageEvents, usageRollups, requestLogs, apiKeys } from "@ai-v-models/core";
import type { ProxyResult } from "./streaming-proxy.js";
import type { SseEmitter } from "./sse.js";

export interface RecordUsageOptions extends ProxyResult {
  keyId: string | null;
  keyPrefix?: string;
  vmodelId: string | null;
  vmodelModelId?: string | null;
  backendId: string | null;
  backendModelId: string | null;
  endpoint: string;
  shouldLogRequest: boolean;
  requestSize: number;
  responseSize: number;
}

function getPeriodBucket(period: string): string {
  const now = new Date();
  switch (period) {
    case "hour": {
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      return d.toISOString();
    }
    case "day": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "week": {
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "month": {
      const d = new Date(now);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    default:
      return now.toISOString();
  }
}

export class UsageRecorder {
  constructor(
    private readonly db: DbClient,
    private readonly sse?: SseEmitter,
  ) {}

  async record(opts: RecordUsageOptions): Promise<void> {
    const now = Date.now();
    const eventId = nanoid();

    // Insert usage event
    await this.db.db
      .insert(usageEvents)
      .values({
        id: eventId,
        keyId: opts.keyId,
        vmodelId: opts.vmodelId,
        backendId: opts.backendId,
        backendModelId: opts.backendModelId,
        endpoint: opts.endpoint,
        promptTokens: opts.promptTokens,
        completionTokens: opts.completionTokens,
        totalTokens: opts.totalTokens,
        ttftMs: opts.ttftMs,
        durationMs: opts.durationMs,
        tps: opts.tps,
        toolCallCount: opts.toolCallCount,
        statusCode: opts.statusCode,
        error: opts.error ?? null,
        timestamp: now,
      })
      .run();

    this.sse?.broadcast("usage-event", {
      id: eventId,
      keyId: opts.keyId,
      keyPrefix: opts.keyPrefix ?? null,
      vmodel: opts.vmodelModelId ?? opts.vmodelId ?? "unknown",
      endpoint: opts.endpoint,
      statusCode: opts.statusCode,
      totalTokens: opts.totalTokens,
      durationMs: opts.durationMs,
      tps: opts.tps,
      error: opts.error ?? null,
      timestamp: now,
    });

    // Update rollups (fire-and-forget style — don't block the response)
    this.updateRollups(opts, now).catch(() => {});

    // Update last used timestamp for key
    if (opts.keyId) {
      await this.db.db
        .update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, opts.keyId))
        .run();
    }

    // Optionally log request
    if (opts.shouldLogRequest) {
      const logId = nanoid();
      const logRow = {
        id: logId,
        keyId: opts.keyId,
        vmodelId: opts.vmodelId,
        backendId: opts.backendId,
        backendModelId: opts.backendModelId,
        endpoint: opts.endpoint,
        method: "POST" as const,
        statusCode: opts.statusCode,
        promptTokens: opts.promptTokens,
        completionTokens: opts.completionTokens,
        totalTokens: opts.totalTokens,
        ttftMs: opts.ttftMs,
        durationMs: opts.durationMs,
        tps: opts.tps,
        toolCallCount: opts.toolCallCount,
        error: opts.error ?? null,
        requestSize: opts.requestSize,
        responseSize: opts.responseSize,
        timestamp: now,
      };

      await this.db.db.insert(requestLogs).values(logRow).run();
      this.sse?.broadcast("log", logRow);
    }
  }

  private async updateRollups(opts: RecordUsageOptions, _now: number): Promise<void> {
    const periods = ["hour", "day", "week", "month"];
    // Global rollup (all dims null) is what the dashboard/analytics charts use.
    // Per-dimension rollups support filtered queries by key / v-model / backend.
    const dimensions: Array<{ keyId: string | null; vmodelId: string | null; backendId: string | null }> = [
      { keyId: null, vmodelId: null, backendId: null },
    ];
    if (opts.keyId) dimensions.push({ keyId: opts.keyId, vmodelId: null, backendId: null });
    if (opts.vmodelId) dimensions.push({ keyId: null, vmodelId: opts.vmodelId, backendId: null });
    if (opts.backendId) dimensions.push({ keyId: null, vmodelId: null, backendId: opts.backendId });

    for (const period of periods) {
      const bucket = getPeriodBucket(period);
      for (const dim of dimensions) {
        await this.upsertRollup(period, bucket, dim, opts);
      }
    }
  }

  private async upsertRollup(
    period: string,
    bucket: string,
    dim: { keyId: string | null; vmodelId: string | null; backendId: string | null },
    opts: RecordUsageOptions,
  ): Promise<void> {
    const id = `rollup-${period}-${bucket}-${dim.keyId ?? "x"}-${dim.vmodelId ?? "x"}-${dim.backendId ?? "x"}`;
    const existing = await this.db.db
      .select()
      .from(usageRollups)
      .where(eq(usageRollups.id, id))
      .get();

    const isError = opts.statusCode >= 400;

    if (existing) {
      const count = existing.requestCount + 1;
      const newAvgTtft =
        opts.ttftMs !== null
          ? ((existing.avgTtftMs ?? 0) * existing.requestCount + opts.ttftMs) / count
          : existing.avgTtftMs;
      const newAvgDuration =
        ((existing.avgDurationMs ?? 0) * existing.requestCount + opts.durationMs) / count;
      const newAvgTps =
        opts.tps !== null
          ? ((existing.avgTps ?? 0) * existing.requestCount + opts.tps) / count
          : existing.avgTps;

      await this.db.db
        .update(usageRollups)
        .set({
          requestCount: count,
          promptTokens: existing.promptTokens + opts.promptTokens,
          completionTokens: existing.completionTokens + opts.completionTokens,
          totalTokens: existing.totalTokens + opts.totalTokens,
          errorCount: existing.errorCount + (isError ? 1 : 0),
          avgTtftMs: newAvgTtft,
          avgDurationMs: newAvgDuration,
          avgTps: newAvgTps,
        })
        .where(eq(usageRollups.id, id))
        .run();
    } else {
      await this.db.db
        .insert(usageRollups)
        .values({
          id,
          period,
          bucket,
          keyId: dim.keyId,
          vmodelId: dim.vmodelId,
          backendId: dim.backendId,
          requestCount: 1,
          promptTokens: opts.promptTokens,
          completionTokens: opts.completionTokens,
          totalTokens: opts.totalTokens,
          errorCount: isError ? 1 : 0,
          avgTtftMs: opts.ttftMs,
          avgDurationMs: opts.durationMs,
          avgTps: opts.tps,
        })
        .run();
    }
  }
}
