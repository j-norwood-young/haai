import type { FastifyInstance } from "fastify";
import { fetch } from "undici";
import { buildBackendApiUrl } from "@haai/core";
import type { AppContext } from "../../context.js";
import {
  filterAvailableCandidates,
  type BackendCandidate,
} from "../../balancer.js";
import { resolveModelRoute, isRetryableUpstreamFailure, upstreamApiKeyFor } from "../../model-routing.js";
import { UsageRecorder } from "../../usage-recorder.js";
import { httpRequestsTotal, httpRequestDurationMs } from "../../metrics.js";

const EMBEDDINGS_TIMEOUT_MS = 60_000; // TODO: move to config/schema.ts once an upstream-timeout setting exists.

interface EmbeddingsAttemptResult {
  statusCode: number;
  promptTokens: number;
  totalTokens: number;
  error?: string;
  responseBody?: string;
}

export async function embeddingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const recorder = new UsageRecorder(ctx.db, ctx.sse);

  app.post("/v1/embeddings", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const requestedModel = body["model"] as string | undefined;

    if (!requestedModel) {
      return reply.status(400).send({ error: { message: "model is required", type: "invalid_request_error" } });
    }

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

    const budgetCheck = await ctx.keyAuth.checkTokenBudget(key);
    if (!budgetCheck.allowed) {
      return reply.status(429).send({
        error: { message: budgetCheck.error, type: "rate_limit_error" },
      });
    }

    // Resolves either an embedding-kind v-model alias or a pass-through
    // "model:hostName:provider" id. Rejects (400) a chat-kind v-model or a
    // positively-classified chat model, so a chat model can never be reached here.
    const resolved = await resolveModelRoute(ctx, requestedModel, "embedding");
    if (!resolved.ok) {
      const errorBody: { message: string; type: string; param?: string; code?: string } = {
        message: resolved.message,
        type: "invalid_request_error",
      };
      if (resolved.code) {
        errorBody.param = "model";
        errorBody.code = resolved.code;
      }
      return reply.status(resolved.status).send({ error: errorBody });
    }
    const { vmodel, candidates } = resolved;

    if (candidates.length === 0) {
      return reply.status(404).send({
        error: { message: `Model '${requestedModel}' not found`, type: "invalid_request_error" },
      });
    }

    const capabilities = { embeddings: true };
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
    let attemptResult: EmbeddingsAttemptResult | null = null;
    let lastErrorBody: string | undefined;

    while (true) {
      const remaining = availableCandidates.filter((c) => !spentKeys.has(candidateKey(c)));
      selected = ctx.balancer.select(remaining, strategy, sessionKey, {
        counterKey: vmodel?.id ?? requestedModel,
      });
      if (!selected) break;

      spentKeys.add(candidateKey(selected));

      const upstreamApiKey = upstreamApiKeyFor(selected.backend, rawKey, ctx.masterKey);
      const upstreamBody = { ...body, model: selected.backendModelId };

      const liveId = ctx.live.startRequest({
        keyPrefix: key.prefix,
        vmodelId: vmodel?.id ?? null,
        vmodelName: requestedModel,
        backendId: selected.backendId,
        backendName: selected.backend.name,
        backendModelId: selected.backendModelId,
        stream: false,
        attempt: spentKeys.size,
      });

      const attemptStart = Date.now();
      ctx.balancer.incrementConcurrency(selected.backendId);

      try {
        attemptResult = await performEmbeddingsAttempt(selected, upstreamApiKey, upstreamBody);
      } finally {
        ctx.balancer.decrementConcurrency(selected.backendId);
        ctx.live.end(liveId, {
          statusCode: attemptResult?.statusCode ?? 0,
          durationMs: Date.now() - attemptStart,
        });
      }

      const cb = ctx.balancer.getCircuitBreaker(selected.backendId, selected.backend.name);
      if (attemptResult.statusCode >= 500) {
        cb.recordFailure();
      } else if (attemptResult.statusCode < 400) {
        cb.recordSuccess();
      }

      const durationMs = Date.now() - attemptStart;
      recorder
        .record({
          statusCode: attemptResult.statusCode,
          promptTokens: attemptResult.promptTokens,
          completionTokens: 0,
          totalTokens: attemptResult.totalTokens,
          ttftMs: durationMs,
          durationMs,
          tps: null,
          toolCallCount: 0,
          error: attemptResult.error,
          responseBody: attemptResult.responseBody,
          bufferedResponse: null,
          keyId: key.id,
          keyPrefix: key.prefix,
          vmodelId: vmodel?.id ?? null,
          vmodelModelId: requestedModel,
          backendId: selected.backendId,
          backendModelId: selected.backendModelId,
          backendName: selected.backend.displayName || selected.backend.name,
          endpoint: "/v1/embeddings",
          shouldLogRequest: key.logRequests,
          requestSize: JSON.stringify(body).length,
          responseSize: attemptResult.responseBody?.length ?? 0,
        })
        .catch(() => {});

      httpRequestsTotal.inc({
        method: "POST",
        endpoint: "/v1/embeddings",
        status: String(attemptResult.statusCode),
        vmodel: vmodel?.id ?? "direct",
        backend: selected.backend.name,
      });
      httpRequestDurationMs.observe(
        { method: "POST", endpoint: "/v1/embeddings", vmodel: vmodel?.id ?? "direct", backend: selected.backend.name },
        durationMs,
      );

      if (attemptResult.statusCode < 400) {
        if (attemptResult.totalTokens > 0) {
          ctx.keyAuth.consumeTokenBudget(key.id, attemptResult.totalTokens).catch(() => {});
        }
        return reply
          .status(attemptResult.statusCode)
          .header("Content-Type", "application/json")
          .send(attemptResult.responseBody ?? "");
      }

      lastErrorBody = attemptResult.responseBody ?? attemptResult.error;
      if (!isRetryableUpstreamFailure(attemptResult)) break;
      // else continue loop with remaining candidates
    }

    const status =
      attemptResult?.statusCode && attemptResult.statusCode >= 400 ? attemptResult.statusCode : 503;
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
  });
}

async function performEmbeddingsAttempt(
  selected: BackendCandidate,
  upstreamApiKey: string | null,
  upstreamBody: Record<string, unknown>,
): Promise<EmbeddingsAttemptResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (upstreamApiKey) headers["Authorization"] = `Bearer ${upstreamApiKey}`;

  try {
    const res = await fetch(buildBackendApiUrl(selected.backend.baseUrl, "/v1/embeddings"), {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(EMBEDDINGS_TIMEOUT_MS),
    });

    const responseBody = await res.text();

    if (!res.ok) {
      let error = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(responseBody) as { error?: { message?: string } | string };
        if (typeof parsed.error === "string") error = parsed.error;
        else if (parsed.error?.message) error = parsed.error.message;
      } catch {
        // keep the generic HTTP status message
      }
      return { statusCode: res.status, promptTokens: 0, totalTokens: 0, error, responseBody };
    }

    let promptTokens = 0;
    let totalTokens = 0;
    try {
      const parsed = JSON.parse(responseBody) as {
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };
      promptTokens = parsed.usage?.prompt_tokens ?? 0;
      totalTokens = parsed.usage?.total_tokens ?? promptTokens;
    } catch {
      // Some backends omit usage entirely; treat as zero rather than failing the request.
    }

    return { statusCode: res.status, promptTokens, totalTokens, responseBody };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      statusCode: 502,
      promptTokens: 0,
      totalTokens: 0,
      error: isTimeout ? `Upstream request timed out after ${EMBEDDINGS_TIMEOUT_MS}ms` : message,
    };
  }
}
