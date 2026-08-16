import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  apiKeys,
  requestLogs,
  tokenBudgetCounters,
  auditLog,
  generateApiKey,
  encrypt,
  decrypt,
  getApiKeysShowOnce,
  validateKeyModelAccess,
} from "@haai/core";
import { hashToken } from "@haai/core";
import type { AppContext } from "../../context.js";
import { requireAuth } from "../../auth-session.js";

type ApiKeyRow = typeof apiKeys.$inferSelect;

function normalizeAllowedList(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function validateAllowedLists(
  allowedModels: string[] | null | undefined,
  allowedBackends: string[] | null | undefined,
): string | null {
  return validateKeyModelAccess(
    allowedModels === undefined ? null : allowedModels,
    allowedBackends === undefined ? null : allowedBackends,
  );
}

function toPublicKey(row: ApiKeyRow) {
  const { keyHash: _keyHash, encryptedKey, ...rest } = row;
  return {
    ...rest,
    retrievable: encryptedKey != null && encryptedKey.length > 0,
  };
}

export async function keysRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // List all keys
  app.get("/api/v1/keys", async () => {
    const rows = await ctx.db.db.select().from(apiKeys).all();
    return rows.map(toPublicKey);
  });

  // Get single key
  app.get<{ Params: { id: string } }>("/api/v1/keys/:id", async (req, reply) => {
    const key = await ctx.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, req.params.id))
      .get();
    if (!key) return reply.status(404).send({ error: "Key not found" });
    return toPublicKey(key);
  });

  // Reveal full key (requires stored encrypted copy)
  app.get<{ Params: { id: string } }>("/api/v1/keys/:id/secret", async (req, reply) => {
    const user = await requireAuth(ctx, req, reply);
    if (!user) return;

    const key = await ctx.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, req.params.id))
      .get();
    if (!key) return reply.status(404).send({ error: "Key not found" });
    if (!key.encryptedKey) {
      return reply.status(404).send({ error: "Key secret is not available" });
    }

    const now = Date.now();
    await ctx.db.db
      .insert(auditLog)
      .values({
        id: nanoid(),
        userId: user.id,
        username: user.username,
        action: "reveal_api_key",
        resourceType: "api_key",
        resourceId: key.id,
        detail: JSON.stringify({ prefix: key.prefix }),
        ipAddress: req.ip,
        timestamp: now,
      })
      .run();

    return { key: decrypt(key.encryptedKey, ctx.masterKey) };
  });

  // Create key
  app.post<{ Body: Record<string, unknown> }>("/api/v1/keys", async (req, reply) => {
    const body = req.body;
    const now = Date.now();
    const id = `key-${nanoid(8)}`;

    const { key, prefix } = generateApiKey();
    const keyHash = hashToken(key);
    const showOnce = await getApiKeysShowOnce(ctx.db);
    const encryptedKey = showOnce ? null : encrypt(key, ctx.masterKey);

    const allowedModels = normalizeAllowedList(body["allowedModels"] ?? body["allowed_models"]);
    const allowedBackends = normalizeAllowedList(body["allowedBackends"] ?? body["allowed_backends"]);

    const accessError = validateAllowedLists(allowedModels, allowedBackends);
    if (accessError) {
      return reply.status(400).send({ error: accessError });
    }

    await ctx.db.db
      .insert(apiKeys)
      .values({
        id,
        prefix,
        keyHash,
        encryptedKey,
        name: body["name"] as string,
        enabled: (body["enabled"] as boolean) ?? true,
        suspended: false,
        suspendedReason: null,
        expiresAt: body["expiresAt"] as number | null ?? body["expires_at"] as number | null ?? null,
        allowedModels: allowedModels ? JSON.stringify(allowedModels) : null,
        allowedBackends: allowedBackends ? JSON.stringify(allowedBackends) : null,
        allowToolCalling: (body["allowToolCalling"] as boolean) ?? true,
        allowVision: (body["allowVision"] as boolean) ?? false,
        allowEmbeddings: (body["allowEmbeddings"] as boolean) ?? false,
        rateLimitRpm: body["rateLimitRpm"] as number | null ?? body["rpm_limit"] as number | null ?? null,
        tokenBudgetHour: body["tokenBudgetHour"] as number | null ?? null,
        tokenBudgetDay: body["tokenBudgetDay"] as number | null ?? body["day_budget"] as number | null ?? null,
        tokenBudgetWeek: body["tokenBudgetWeek"] as number | null ?? null,
        tokenBudgetMonth: body["tokenBudgetMonth"] as number | null ?? null,
        logRequests: (body["logRequests"] as boolean) ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = await ctx.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .get();

    return reply.status(201).send({
      ...toPublicKey(row!),
      key,
      showOnce,
    });
  });

  // Update key
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/keys/:id",
    async (req, reply) => {
      const existing = await ctx.db.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: "Key not found" });

      const body = req.body;
      const updates: Partial<typeof apiKeys.$inferInsert> = { updatedAt: Date.now() };

      for (const field of [
        "name", "enabled", "expiresAt", "allowToolCalling", "allowVision",
        "allowEmbeddings", "rateLimitRpm", "tokenBudgetHour", "tokenBudgetDay",
        "tokenBudgetWeek", "tokenBudgetMonth", "logRequests",
      ] as const) {
        if (body[field] !== undefined) {
          (updates as Record<string, unknown>)[field] = body[field];
        }
      }

      if (body["rpm_limit"] !== undefined) updates.rateLimitRpm = body["rpm_limit"] as number | null;
      if (body["day_budget"] !== undefined) updates.tokenBudgetDay = body["day_budget"] as number | null;
      if (body["expires_at"] !== undefined) updates.expiresAt = body["expires_at"] as number | null;

      const allowedModels = normalizeAllowedList(body["allowedModels"] ?? body["allowed_models"]);
      const allowedBackends = normalizeAllowedList(body["allowedBackends"] ?? body["allowed_backends"]);

      const nextAllowedModels =
        allowedModels !== undefined ? allowedModels : existing.allowedModels
          ? (JSON.parse(existing.allowedModels) as string[])
          : null;
      const nextAllowedBackends =
        allowedBackends !== undefined
          ? allowedBackends
          : existing.allowedBackends
            ? (JSON.parse(existing.allowedBackends) as string[])
            : null;

      const accessError =
        allowedModels !== undefined || allowedBackends !== undefined
          ? validateKeyModelAccess(nextAllowedModels, nextAllowedBackends)
          : null;
      if (accessError) {
        return reply.status(400).send({ error: accessError });
      }

      if (allowedModels !== undefined) {
        updates.allowedModels = allowedModels ? JSON.stringify(allowedModels) : null;
      }
      if (allowedBackends !== undefined) {
        updates.allowedBackends = allowedBackends ? JSON.stringify(allowedBackends) : null;
      }

      await ctx.db.db.update(apiKeys).set(updates).where(eq(apiKeys.id, req.params.id)).run();
      return { success: true };
    },
  );

  // Suspend key
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/api/v1/keys/:id/suspend",
    async (req, reply) => {
      const key = await ctx.db.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, req.params.id))
        .get();
      if (!key) return reply.status(404).send({ error: "Key not found" });

      await ctx.db.db
        .update(apiKeys)
        .set({
          suspended: true,
          suspendedReason: req.body.reason ?? "Manually suspended",
          updatedAt: Date.now(),
        })
        .where(eq(apiKeys.id, req.params.id))
        .run();

      return { success: true };
    },
  );

  // Resume key
  app.post<{ Params: { id: string } }>("/api/v1/keys/:id/resume", async (req, reply) => {
    const key = await ctx.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, req.params.id))
      .get();
    if (!key) return reply.status(404).send({ error: "Key not found" });

    await ctx.db.db
      .update(apiKeys)
      .set({ suspended: false, suspendedReason: null, updatedAt: Date.now() })
      .where(eq(apiKeys.id, req.params.id))
      .run();

    return { success: true };
  });

  // Delete key
  app.delete<{ Params: { id: string } }>("/api/v1/keys/:id", async (req, reply) => {
    await ctx.db.db.delete(apiKeys).where(eq(apiKeys.id, req.params.id)).run();
    return reply.status(204).send();
  });

  // Get key usage logs
  app.get<{ Params: { id: string }; Querystring: { limit?: string; since?: string } }>(
    "/api/v1/keys/:id/logs",
    async (req, _reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? "100", 10), 500);
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;

      const whereClause = since
        ? and(eq(requestLogs.keyId, req.params.id), gte(requestLogs.timestamp, since))
        : eq(requestLogs.keyId, req.params.id);

      const logs = await ctx.db.db
        .select()
        .from(requestLogs)
        .where(whereClause)
        .orderBy(desc(requestLogs.timestamp))
        .limit(limit)
        .all();

      return logs;
    },
  );

  // Get key budget usage
  app.get<{ Params: { id: string } }>("/api/v1/keys/:id/budget", async (req, reply) => {
    const key = await ctx.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, req.params.id))
      .get();
    if (!key) return reply.status(404).send({ error: "Key not found" });

    const counters = await ctx.db.db
      .select()
      .from(tokenBudgetCounters)
      .where(eq(tokenBudgetCounters.keyId, req.params.id))
      .all();

    const getBucket = (period: string): string => {
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
        default: return now.toISOString();
      }
    };

    const usage = {
      hour: { used: 0, budget: key.tokenBudgetHour },
      day: { used: 0, budget: key.tokenBudgetDay },
      week: { used: 0, budget: key.tokenBudgetWeek },
      month: { used: 0, budget: key.tokenBudgetMonth },
    };

    for (const counter of counters) {
      const period = counter.period as keyof typeof usage;
      if (period in usage && counter.bucket === getBucket(period)) {
        usage[period]!.used = counter.tokensUsed;
      }
    }

    return usage;
  });
}
