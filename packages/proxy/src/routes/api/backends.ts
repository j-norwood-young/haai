import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { backends as backendsTable } from "@ai-v-models/core";
import { encrypt } from "@ai-v-models/core";
import type { AppContext } from "../../context.js";
import { checkAndPersistBackendHealth, checkBackendHealth } from "../../health.js";
import { getLogger } from "../../logger.js";

function scheduleBackendHealthCheck(
  ctx: AppContext,
  backend: {
    id: string;
    baseUrl: string;
    name: string;
    provider: string;
    keyMode: string;
    encryptedApiKey: string | null;
    enabled: boolean;
    healthCheckEnabled: boolean;
  },
): void {
  if (!backend.enabled || !backend.healthCheckEnabled) return;

  void checkAndPersistBackendHealth(
    ctx.db,
    ctx.masterKey,
    {
      id: backend.id,
      baseUrl: backend.baseUrl,
      name: backend.name,
      provider: backend.provider,
      keyMode: backend.keyMode,
      encryptedApiKey: backend.encryptedApiKey,
    },
    ctx.config.health.timeoutMs,
    ctx.sse,
  ).catch((err) => {
    getLogger().warn({ err, backendId: backend.id }, "Immediate backend health check failed");
  });
}

export async function backendsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // List all backends
  app.get("/api/v1/backends", async () => {
    const rows = await ctx.db.db.select().from(backendsTable).all();
    return rows.map((b) => ({ ...b, encryptedApiKey: undefined }));
  });

  // Get single backend
  app.get<{ Params: { id: string } }>("/api/v1/backends/:id", async (req, reply) => {
    const backend = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.id, req.params.id))
      .get();
    if (!backend) return reply.status(404).send({ error: "Backend not found" });
    return { ...backend, encryptedApiKey: undefined };
  });

  // Create backend
  app.post<{ Body: Record<string, unknown> }>("/api/v1/backends", async (req, reply) => {
    const body = req.body;
    const now = Date.now();
    const id = `backend-${nanoid(8)}`;

    const apiKey = typeof body["apiKey"] === "string" ? body["apiKey"] : "";
    // Providing an API key implies abstraction unless the client sets a mode explicitly.
    const keyMode =
      (typeof body["keyMode"] === "string" ? body["keyMode"] : undefined) ??
      (apiKey ? "abstraction" : "passthrough");

    let encryptedApiKey: string | null = null;
    if (apiKey && keyMode === "abstraction") {
      encryptedApiKey = encrypt(apiKey, ctx.masterKey);
    }

    await ctx.db.db
      .insert(backendsTable)
      .values({
        id,
        name: body["name"] as string,
        displayName: (body["displayName"] as string) ?? (body["name"] as string),
        hostName: body["hostName"] as string,
        provider: body["provider"] as string,
        baseUrl: body["baseUrl"] as string,
        keyMode,
        encryptedApiKey,
        enabled: (body["enabled"] as boolean) ?? true,
        weight: (body["weight"] as number) ?? 1,
        maxConcurrency: (body["maxConcurrency"] as number) ?? 10,
        healthCheckEnabled: (body["healthCheckEnabled"] as boolean) ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.id, id))
      .get();

    ctx.sse.broadcast("backend-health", { backendId: id, action: "created" });
    if (created) scheduleBackendHealthCheck(ctx, created);
    return reply.status(201).send({ ...created, encryptedApiKey: undefined });
  });

  // Update backend
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/backends/:id",
    async (req, reply) => {
      const backend = await ctx.db.db
        .select()
        .from(backendsTable)
        .where(eq(backendsTable.id, req.params.id))
        .get();
      if (!backend) return reply.status(404).send({ error: "Backend not found" });

      const updates: Partial<typeof backendsTable.$inferInsert> = { updatedAt: Date.now() };
      const body = req.body;

      if (body["displayName"] !== undefined) updates.displayName = body["displayName"] as string;
      if (body["baseUrl"] !== undefined) updates.baseUrl = body["baseUrl"] as string;
      if (body["enabled"] !== undefined) updates.enabled = body["enabled"] as boolean;
      if (body["weight"] !== undefined) updates.weight = body["weight"] as number;
      if (body["keyMode"] !== undefined) updates.keyMode = body["keyMode"] as string;
      if (body["apiKey"] !== undefined) {
        const apiKey = typeof body["apiKey"] === "string" ? body["apiKey"] : "";
        if (apiKey) {
          updates.encryptedApiKey = encrypt(apiKey, ctx.masterKey);
          // Saving a key without an explicit mode switches to abstraction so the
          // stored key is actually used (passthrough ignores encryptedApiKey).
          if (body["keyMode"] === undefined) updates.keyMode = "abstraction";
        } else {
          updates.encryptedApiKey = null;
        }
      }

      await ctx.db.db.update(backendsTable).set(updates).where(eq(backendsTable.id, req.params.id)).run();

      const updated = await ctx.db.db
        .select()
        .from(backendsTable)
        .where(eq(backendsTable.id, req.params.id))
        .get();

      ctx.sse.broadcast("backend-health", { backendId: req.params.id, action: "updated" });
      if (
        updated &&
        (body["baseUrl"] !== undefined || body["enabled"] !== undefined || body["apiKey"] !== undefined)
      ) {
        scheduleBackendHealthCheck(ctx, updated);
      }

      return { ...updated, encryptedApiKey: undefined };
    },
  );

  // Delete backend
  app.delete<{ Params: { id: string } }>("/api/v1/backends/:id", async (req, reply) => {
    const backend = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.id, req.params.id))
      .get();
    if (!backend) return reply.status(404).send({ error: "Backend not found" });

    await ctx.db.db
      .delete(backendsTable)
      .where(eq(backendsTable.id, req.params.id))
      .run();

    ctx.sse.broadcast("backend-health", { backendId: req.params.id, action: "deleted" });

    return reply.status(204).send();
  });

  // Probe connectivity for unsaved/draft backend settings (no persist).
  app.post<{ Body: { baseUrl?: string; apiKey?: string } | undefined }>(
    "/api/v1/backends/test",
    async (req, reply) => {
      const body = req.body ?? {};
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      if (!baseUrl) {
        return reply.status(400).send({ error: "baseUrl is required" });
      }

      const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
      const result = await checkBackendHealth(
        {
          id: "draft",
          baseUrl,
          name: "draft",
          keyMode: apiKey ? "abstraction" : "passthrough",
          encryptedApiKey: apiKey ? encrypt(apiKey, ctx.masterKey) : null,
        },
        ctx.masterKey,
        10000,
      );

      return {
        success: result.status !== "unhealthy",
        statusCode: result.status === "unhealthy" ? 0 : 200,
        latencyMs: result.latencyMs,
        health: result.status,
        error: result.error,
      };
    },
  );

  // Test backend connectivity. Optional body overrides (baseUrl, apiKey) probe
  // draft/unsaved form values. Health is only persisted when probing saved config.
  app.post<{
    Params: { id: string };
    Body: { baseUrl?: string; apiKey?: string } | undefined;
  }>("/api/v1/backends/:id/test", async (req, reply) => {
    const backend = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.id, req.params.id))
      .get();
    if (!backend) return reply.status(404).send({ error: "Backend not found" });

    const body = req.body ?? {};
    const draftBaseUrl =
      typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : backend.baseUrl;
    const draftApiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    const usingDraftKey = draftApiKey.length > 0;
    const urlUnchanged = draftBaseUrl === backend.baseUrl;

    const probe = {
      id: backend.id,
      baseUrl: draftBaseUrl,
      name: backend.name,
      provider: backend.provider,
      keyMode: usingDraftKey ? "abstraction" : backend.keyMode,
      encryptedApiKey: usingDraftKey
        ? encrypt(draftApiKey, ctx.masterKey)
        : backend.encryptedApiKey,
    };

    const result =
      usingDraftKey || !urlUnchanged
        ? await checkBackendHealth(probe, ctx.masterKey, 10000)
        : await checkAndPersistBackendHealth(
            ctx.db,
            ctx.masterKey,
            probe,
            10000,
            ctx.sse,
          );

    return {
      success: result.status !== "unhealthy",
      statusCode: result.status === "unhealthy" ? 0 : 200,
      latencyMs: result.latencyMs,
      health: result.status,
      error: result.error,
    };
  });
}
