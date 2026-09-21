import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
  isBackendAllowed,
  isVModelAllowed,
  parseAllowedList,
  parseModelCatalogJson,
  resolveReasoningCaps,
  modelKindWireValue,
} from "@haai/core";
import type { Backend, ResolvedReasoningCaps } from "@haai/core";
import type { AppContext } from "../../context.js";

interface ModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  context_length: number | undefined;
  /** LM Studio-style convention: distinguishes chat/vision models from embedding models,
   * so a client (or a human reading the catalog) can tell which endpoint a model belongs
   * on. Never "unknown" on the wire — an unclassified model reports as "llm". */
  type: "llm" | "vlm" | "embeddings";
  /** OpenRouter-style de facto convention. Only includes "reasoning" when a backend
   * actually enforces a token budget — claiming it for a backend that merely accepts
   * and ignores the parameter would repeat the exact silent lie this feature exists to
   * eliminate. See docs/guide/debugging-thinking.md. */
  supported_parameters?: string[];
  /** Ollama-style de facto convention: true for any backend that can think at all,
   * regardless of whether it can budget that thinking. */
  capabilities?: string[];
  haai?: { provider?: string; reasoning?: Record<string, unknown> };
}

function reasoningAdvertisement(caps: ResolvedReasoningCaps): {
  supportedParameters: string[];
  capabilities: string[];
} {
  const supportedParameters: string[] = [];
  if (caps.toggle === "chat_template_kwargs") supportedParameters.push("chat_template_kwargs.enable_thinking");
  if (caps.toggle === "reasoning_effort") supportedParameters.push("reasoning_effort");
  if (caps.budget.enforcement === "exact" && caps.budget.param) {
    supportedParameters.push("reasoning", caps.budget.param);
  }
  const capabilities = caps.toggle !== "none" || caps.channel !== "none" ? ["thinking"] : [];
  return { supportedParameters, capabilities };
}

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

    const models: ModelEntry[] = [];

    const allBackends = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(eq(backendsTable.enabled, true))
      .all();

    const visibleBackends = allBackends.filter((backend) =>
      isBackendAllowed(allowedBackendIds, backend.id),
    );

    // Model catalogs are read from the DB, never fetched live here — they're kept
    // fresh by the background health poll (see health.ts), which is what makes
    // this endpoint fast regardless of backend latency.
    const fetchedAt = Math.floor(Date.now() / 1000);
    for (const backend of visibleBackends) {
      const catalog = parseModelCatalogJson(backend.modelCatalog);
      if (!catalog) continue;

      const caps = resolveReasoningCaps(backend as unknown as Backend);
      const { supportedParameters, capabilities } = reasoningAdvertisement(caps);

      for (const entry of catalog) {
        const namespacedId = `${entry.id}:${backend.hostName}:${backend.provider}`;
        models.push({
          id: namespacedId,
          object: "model",
          created: fetchedAt,
          owned_by: `${backend.hostName}:${backend.provider}`,
          context_length: entry.contextLength,
          type: modelKindWireValue(entry.kind),
          ...(supportedParameters.length ? { supported_parameters: supportedParameters } : {}),
          ...(capabilities.length ? { capabilities } : {}),
          haai: {
            provider: backend.provider,
            reasoning: {
              supported: capabilities.includes("thinking"),
              toggle: caps.toggle,
              budget: caps.budget,
              channel: caps.channel,
              usage_reasoning_tokens: caps.usageReasoningTokens,
              stream_usage: caps.streamUsage,
              normalized_fields: ["reasoning", "reasoning_content"],
              source: caps.source,
            },
          },
        });
      }
    }

    const allVModels = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(and(eq(vmodelsTable.enabled, true)))
      .all();

    for (const vm of allVModels) {
      if (!isVModelAllowed(allowedVModels, vm.modelId, vm.id)) continue;

      const mappings = await ctx.db.db
        .select({ backendId: vmodelBackendsTable.backendId })
        .from(vmodelBackendsTable)
        .where(and(eq(vmodelBackendsTable.vmodelId, vm.id), eq(vmodelBackendsTable.enabled, true)))
        .all();
      const memberBackendIds = new Set(mappings.map((m) => m.backendId));
      const memberCaps = allBackends
        .filter((b) => memberBackendIds.has(b.id))
        .map((b) => resolveReasoningCaps(b as unknown as Backend));

      let vmCapabilities: string[] | undefined;
      let vmHaai: ModelEntry["haai"];
      if (memberCaps.length > 0) {
        const anyThinks = memberCaps.some((c) => c.toggle !== "none" || c.channel !== "none");
        if (anyThinks) vmCapabilities = ["thinking"];
        const capableCount = memberCaps.filter((c) => c.budget.enforcement === "exact").length;
        vmHaai = {
          reasoning: {
            supported: anyThinks,
            guaranteed: capableCount === memberCaps.length && capableCount > 0,
            capable_backends: capableCount,
            total_backends: memberCaps.length,
            normalized_fields: ["reasoning", "reasoning_content"],
            source: "vmodel-aggregate",
          },
        };
      }

      models.push({
        id: vm.modelId,
        object: "model",
        created: Math.floor(vm.createdAt / 1000),
        owned_by: "haai",
        context_length: undefined,
        type: vm.kind === "embedding" ? "embeddings" : "llm",
        ...(vmCapabilities ? { capabilities: vmCapabilities } : {}),
        ...(vmHaai ? { haai: vmHaai } : {}),
      });
    }

    return reply.send({
      object: "list",
      data: models,
    });
  });
}
