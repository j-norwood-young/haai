import Fastify from "fastify";
import type { MockBackendConfig } from "./config.js";
import {
  generateTokens,
  buildChunk,
  buildDoneChunk,
  buildNonStreamingResponse,
  buildEmbeddingResponse,
  sleep,
  shouldTrigger,
} from "./streaming.js";

export function createMockServer(config: MockBackendConfig) {
  const app = Fastify({ logger: false });

  // Auth middleware
  app.addHook("preHandler", async (req, reply) => {
    if (config.apiKey) {
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token !== config.apiKey) {
        return reply.status(401).send({ error: { message: "Unauthorized", type: "auth_error" } });
      }
    }
  });

  // Health endpoint
  app.get("/health", async () => ({ status: "ok", provider: config.provider }));

  // /v1/models
  app.get("/v1/models", async (req, reply) => {
    const fault = config.fault;
    if (fault?.alwaysDown) return reply.status(503).send({ error: "Service unavailable" });
    if (shouldTrigger(fault?.rateLimitPct)) return reply.status(429).send({ error: { message: "Rate limited" } });
    if (shouldTrigger(fault?.errorPct)) return reply.status(500).send({ error: { message: "Internal error" } });
    if (config.globalLatencyMs) await sleep(config.globalLatencyMs);

    return {
      object: "list",
      data: config.models.map((m) => ({
        id: m.id,
        object: "model",
        created: 1700000000,
        owned_by: config.provider,
        context_length: m.contextLength ?? 4096,
      })),
    };
  });

  // LM Studio-native model kind probe. Only registered for provider "lmstudio" so
  // a "generic" mock genuinely exercises HAAI's probe-404 tolerance path.
  if (config.provider === "lmstudio") {
    app.get("/api/v0/models", async (req, reply) => {
      const fault = config.fault;
      if (fault?.alwaysDown) return reply.status(503).send({ error: "Service unavailable" });
      if (config.globalLatencyMs) await sleep(config.globalLatencyMs);

      return {
        object: "list",
        data: config.models.map((m) => ({
          id: m.id,
          object: "model",
          type: m.kind ?? "llm",
          max_context_length: m.contextLength ?? 4096,
        })),
      };
    });
  }

  // Ollama-native model kind probe. Only registered for provider "ollama".
  if (config.provider === "ollama") {
    app.post("/api/show", async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const modelId = body["model"] as string | undefined;
      const model = config.models.find((m) => m.id === modelId);
      if (!model) return reply.status(404).send({ error: "model not found" });

      return {
        capabilities: model.kind === "embeddings" ? ["embedding"] : ["completion"],
      };
    });

    app.get("/api/tags", async () => ({
      models: config.models.map((m) => ({ name: m.id })),
    }));
  }

  // /v1/chat/completions
  app.post("/v1/chat/completions", async (req, reply) => {
    const fault = config.fault;
    if (fault?.alwaysDown) return reply.status(503).send({ error: "Service unavailable" });
    if (shouldTrigger(fault?.rateLimitPct)) return reply.status(429).send({ error: { message: "Rate limited", type: "tokens" } });
    if (shouldTrigger(fault?.errorPct)) return reply.status(500).send({ error: { message: "Internal error" } });
    if (config.globalLatencyMs) await sleep(config.globalLatencyMs);

    const body = req.body as Record<string, unknown>;
    const modelId = (body["model"] as string) ?? config.models[0]?.id ?? "mock-model-1";
    const stream = body["stream"] !== false;
    const reqId = `chatcmpl-mock-${Date.now()}`;
    const tokenCount = 20;

    // Check if this is a tool call request
    const tools = body["tools"] as unknown[] | undefined;
    const forceTool = tools && tools.length > 0 && Math.random() < 0.3;

    if (!stream) {
      const content = Array.from(generateTokens(tokenCount, fault)).join("");
      return buildNonStreamingResponse(reqId, modelId, content);
    }

    // Streaming response
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Mock-Backend": config.hostName,
    });

    if (fault?.ttftLatencyMs) await sleep(fault.ttftLatencyMs);

    if (forceTool && tools?.[0]) {
      const tool = tools[0] as Record<string, unknown>;
      const toolName = (tool["function"] as Record<string, unknown>)?.["name"] as string ?? "mock_tool";
      reply.raw.write(
        buildChunk(reqId, modelId, "", {
          id: "call_mock_001",
          name: toolName,
          args: '{"query":"mock"}',
        }),
      );
      reply.raw.write(buildDoneChunk(reqId, modelId, "tool_calls"));
      reply.raw.end();
      return reply;
    }

    let tokensSent = 0;
    for (const token of generateTokens(tokenCount, fault)) {
      if (fault?.disconnectMidStreamPct && shouldTrigger(fault.disconnectMidStreamPct)) {
        reply.raw.destroy();
        return reply;
      }
      reply.raw.write(buildChunk(reqId, modelId, token));
      tokensSent++;
      if (fault?.tokenDelayMs) await sleep(fault.tokenDelayMs);
    }

    // If partial stream fault triggered, don't send [DONE]
    if (fault?.partialStreamTokens && tokensSent >= fault.partialStreamTokens) {
      reply.raw.end();
      return reply;
    }

    reply.raw.write(buildDoneChunk(reqId, modelId));
    reply.raw.end();
    return reply;
  });

  // /v1/completions (legacy)
  app.post("/v1/completions", async (req, reply) => {
    const fault = config.fault;
    if (fault?.alwaysDown) return reply.status(503).send({ error: "Service unavailable" });
    if (config.globalLatencyMs) await sleep(config.globalLatencyMs);

    const body = req.body as Record<string, unknown>;
    const modelId = (body["model"] as string) ?? config.models[0]?.id ?? "mock-model-1";
    const stream = body["stream"] !== false;
    const reqId = `cmpl-mock-${Date.now()}`;

    if (!stream) {
      const text = Array.from(generateTokens(15, fault)).join("");
      return {
        id: reqId,
        object: "text_completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ text, index: 0, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
      };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    for (const token of generateTokens(15, fault)) {
      const chunk = {
        id: reqId,
        object: "text_completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ text: token, index: 0, finish_reason: null }],
      };
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (fault?.tokenDelayMs) await sleep(fault.tokenDelayMs);
    }
    reply.raw.write(`data: [DONE]\n\n`);
    reply.raw.end();
    return reply;
  });

  // /v1/embeddings
  app.post("/v1/embeddings", async (req, reply) => {
    const fault = config.fault;
    if (fault?.alwaysDown) return reply.status(503).send({ error: "Service unavailable" });
    if (shouldTrigger(fault?.rateLimitPct)) return reply.status(429).send({ error: { message: "Rate limited" } });
    if (shouldTrigger(fault?.errorPct)) return reply.status(500).send({ error: { message: "Internal error" } });
    if (config.globalLatencyMs) await sleep(config.globalLatencyMs);

    const body = req.body as Record<string, unknown>;
    const modelId = (body["model"] as string) ?? config.models[0]?.id ?? "mock-model-1";
    const model = config.models.find((m) => m.id === modelId);
    // Mirrors a real embeddings-only backend: a chat model requested here is
    // rejected upstream, so a test can assert HAAI never forwards one.
    if (model && model.kind !== "embeddings") {
      return reply.status(400).send({
        error: { message: `Model '${modelId}' does not support embeddings`, type: "invalid_request_error" },
      });
    }
    const input = (body["input"] as string | string[]) ?? "test";
    return buildEmbeddingResponse(modelId, input);
  });

  return app;
}
