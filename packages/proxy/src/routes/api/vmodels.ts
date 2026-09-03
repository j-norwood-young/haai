import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
} from "@haai/core";
import type { AppContext } from "../../context.js";
import { recomputeAllVModelHealth } from "../../vmodel-health.js";

async function loadVmodelBackends(ctx: AppContext, vmodelId: string) {
  const rows = await ctx.db.db
    .select({
      id: vmodelBackendsTable.id,
      backendId: vmodelBackendsTable.backendId,
      backendModelId: vmodelBackendsTable.backendModelId,
      weight: vmodelBackendsTable.weight,
      enabled: vmodelBackendsTable.enabled,
      lastAvailable: vmodelBackendsTable.lastAvailable,
      unavailableReason: vmodelBackendsTable.unavailableReason,
      createdAt: vmodelBackendsTable.createdAt,
      backendName: backendsTable.displayName,
      backendSlug: backendsTable.name,
    })
    .from(vmodelBackendsTable)
    .leftJoin(backendsTable, eq(vmodelBackendsTable.backendId, backendsTable.id))
    .where(eq(vmodelBackendsTable.vmodelId, vmodelId))
    .all();

  return rows.map((row) => ({
    id: row.id,
    backendId: row.backendId,
    backendModelId: row.backendModelId,
    backendName: row.backendName || row.backendSlug || row.backendId,
    weight: row.weight,
    enabled: row.enabled,
    lastAvailable: row.lastAvailable,
    unavailableReason: row.unavailableReason,
    createdAt: row.createdAt,
  }));
}

