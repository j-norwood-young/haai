import { fetch } from "undici";
import { buildBackendApiUrl, type DbClient } from "@ai-v-models/core";
import { eq } from "drizzle-orm";
import { backends as backendsTable } from "@ai-v-models/core";
import { backendHealthGauge } from "./metrics.js";
import { getLogger } from "./logger.js";
import { backendAuthHeaders } from "./backend-auth.js";
import type { SseEmitter } from "./sse.js";
import { recomputeAllVModelHealth } from "./vmodel-health.js";

export interface HealthCheckResult {
  backendId: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  error?: string;
  /** Present on successful /v1/models responses; cleared when unhealthy */
  availableModels?: string[];
}

function extractModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      ids.push((item as { id: string }).id);
    }
  }
  return ids;
}

export async function checkBackendHealth(
  backend: {
    id: string;
    baseUrl: string;
    name: string;
    keyMode: string;
    encryptedApiKey: string | null;
  },
  masterKey: Buffer,
  timeoutMs = 5000,
): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(buildBackendApiUrl(backend.baseUrl, "/v1/models"), {
      signal: controller.signal,
      headers: {
        "User-Agent": "ai-v-models/healthcheck",
        ...backendAuthHeaders(backend, masterKey),
      },
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const statusText = res.statusText?.trim();
      return {
        backendId: backend.id,
        status: "unhealthy",
        latencyMs,
        error: statusText ? `HTTP ${res.status} ${statusText}` : `HTTP ${res.status}`,
      };
    }

    let availableModels: string[] = [];
    try {
      const json = (await res.json()) as unknown;
      availableModels = extractModelIds(json);
    } catch {
      availableModels = [];
    }

    if (latencyMs >= 2000) {
      return {
        backendId: backend.id,
        status: "degraded",
        latencyMs,
        error: `High latency (${latencyMs}ms)`,
        availableModels,
      };
    }

    return { backendId: backend.id, status: "healthy", latencyMs, availableModels };
  } catch (err) {
    const error =
      err instanceof Error && err.name === "AbortError"
        ? `Health check timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);

    return {
      backendId: backend.id,
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error,
    };
  }
}

/** Run a health check, persist the result, and optionally broadcast SSE. */
export async function checkAndPersistBackendHealth(
  db: DbClient,
  masterKey: Buffer,
  backend: {
    id: string;
    baseUrl: string;
    name: string;
    provider: string;
    keyMode: string;
    encryptedApiKey: string | null;
  },
  timeoutMs: number,
  sse?: SseEmitter,
  opts?: { recomputeVModels?: boolean },
): Promise<HealthCheckResult> {
  const result = await checkBackendHealth(backend, masterKey, timeoutMs);
  const now = Date.now();

  // Clear model inventory when unhealthy so we never route on stale lists.
  const availableModelsJson =
    result.status === "unhealthy"
      ? null
      : JSON.stringify(result.availableModels ?? []);

  await db.db
    .update(backendsTable)
    .set({
      lastHealthCheck: now,
      lastHealthStatus: result.status,
      lastLatencyMs: result.latencyMs,
      lastHealthError: result.error ?? null,
      availableModels: availableModelsJson,
      updatedAt: now,
    })
    .where(eq(backendsTable.id, backend.id))
    .run();

  const healthScore = result.status === "healthy" ? 1 : result.status === "degraded" ? 0.5 : 0;
  backendHealthGauge.set({ backend: backend.name, provider: backend.provider }, healthScore);

  const payload: {
    backendId: string;
    status: HealthCheckResult["status"];
    latencyMs: number;
    error?: string;
  } = {
    backendId: backend.id,
    status: result.status,
    latencyMs: result.latencyMs,
  };
  if (result.error) payload.error = result.error;
  sse?.broadcast("backend-health", payload);

  if (opts?.recomputeVModels !== false) {
    await recomputeAllVModelHealth(db, sse);
  }

  return result;
}

export class HealthMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbClient,
    private readonly masterKey: Buffer,
    private readonly intervalSecs: number = 30,
    private readonly timeoutMs: number = 5000,
    private readonly sse?: SseEmitter,
  ) {}

  async start(): Promise<void> {
    await this.runChecks();
    this.timer = setInterval(() => void this.runChecks(), this.intervalSecs * 1000);
  }

  /** Run health checks immediately (e.g. before startup banner). */
  async runNow(): Promise<void> {
    await this.runChecks();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runChecks(): Promise<void> {
    const log = getLogger();
    try {
      const allBackends = await this.db.db
        .select()
        .from(backendsTable)
        .where(eq(backendsTable.enabled, true))
        .all();

      const results = await Promise.allSettled(
        allBackends.map((b) =>
          checkAndPersistBackendHealth(
            this.db,
            this.masterKey,
            {
              id: b.id,
              baseUrl: b.baseUrl,
              name: b.name,
              provider: b.provider,
              keyMode: b.keyMode,
              encryptedApiKey: b.encryptedApiKey,
            },
            this.timeoutMs,
            undefined,
            { recomputeVModels: false },
          ),
        ),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          const { backendId, status, latencyMs, error } = result.value;
          if (status !== "healthy") {
            log.warn({ backendId, status, latencyMs, error }, "Backend health check issue");
          }
        }
      }

      await recomputeAllVModelHealth(this.db, this.sse);
      this.sse?.broadcast("backend-health", { action: "poll" });
    } catch (err) {
      log.error({ err }, "Error running health checks");
    }
  }
}
