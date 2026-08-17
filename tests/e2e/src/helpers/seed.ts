import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  backends as backendsTable,
  vmodels,
  vmodelBackends,
  apiKeys,
  usageEvents,
  usageRollups,
  generateApiKey,
} from "@haai/core";
import type { TestProxy } from "./proxy-server.js";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function insertBackend(
  proxy: TestProxy,
  opts: {
    name: string;
    hostName: string;
    baseUrl: string;
    provider?: string;
    availableModels?: string[];
    lastHealthStatus?: string | null;
    enabled?: boolean;
  },
): Promise<string> {
  const id = `backend-${nanoid(8)}`;
  const now = Date.now();
  const row: typeof backendsTable.$inferInsert = {
    id,
    name: opts.name,
    displayName: opts.name,
    hostName: opts.hostName,
    provider: opts.provider ?? "generic",
    baseUrl: opts.baseUrl,
    keyMode: "passthrough",
    encryptedApiKey: null,
    enabled: opts.enabled ?? true,
    weight: 1,
    maxConcurrency: 10,
    healthCheckEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  if (opts.availableModels) {
    row.availableModels = JSON.stringify(opts.availableModels);
  }
  if (opts.lastHealthStatus !== undefined) {
    row.lastHealthStatus = opts.lastHealthStatus;
  }
  proxy.db.db.insert(backendsTable).values(row).run();
  return id;
}

export async function insertVModel(
  proxy: TestProxy,
  opts: {
    modelId: string;
    displayName?: string;
    backends?: Array<{ backendId: string; backendModelId: string; weight?: number }>;
  },
): Promise<string> {
  const id = `vmodel-${nanoid(8)}`;
  const now = Date.now();
  proxy.db.db
    .insert(vmodels)
    .values({
      id,
      modelId: opts.modelId,
      displayName: opts.displayName ?? opts.modelId,
      description: null,
      balancingStrategy: "session-pin",
      streaming: true,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const mapping of opts.backends ?? []) {
    proxy.db.db
      .insert(vmodelBackends)
      .values({
        id: `vmb-${nanoid(8)}`,
        vmodelId: id,
        backendId: mapping.backendId,
        backendModelId: mapping.backendModelId,
        weight: mapping.weight ?? 1,
        enabled: true,
        createdAt: now,
      })
      .run();
  }

  return id;
}

export async function insertKey(
  proxy: TestProxy,
  overrides: Partial<typeof apiKeys.$inferInsert> = {},
): Promise<{ key: string; id: string }> {
  const { key, prefix } = generateApiKey();
  const now = Date.now();
  const id = overrides.id ?? `key-${nanoid(8)}`;
  proxy.db.db
    .insert(apiKeys)
    .values({
      id,
      prefix,
      keyHash: hashKey(key),
      name: "test",
      enabled: true,
      suspended: false,
      suspendedReason: null,
      expiresAt: null,
      allowedModels: null,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: false,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
      logRequests: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return { key, id };
}

export function setBackendHealth(
  proxy: TestProxy,
  backendId: string,
  opts: { status: string | null; models?: string[] | null },
): void {
  const now = Date.now();
  const patch: {
    lastHealthStatus: string | null;
    lastHealthCheck: number;
    updatedAt: number;
    availableModels?: string | null;
  } = {
    lastHealthStatus: opts.status,
    lastHealthCheck: now,
    updatedAt: now,
  };
  if (opts.models !== undefined) {
    patch.availableModels = opts.models == null ? null : JSON.stringify(opts.models);
  } else if (opts.status === "unhealthy") {
    patch.availableModels = null;
  }
  proxy.db.db.update(backendsTable).set(patch).where(eq(backendsTable.id, backendId)).run();
}

export function insertUsageEvent(
  proxy: TestProxy,
  opts: { timestamp: number; totalTokens?: number; statusCode?: number; durationMs?: number },
): void {
  proxy.db.db
    .insert(usageEvents)
    .values({
      id: `evt-${nanoid(8)}`,
      endpoint: "/v1/chat/completions",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: opts.totalTokens ?? 30,
      durationMs: opts.durationMs ?? 100,
      toolCallCount: 0,
      statusCode: opts.statusCode ?? 200,
      timestamp: opts.timestamp,
    })
    .run();
}

export function insertRollup(
  proxy: TestProxy,
  opts: {
    period: "hour" | "day" | "week" | "month";
    bucket: string;
    requestCount: number;
    totalTokens?: number;
  },
): void {
  proxy.db.db
    .insert(usageRollups)
    .values({
      id: `rollup-${opts.period}-${opts.bucket}-x-x-x`,
      period: opts.period,
      bucket: opts.bucket,
      keyId: null,
      vmodelId: null,
      backendId: null,
      requestCount: opts.requestCount,
      promptTokens: opts.totalTokens ?? opts.requestCount * 10,
      completionTokens: opts.totalTokens ?? opts.requestCount * 20,
      totalTokens: opts.totalTokens ?? opts.requestCount * 30,
      errorCount: 0,
    })
    .run();
}

export async function listModelIds(proxyUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${proxyUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`GET /v1/models failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data: Array<{ id: string }> };
  return data.data.map((m) => m.id);
}

export async function chatCompletion(
  proxyUrl: string,
  apiKey: string,
  model: string,
): Promise<Response> {
  return fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    }),
  });
}

export async function adminJson(
  proxy: TestProxy,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${proxy.adminToken}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${proxy.url}${path}`, init);
}
