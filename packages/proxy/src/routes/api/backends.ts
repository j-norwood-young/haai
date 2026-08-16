import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { backends as backendsTable } from "@ai-v-models/core";
import { encrypt } from "@ai-v-models/core";
import type { AppContext } from "../../context.js";
import { checkAndPersistBackendHealth } from "../../health.js";
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

    let encryptedApiKey: string | null = null;
    if (body["apiKey"] && body["keyMode"] === "abstraction") {
      encryptedApiKey = encrypt(body["apiKey"] as string, ctx.masterKey);
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
        keyMode: (body["keyMode"] as string) ?? "passthrough",
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
      if (body["apiKey"] !== undefined) {
        updates.encryptedApiKey = encrypt(body["apiKey"] as string, ctx.masterKey);
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

  // Test backend connectivity
  app.post<{ Params: { id: string } }>("/api/v1/backends/:id/test", async (req, reply) => {
    const backend = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.id, req.params.id))
      .get();
    if (!backend) return reply.status(404).send({ error: "Backend not found" });

    const result = await checkAndPersistBackendHealth(
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
