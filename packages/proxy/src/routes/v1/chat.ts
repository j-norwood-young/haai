import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
} from "@haai/core";
import { buildBackendApiUrl, decrypt } from "@haai/core";
import type { AppContext } from "../../context.js";
import { streamingProxy, type ProxyResult } from "../../streaming-proxy.js";
import { UsageRecorder } from "../../usage-recorder.js";
import {
  filterAvailableCandidates,
  type BackendCandidate,
} from "../../balancer.js";
import type { Backend } from "@haai/core";
import type { ChatRequest, ChatResponse } from "@haai/plugin-sdk";
import { resolveBindings } from "../../plugins/loader.js";
import type { PluginHostContext } from "../../plugins/runtime.js";

function isRetryableUpstreamFailure(result: ProxyResult): boolean {
  if (result.statusCode === 404) return true;
  if (result.statusCode >= 500) return true;
  const err = (result.error ?? "").toLowerCase();
  if (err.includes("model") && (err.includes("not found") || err.includes("does not exist"))) {
    return true;
  }
  return false;
}

function mapBackendRow(row: typeof backendsTable.$inferSelect): Backend {
  return row as unknown as Backend;
}

export async function chatRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const recorder = new UsageRecorder(ctx.db, ctx.sse);

  app.post("/v1/chat/completions", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const requestedModel = body["model"] as string | undefined;

    if (!requestedModel) {
      return reply.status(400).send({ error: { message: "model is required", type: "invalid_request_error" } });
    }

    // Authenticate key
    const authHeader = req.headers.authorization;
    const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!rawKey) {
      return reply.status(401).send({ error: { message: "Missing Authorization header", type: "auth_error" } });
    }

    const authResult = await ctx.keyAuth.authenticate(rawKey);
    if (!authResult.success) {
      return reply.status(authResult.status).send({
        error: { message: authResult.error, type: "auth_error", code: authResult.code },
      });
    }

    const key = authResult.key;
    const hasTools = Array.isArray(body["tools"]) && (body["tools"] as unknown[]).length > 0;
    const hasVision = Array.isArray(body["messages"]) &&
      (body["messages"] as Array<Record<string, unknown>>).some(
        (m) => Array.isArray(m["content"]) &&
          (m["content"] as Array<Record<string, unknown>>).some((c) => c["type"] === "image_url"),
      );

    const budgetCheck = await ctx.keyAuth.checkTokenBudget(key);
    if (!budgetCheck.allowed) {
      return reply.status(429).send({
        error: { message: budgetCheck.error, type: "rate_limit_error" },
      });
    }

    // Resolve model — is it a v-model or direct backend model?
    const vmodel = await ctx.db.db
      .select()
      .from(vmodelsTable)
      .where(and(eq(vmodelsTable.modelId, requestedModel), eq(vmodelsTable.enabled, true)))
      .get();

    let candidates: BackendCandidate[] = [];

    if (vmodel) {
      const vmBackends = await ctx.db.db
        .select()
        .from(vmodelBackendsTable)
        .where(
          and(
            eq(vmodelBackendsTable.vmodelId, vmodel.id),
            eq(vmodelBackendsTable.enabled, true),
          ),
        )
        .all();

      for (const vmb of vmBackends) {
        const backend = await ctx.db.db
          .select()
          .from(backendsTable)
          .where(eq(backendsTable.id, vmb.backendId))
          .get();
        if (backend) {
          candidates.push({
            backendId: backend.id,
            backend: mapBackendRow(backend),
            backendModelId: vmb.backendModelId,
            weight: vmb.weight,
          });
        }
      }
    } else {
      // Direct namespaced model lookup: "model:hostname:provider"
      const parts = requestedModel.split(":");
      if (parts.length >= 3) {
        const modelId = parts.slice(0, -2).join(":");
        const hostName = parts[parts.length - 2];
        const provider = parts[parts.length - 1];

        const backend = await ctx.db.db
          .select()
          .from(backendsTable)
          .where(
            and(
              eq(backendsTable.hostName, hostName ?? ""),
              eq(backendsTable.provider, provider ?? ""),
              eq(backendsTable.enabled, true),
            ),
          )
          .get();

        if (backend) {
          candidates.push({
            backendId: backend.id,
            backend: mapBackendRow(backend),
            backendModelId: modelId,
            weight: backend.weight,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return reply.status(404).send({
        error: { message: `Model '${requestedModel}' not found`, type: "invalid_request_error" },
      });
    }

    const capabilities = { tools: hasTools, vision: hasVision };
    const modelAccess = vmodel
      ? await ctx.keyAuth.checkVModelAccess(key, requestedModel, capabilities, vmodel.id)
      : await ctx.keyAuth.checkBackendAccess(key, candidates[0]!.backendId, capabilities);
    if (!modelAccess.allowed) {
      return reply.status(403).send({ error: { message: modelAccess.error, type: "permission_error" } });
    }

    const availableCandidates = filterAvailableCandidates(candidates);
    if (availableCandidates.length === 0) {
      const detail =
        vmodel?.lastHealthError ??
        "All configured backends are unhealthy or missing the required model";
      return reply.status(503).send({
        error: {
          message: `No available backends for model '${requestedModel}': ${detail}`,
          type: "server_error",
        },
      });
    }

    const sessionKey = key.id;
    const strategy = (vmodel?.balancingStrategy ?? "session-pin") as
      | "session-pin"
      | "round-robin"
      | "weighted"
      | "least-connections"
      | "least-latency";

    const spentKeys = new Set<string>();
    const candidateKey = (c: BackendCandidate) => `${c.backendId}::${c.backendModelId}`;

    let selected: BackendCandidate | null = null;
    let proxyResult: ProxyResult | null = null;
    let lastErrorBody: string | undefined;

    while (true) {
      const remaining = availableCandidates.filter((c) => !spentKeys.has(candidateKey(c)));
      selected = ctx.balancer.select(remaining, strategy, sessionKey);
      if (!selected) {
        break;
      }

      spentKeys.add(candidateKey(selected));

      let upstreamApiKey: string | null = null;
      if (selected.backend.keyMode === "abstraction" && selected.backend.encryptedApiKey) {
        upstreamApiKey = decrypt(selected.backend.encryptedApiKey, ctx.masterKey);
      } else if (selected.backend.keyMode === "passthrough") {
        upstreamApiKey = rawKey;
      }

      const bindings = await resolveBindings(ctx.db, {
        vmodelId: vmodel?.id ?? null,
        backendId: selected.backendId,
        keyId: key.id,
      });

      const needsBuffer = bindings.some((b) => b.needsResponseBuffer);

      const pluginHostCtx: PluginHostContext = {
        vmodelId: vmodel?.id ?? "",
        backendId: selected.backendId,
        backendModelId: selected.backendModelId,
        keyPrefix: key.prefix,
        timestamp: Date.now(),
        aiComplete: async (opts) => {
          const { fetch: _fetch } = await import("undici");
          const aiBody = { ...opts, __haaiInternal: true };
          const res = await _fetch(buildBackendApiUrl(selected!.backend.baseUrl, "/v1/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(upstreamApiKey ? { Authorization: `Bearer ${upstreamApiKey}` } : {}),
            },
            body: JSON.stringify(aiBody),
          });
          if (!res.ok) throw new Error(`ai.complete upstream error: ${res.status}`);
          return res.json() as Promise<ChatResponse>;
        },
      };

      let mutatedBody: ChatRequest = { ...body } as ChatRequest;
      for (const binding of bindings) {
        mutatedBody = await ctx.pluginRuntime.runOnRequest(binding, mutatedBody, pluginHostCtx);
      }

      const upstreamBody = { ...mutatedBody, model: selected.backendModelId };
      const hasMoreCandidates = remaining.length > 1;

      const attemptStart = Date.now();
      const liveId = ctx.live.startRequest({
        keyPrefix: key.prefix,
        vmodelId: vmodel?.id ?? null,
        vmodelName: requestedModel,
        backendId: selected.backendId,
        backendName: selected.backend.name,
        backendModelId: selected.backendModelId,
        stream: body["stream"] !== false,
        attempt: spentKeys.size,
      });

      ctx.balancer.incrementConcurrency(selected.backendId);

      try {
        proxyResult = await streamingProxy(reply, {
          upstreamUrl: buildBackendApiUrl(selected.backend.baseUrl, "/v1/chat/completions"),
          upstreamApiKey,
          requestBody: upstreamBody,
          vmodelId: vmodel?.id ?? "direct",
          backendId: selected.backendId,
          backendName: selected.backend.name,
          modelId: selected.backendModelId,
          keyPrefix: key.prefix,
          bufferResponse: needsBuffer,
          suppressClientError: hasMoreCandidates,
          onFirstToken: () => ctx.live.firstToken(liveId),
          onProgress: (completionTokens) => ctx.live.progress(liveId, completionTokens),
        });
      } finally {
        ctx.balancer.decrementConcurrency(selected.backendId);
        ctx.live.end(liveId, {
          statusCode: proxyResult?.statusCode ?? 0,
          durationMs: Date.now() - attemptStart,
        });
      }

      const cb = ctx.balancer.getCircuitBreaker(selected.backendId, selected.backend.name);
      if (proxyResult.statusCode >= 500) {
        cb.recordFailure();
      } else if (proxyResult.statusCode < 400) {
        cb.recordSuccess();
      }

      // Successful path already wrote to the client (or buffered for plugins).
      if (proxyResult.statusCode < 400 || reply.sent) {
        if (needsBuffer && proxyResult.bufferedResponse && !reply.sent) {
          let transformedResponse = proxyResult.bufferedResponse;
          const responseBindings = bindings.filter((b) => b.needsResponseBuffer);
          for (const binding of responseBindings) {
            transformedResponse = await ctx.pluginRuntime.runOnResponse(
              binding,
              transformedResponse,
              pluginHostCtx,
            );
          }
          if (body["stream"] !== false) {
            reply.raw.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            reply.raw.write(`data: ${JSON.stringify(transformedResponse)}\n\n`);
            reply.raw.write("data: [DONE]\n\n");
            reply.raw.end();
          } else {
            reply.status(200).header("Content-Type", "application/json").send(JSON.stringify(transformedResponse));
          }
        }

        recorder.record({
          ...proxyResult,
          keyId: key.id,
          keyPrefix: key.prefix,
          vmodelId: vmodel?.id ?? null,
          vmodelModelId: requestedModel,
          backendId: selected.backendId,
          backendModelId: selected.backendModelId,
          backendName: selected.backend.displayName || selected.backend.name,
          endpoint: "/v1/chat/completions",
          shouldLogRequest: key.logRequests,
          requestSize: JSON.stringify(body).length,
          responseSize: proxyResult.responseBody?.length ?? 0,
        }).catch(() => {});

        if (proxyResult.totalTokens > 0) {
          ctx.keyAuth.consumeTokenBudget(key.id, proxyResult.totalTokens).catch(() => {});
        }

        return reply;
      }

      // Pre-stream failure — record and maybe retry another mapping.
      lastErrorBody = proxyResult.error;
      recorder.record({
        ...proxyResult,
        keyId: key.id,
        keyPrefix: key.prefix,
        vmodelId: vmodel?.id ?? null,
        vmodelModelId: requestedModel,
        backendId: selected.backendId,
        backendModelId: selected.backendModelId,
        backendName: selected.backend.displayName || selected.backend.name,
        endpoint: "/v1/chat/completions",
        shouldLogRequest: key.logRequests,
        requestSize: JSON.stringify(body).length,
        responseSize: 0,
      }).catch(() => {});

      if (!isRetryableUpstreamFailure(proxyResult)) {
        break;
      }
      // else continue loop with remaining candidates
    }

    if (!reply.sent) {
      const status = proxyResult?.statusCode && proxyResult.statusCode >= 400 ? proxyResult.statusCode : 503;
      let message = `No available backends for model '${requestedModel}'`;
      if (lastErrorBody) {
        try {
          const parsed = JSON.parse(lastErrorBody) as { error?: { message?: string } | string };
          if (typeof parsed.error === "string") message = parsed.error;
          else if (parsed.error?.message) message = parsed.error.message;
        } catch {
          if (lastErrorBody.length < 300) message = lastErrorBody;
        }
      }
      return reply.status(status >= 400 && status < 600 ? status : 503).send({
        error: { message, type: "server_error" },
      });
    }

    return reply;
  });
}