export async function vmodelsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // List all v-models
  app.get("/api/v1/vmodels", async () => {
    const rows = await ctx.db.db.select().from(vmodelsTable).all();
    const result = await Promise.all(
      rows.map(async (vm) => {
        const backends = await loadVmodelBackends(ctx, vm.id);
        return { ...vm, backends };
      }),
    );
    return result;
  });

  // Get single v-model
  app.get<{ Params: { id: string } }>("/api/v1/vmodels/:id", async (req, reply) => {
    const vm = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(eq(vmodelsTable.id, req.params.id))
      .get();
    if (!vm) return reply.status(404).send({ error: "VModel not found" });

    const backends = await loadVmodelBackends(ctx, vm.id);
    return { ...vm, backends };
  });

  // Create v-model
  app.post<{ Body: Record<string, unknown> }>("/api/v1/vmodels", async (req, reply) => {
    const body = req.body;
    const modelId = (body["modelId"] ?? body["model_id"]) as string | undefined;
    if (!modelId?.trim()) {
      return reply.status(400).send({ error: "modelId is required" });
    }

    const trimmedModelId = modelId.trim();
    const existing = await ctx.db.db
      .select({ id: vmodelsTable.id })
      .from(vmodelsTable)
      .where(eq(vmodelsTable.modelId, trimmedModelId))
      .get();
    if (existing) {
      return reply.status(409).send({
        error: `A virtual model with model ID '${trimmedModelId}' already exists`,
      });
    }

    // Validate backend mappings before insert so we never leave an orphan v-model
    const backendMappings = body["backends"] as Array<Record<string, unknown>> | undefined;
    const normalizedMappings: Array<{
      backendId: string;
      backendModelId: string;
      weight: number;
      enabled: boolean;
    }> = [];
    if (backendMappings) {
      const seenBackendIds = new Set<string>();
      for (const bm of backendMappings) {
        const backendId = (bm["backendId"] ?? bm["backend_id"]) as string | undefined;
        if (!backendId) continue;
        if (seenBackendIds.has(backendId)) {
          return reply.status(409).send({
            error: `Backend '${backendId}' is listed more than once`,
          });
        }
        seenBackendIds.add(backendId);
        const backendModelId = (
          (bm["backendModelId"] ?? bm["backend_model_id"]) as string | undefined
        )?.trim();
        if (!backendModelId) {
          return reply.status(400).send({
            error: "backendModelId is required for each backend mapping",
          });
        }
        normalizedMappings.push({
          backendId,
          backendModelId,
          weight: (bm["weight"] as number) ?? 1,
          enabled: (bm["enabled"] as boolean) ?? true,
        });
      }
    }

    const now = Date.now();
    const id = `vmodel-${nanoid(8)}`;

    try {
      await ctx.db.db
        .insert(vmodelsTable)
        .values({
          id,
          modelId: trimmedModelId,
          displayName: (body["displayName"] as string) ?? (body["display_name"] as string) ?? trimmedModelId,
          description: body["description"] as string | null ?? null,
          balancingStrategy: (body["balancingStrategy"] as string) ?? (body["strategy"] as string) ?? "session-pin",
          streaming: (body["streaming"] as boolean) ?? true,
          allowToolCalling: (body["allowToolCalling"] as boolean) ?? true,
          allowVision: (body["allowVision"] as boolean) ?? false,
          allowEmbeddings: (body["allowEmbeddings"] as boolean) ?? false,
          enabled: (body["enabled"] as boolean) ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE") || message.includes("unique")) {
        return reply.status(409).send({
          error: `A virtual model with model ID '${trimmedModelId}' already exists`,
        });
      }
      throw err;
    }

    for (const mapping of normalizedMappings) {
      await ctx.db.db
        .insert(vmodelBackendsTable)
        .values({
          id: `vmb-${nanoid(8)}`,
          vmodelId: id,
          backendId: mapping.backendId,
          backendModelId: mapping.backendModelId,
          weight: mapping.weight,
          enabled: mapping.enabled,
          createdAt: now,
        })
        .run();
    }

    const created = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(eq(vmodelsTable.id, id))
      .get();
    await recomputeAllVModelHealth(ctx.db, ctx.sse);
    const backends = await loadVmodelBackends(ctx, id);

    return reply.status(201).send({ ...created, backends });
  });

  // Update v-model
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/vmodels/:id",
    async (req, reply) => {
      const vm = await ctx.db.db
        .select()
        .from(vmodelsTable)
        .where(eq(vmodelsTable.id, req.params.id))
        .get();
      if (!vm) return reply.status(404).send({ error: "VModel not found" });

      const updates: Partial<typeof vmodelsTable.$inferInsert> = { updatedAt: Date.now() };
      const body = req.body;

      for (const field of [
        "displayName", "description", "balancingStrategy", "streaming",
        "allowToolCalling", "allowVision", "allowEmbeddings", "enabled",
      ] as const) {
        if (body[field] !== undefined) {
          (updates as Record<string, unknown>)[
            field === "displayName" ? "displayName" :
            field === "balancingStrategy" ? "balancingStrategy" :
            field
          ] = body[field];
        }
      }

      await ctx.db.db
        .update(vmodelsTable)
        .set(updates)
        .where(eq(vmodelsTable.id, req.params.id))
        .run();

      await recomputeAllVModelHealth(ctx.db, ctx.sse);
      return reply.status(200).send({ success: true });
    },
  );

  // Delete v-model
  app.delete<{ Params: { id: string } }>("/api/v1/vmodels/:id", async (req, reply) => {
    await ctx.db.db
      .delete(vmodelsTable)
      .where(eq(vmodelsTable.id, req.params.id))
      .run();
    await recomputeAllVModelHealth(ctx.db, ctx.sse);
    return reply.status(204).send();
  });

  // Add backend to v-model
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/vmodels/:id/backends",
    async (req, reply) => {
      const body = req.body;
      const backendId = (body["backendId"] ?? body["backend_id"]) as string | undefined;
      const backendModelId = (
        (body["backendModelId"] ?? body["backend_model_id"]) as string | undefined
      )?.trim();
      if (!backendId?.trim()) {
        return reply.status(400).send({ error: "backendId is required" });
      }
      if (!backendModelId) {
        return reply.status(400).send({ error: "backendModelId is required" });
      }

      const vm = await ctx.db.db
        .select({ id: vmodelsTable.id })
        .from(vmodelsTable)
        .where(eq(vmodelsTable.id, req.params.id))
        .get();
      if (!vm) {
        return reply.status(404).send({ error: "VModel not found" });
      }

      const existingMapping = await ctx.db.db
        .select({ id: vmodelBackendsTable.id })
        .from(vmodelBackendsTable)
        .where(
          and(
            eq(vmodelBackendsTable.vmodelId, req.params.id),
            eq(vmodelBackendsTable.backendId, backendId),
            eq(vmodelBackendsTable.backendModelId, backendModelId),
          ),
        )
        .get();
      if (existingMapping) {
        return reply.status(409).send({
          error: "This backend model is already mapped to this virtual model",
        });
      }

      const now = Date.now();
      await ctx.db.db
        .insert(vmodelBackendsTable)
        .values({
          id: `vmb-${nanoid(8)}`,
          vmodelId: req.params.id,
          backendId,
          backendModelId,
          weight: (body["weight"] as number) ?? 1,
          enabled: (body["enabled"] as boolean) ?? true,
          createdAt: now,
        })
        .run();
      await recomputeAllVModelHealth(ctx.db, ctx.sse);
      return reply.status(201).send({ success: true });
    },
  );

  // Remove backend from v-model
  app.delete<{ Params: { id: string; backendMappingId: string } }>(
    "/api/v1/vmodels/:id/backends/:backendMappingId",
    async (req, reply) => {
      await ctx.db.db
        .delete(vmodelBackendsTable)
        .where(eq(vmodelBackendsTable.id, req.params.backendMappingId))
        .run();
      await recomputeAllVModelHealth(ctx.db, ctx.sse);
      return reply.status(204).send();
    },
  );

  // Update backend weight for v-model
  app.patch<{ Params: { id: string; backendMappingId: string }; Body: Record<string, unknown> }>(
    "/api/v1/vmodels/:id/backends/:backendMappingId",
    async (req, reply) => {
      const body = req.body;
      const weight = body["weight"] as number | undefined;
      
      if (weight === undefined || weight < 0) {
        return reply.status(400).send({ error: "weight is required and must be >= 0" });
      }

      await ctx.db.db
        .update(vmodelBackendsTable)
        .set({ weight })
        .where(eq(vmodelBackendsTable.id, req.params.backendMappingId))
        .run();

      return reply.status(200).send({ success: true });
    },
  );
}
