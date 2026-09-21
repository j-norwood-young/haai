import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
  parseVModelKind,
  modelKindRoutingClass,
  type VModelKind,
} from "@haai/core";
import type { AppContext } from "../../context.js";
import { recomputeAllVModelHealth } from "../../vmodel-health.js";
import { backendKindResolver } from "../../model-catalog.js";
import { getLogger } from "../../logger.js";

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
      backendModelCatalog: backendsTable.modelCatalog,
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
    // Resolved from the backend's cached model catalog, so a legacy mapping that
    // contradicts the v-model's kind can be badged in the UI.
    modelKind: backendKindResolver({ modelCatalog: row.backendModelCatalog })(row.backendModelId)
      .kind,
  }));
}

interface MemberValidationFailure {
  ok: false;
  status: 400;
  error: string;
}

/**
 * Validates a candidate v-model member before it's inserted: the backend must
 * exist, and if the backend model's kind is *positively* known it must match
 * the v-model's routing class. A model that's simply not in the backend's
 * inventory yet (a normal transient state) is allowed through — health
 * recompute will mark it unavailable with a clear reason.
 */
async function validateMember(
  ctx: AppContext,
  vmodelKind: VModelKind,
  vmodelAlias: string,
  backendId: string,
  backendModelId: string,
): Promise<{ ok: true } | MemberValidationFailure> {
  const backend = await ctx.db.db
    .select()
    .from(backendsTable)
    .where(eq(backendsTable.id, backendId))
    .get();
  if (!backend) {
    return { ok: false, status: 400, error: `Backend '${backendId}' not found` };
  }

  const { kind, positive } = backendKindResolver(backend)(backendModelId);
  if (positive && modelKindRoutingClass(kind) !== vmodelKind) {
    const backendLabel = backend.displayName || backend.name;
    const actualNoun = kind === "embeddings" ? "an embedding" : "a chat";
    const targetNoun = vmodelKind === "embedding" ? "chat" : "embedding";
    return {
      ok: false,
      status: 400,
      error: `Model '${backendModelId}' on backend '${backendLabel}' is ${actualNoun} model and cannot be added to ${targetNoun} v-model '${vmodelAlias}'`,
    };
  }

  if (!positive && kind === "unknown") {
    // Model not in the backend's known inventory (or inventory unknown) —
    // allow it; recomputeAllVModelHealth will mark it unavailable with a
    // clear reason if it turns out to be missing.
    getLogger().debug(
      { backendId, backendModelId },
      "Adding v-model member with unknown model kind — inventory not yet populated or model not found",
    );
  }

  return { ok: true };
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
      const seenMappings = new Set<string>();
      for (const bm of backendMappings) {
        const backendId = (bm["backendId"] ?? bm["backend_id"]) as string | undefined;
        if (!backendId) continue;
        const backendModelId = (
          (bm["backendModelId"] ?? bm["backend_model_id"]) as string | undefined
        )?.trim();
        if (!backendModelId) {
          return reply.status(400).send({
            error: "backendModelId is required for each backend mapping",
          });
        }
        // Several models from one backend may be mapped (as with POST .../backends);
        // only an identical backend + model pair is a duplicate.
        const mappingKey = `${backendId}::${backendModelId}`;
        if (seenMappings.has(mappingKey)) {
          return reply.status(409).send({
            error: `Backend model '${backendModelId}' on backend '${backendId}' is listed more than once`,
          });
        }
        seenMappings.add(mappingKey);
        normalizedMappings.push({
          backendId,
          backendModelId,
          weight: (bm["weight"] as number) ?? 1,
          enabled: (bm["enabled"] as boolean) ?? true,
        });
      }
    }

    // A v-model's kind is immutable once it has members, so it must be settled here.
    // If not given explicitly, infer "embedding" only when every supplied member
    // positively classifies as an embedding model; otherwise default to "chat".
    const explicitKind = parseVModelKind(body["kind"]);
    let kind: VModelKind = explicitKind ?? "chat";
    if (!explicitKind && normalizedMappings.length > 0) {
      const allEmbeddings = await Promise.all(
        normalizedMappings.map(async (m) => {
          const backend = await ctx.db.db
            .select()
            .from(backendsTable)
            .where(eq(backendsTable.id, m.backendId))
            .get();
          if (!backend) return false;
          const { kind: memberKind, positive } = backendKindResolver(backend)(m.backendModelId);
          return positive && memberKind === "embeddings";
        }),
      );
      if (allEmbeddings.every(Boolean)) kind = "embedding";
    }

    for (const mapping of normalizedMappings) {
      const validation = await validateMember(ctx, kind, trimmedModelId, mapping.backendId, mapping.backendModelId);
      if (!validation.ok) {
        return reply.status(validation.status).send({ error: validation.error });
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
          kind,
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

      if (body["kind"] !== undefined) {
        const requestedKind = parseVModelKind(body["kind"]);
        if (!requestedKind) {
          return reply.status(400).send({ error: "kind must be 'chat' or 'embedding'" });
        }
        if (requestedKind !== vm.kind) {
          const memberCount = await ctx.db.db
            .select({ id: vmodelBackendsTable.id })
            .from(vmodelBackendsTable)
            .where(eq(vmodelBackendsTable.vmodelId, req.params.id))
            .all();
          if (memberCount.length > 0) {
            return reply.status(409).send({
              error: "Cannot change kind while backend models are mapped",
            });
          }
          updates.kind = requestedKind;
        }
      }

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
        .select({ id: vmodelsTable.id, kind: vmodelsTable.kind, modelId: vmodelsTable.modelId })
        .from(vmodelsTable)
        .where(eq(vmodelsTable.id, req.params.id))
        .get();
      if (!vm) {
        return reply.status(404).send({ error: "VModel not found" });
      }
      const vmodelKind = parseVModelKind(vm.kind) ?? "chat";

      const validation = await validateMember(ctx, vmodelKind, vm.modelId, backendId, backendModelId);
      if (!validation.ok) {
        return reply.status(validation.status).send({ error: validation.error });
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
      const mapping = await ctx.db.db
        .select({ id: vmodelBackendsTable.id })
        .from(vmodelBackendsTable)
        .where(
          and(
            eq(vmodelBackendsTable.id, req.params.backendMappingId),
            eq(vmodelBackendsTable.vmodelId, req.params.id),
          ),
        )
        .get();
      if (!mapping) {
        return reply.status(404).send({ error: "Backend mapping not found" });
      }

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

      const mapping = await ctx.db.db
        .select({ id: vmodelBackendsTable.id })
        .from(vmodelBackendsTable)
        .where(
          and(
            eq(vmodelBackendsTable.id, req.params.backendMappingId),
            eq(vmodelBackendsTable.vmodelId, req.params.id),
          ),
        )
        .get();
      if (!mapping) {
        return reply.status(404).send({ error: "Backend mapping not found" });
      }

      await ctx.db.db
        .update(vmodelBackendsTable)
        .set({ weight })
        .where(eq(vmodelBackendsTable.id, req.params.backendMappingId))
        .run();

      await recomputeAllVModelHealth(ctx.db, ctx.sse);
      return reply.status(200).send({ success: true });
    },
  );
}
