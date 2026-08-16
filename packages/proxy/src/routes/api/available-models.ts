import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { backends as backendsTable, vmodels as vmodelsTable } from "@haai/core";
import { buildBackendApiUrl, decrypt } from "@haai/core";
import { fetch } from "undici";
import type { AppContext } from "../../context.js";
import { getLogger } from "../../logger.js";

interface ModelEntry {
  id: string;
  ownedBy: string;
  backendId?: string;
  backendName?: string;
  type: "backend-model" | "vmodel";
}

/**
 * GET /api/v1/available-models
 * Returns all live models from enabled backends plus all enabled v-models.
 * Used by the plugin config UI for the model field picker.
 */
export async function availableModelsRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/v1/available-models", async (_req, reply) => {
    const log = getLogger();
    const models: ModelEntry[] = [];

    // Fetch live models from each enabled backend
    const backends = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.enabled, true))
      .all();

    await Promise.allSettled(
      backends.map(async (backend) => {
        try {
          let apiKey: string | null = null;
          if (backend.keyMode === "abstraction" && backend.encryptedApiKey) {
            apiKey = decrypt(backend.encryptedApiKey, ctx.masterKey);
          }

          const res = await fetch(buildBackendApiUrl(backend.baseUrl, "/v1/models"), {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: AbortSignal.timeout(5_000),
          });

          if (!res.ok) return;

          const data = await res.json() as { data?: Array<{ id: string }> };
          for (const model of data.data ?? []) {
            models.push({
              id: `${model.id}:${backend.hostName}:${backend.provider}`,
              ownedBy: `${backend.hostName}:${backend.provider}`,
              backendId: backend.id,
              backendName: backend.displayName,
              type: "backend-model",
            });
          }
        } catch (err) {
          log.debug({ err, backendId: backend.id }, "Failed to fetch models from backend — skipping");
        }
      }),
    );

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
      });
    }

    return reply.send({ models });
  });
}
