import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  modelKindWireValue,
  parseModelCatalogJson,
} from "@haai/core";
import type { AppContext } from "../../context.js";

interface ModelEntry {
  id: string;
  ownedBy: string;
  backendId?: string;
  backendName?: string;
  /** Distinguishes a raw backend model from a v-model alias — unrelated to `modelKind`. */
  type: "backend-model" | "vmodel";
  /** LM Studio-style model classification (chat/vision vs embeddings), used by the
   * plugin config UI's model picker to filter candidates by kind. */
  modelKind: "llm" | "vlm" | "embeddings";
}

/**
 * GET /api/v1/available-models
 * Returns all models from enabled backends' cached catalogs plus all enabled
 * v-models. Reads only from the DB — the catalog is kept fresh by the
 * background health poll (see health.ts), never fetched live on this path,
 * so this route stays fast regardless of backend latency.
 */
export async function availableModelsRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/v1/available-models", async (_req, reply) => {
    const models: ModelEntry[] = [];

    const backends = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.enabled, true))
      .all();

    for (const backend of backends) {
      const catalog = parseModelCatalogJson(backend.modelCatalog);
      if (!catalog) continue;
      for (const entry of catalog) {
        models.push({
          id: `${entry.id}:${backend.hostName}:${backend.provider}`,
          ownedBy: `${backend.hostName}:${backend.provider}`,
          backendId: backend.id,
          backendName: backend.displayName,
          type: "backend-model",
          modelKind: modelKindWireValue(entry.kind),
        });
      }
    }

    // Add all enabled v-models
    const vmodels = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(eq(vmodelsTable.enabled, true))
      .all();

    for (const vm of vmodels) {
      models.push({
        id: vm.modelId,
        ownedBy: "haai",
        type: "vmodel",
        modelKind: vm.kind === "embedding" ? "embeddings" : "llm",
      });
    }

    return reply.send({ models });
  });
}
