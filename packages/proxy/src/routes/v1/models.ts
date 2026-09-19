import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { fetch } from "undici";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
  buildBackendApiUrl,
  decrypt,
  isBackendAllowed,
  isVModelAllowed,
  parseAllowedList,
  resolveReasoningCaps,
} from "@haai/core";
import type { Backend, ResolvedReasoningCaps } from "@haai/core";
import type { AppContext } from "../../context.js";

interface ModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  context_length: number | undefined;
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

          const caps = resolveReasoningCaps(backend as unknown as Backend);
          const { supportedParameters, capabilities } = reasoningAdvertisement(caps);

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
