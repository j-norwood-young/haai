import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { fetch } from "undici";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  buildBackendApiUrl,
  decrypt,
  isBackendAllowed,
  isVModelAllowed,
  parseAllowedList,
} from "@haai/core";
import type { AppContext } from "../../context.js";

export async function modelsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/v1/models", async (req, reply) => {
    const authHeader = req.headers.authorization;
    const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!rawKey) {
      return reply.status(401).send({
        error: { message: "Missing Authorization header", type: "auth_error" },
      });
    }

    const authResult = await ctx.keyAuth.authenticate(rawKey);
    if (!authResult.success) {
      return reply.status(authResult.status).send({
        error: { message: authResult.error, type: "auth_error", code: authResult.code },
      });
    }

    const key = authResult.key;
    const allowedVModels = parseAllowedList(key.allowedModels);
    const allowedBackendIds = parseAllowedList(key.allowedBackends);

    const models: Array<{
      id: string;
      object: "model";
      created: number;
      owned_by: string;
      context_length: number | undefined;
    }> = [];

    const allBackends = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.enabled, true))
      .all();

    const visibleBackends = allBackends.filter((backend) =>
      isBackendAllowed(allowedBackendIds, backend.id),
    );

    await Promise.allSettled(
      visibleBackends.map(async (backend) => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (backend.keyMode === "abstraction" && backend.encryptedApiKey) {
            const apiKey = decrypt(backend.encryptedApiKey, ctx.masterKey);
            headers["Authorization"] = `Bearer ${apiKey}`;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(buildBackendApiUrl(backend.baseUrl, "/v1/models"), {
            headers,
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) return;

          const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
          for (const model of data.data ?? []) {
            const rawId = model["id"] as string;
            const namespacedId = `${rawId}:${backend.hostName}:${backend.provider}`;
            models.push({
              id: namespacedId,
              object: "model",
              created: (model["created"] as number) ?? Math.floor(Date.now() / 1000),
              owned_by: `${backend.hostName}:${backend.provider}`,
              context_length: model["context_length"] as number | undefined,
            });
          }
        } catch {
          // Backend unavailable — skip it
        }
      }),
    );

    const allVModels = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(and(eq(vmodelsTable.enabled, true)))
      .all();

    for (const vm of allVModels) {
      if (!isVModelAllowed(allowedVModels, vm.modelId, vm.id)) continue;
      models.push({
        id: vm.modelId,
        object: "model",
        created: Math.floor(vm.createdAt / 1000),
        owned_by: "haai",
        context_length: undefined,
      });
    }

    return reply.send({
      object: "list",
      data: models,
    });
  });
}
