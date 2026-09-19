import { createServer, type Server } from "node:http";
import { getPort } from "./ports.js";

/**
 * A single request captured by the recording upstream.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  raw: string;
}

export interface StartedRecordingUpstream {
  port: number;
  url: string;
  /** Every request captured so far, in arrival order. */
  received: RecordedRequest[];
  /** The most recently captured chat-completion request. */
  lastRequest: () => RecordedRequest | undefined;
  reset: () => void;
  stop: () => Promise<void>;
}

export interface RecordingUpstreamOptions {
  /** Model ids advertised on GET /v1/models. */
  models?: string[];
  /** Reasoning ("thinking") deltas emitted before the content deltas. */
  reasoningChunks?: string[];
  /** Visible content deltas. */
  contentChunks?: string[];
  /** Value reported as usage.completion_tokens_details.reasoning_tokens (vllm dialect only). */
  reasoningTokens?: number;
  /**
   * Which real backend's measured behaviour to simulate — see
   * docs/guide/debugging-thinking.md for the full matrix.
   *   "vllm": reasoning field `reasoning`, ENFORCES `thinking_token_budget` exactly
   *     (truncates reasoning chunks to the requested count), reports
   *     completion_tokens_details.reasoning_tokens.
   *   "omlx": reasoning field `reasoning_content`, ACCEPTS `thinking_token_budget` but
   *     ignores it (emits the full reasoning regardless), never reports
   *     completion_tokens_details.
   * Both honour `chat_template_kwargs.enable_thinking:false` (emit no reasoning at all)
   * and `stream_options.include_usage`.
   */
  dialect?: "vllm" | "omlx";
}

const DEFAULTS = {
  models: ["recorded-model"],
  reasoningChunks: ["Let me ", "think about ", "this."],
  contentChunks: ["The answer ", "is 391."],
  reasoningTokens: 12,
  dialect: "vllm" as const,
};

/**
 * A minimal OpenAI-compatible upstream that records the exact request body it
 * received and replies with reasoning-bearing responses in either measured dialect.
 *
 * `@haai/mock-backend` cannot be used for thinking-budget tests: it neither exposes the
 * received body nor emits reasoning deltas.
 */
export async function startRecordingUpstream(
  opts: RecordingUpstreamOptions = {},
): Promise<StartedRecordingUpstream> {
  const port = await getPort();
  const models = opts.models ?? DEFAULTS.models;
  const allReasoningChunks = opts.reasoningChunks ?? DEFAULTS.reasoningChunks;
  const contentChunks = opts.contentChunks ?? DEFAULTS.contentChunks;
  const reasoningTokens = opts.reasoningTokens ?? DEFAULTS.reasoningTokens;
  const dialect = opts.dialect ?? DEFAULTS.dialect;
  const reasoningField = dialect === "omlx" ? "reasoning_content" : "reasoning";

  const received: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";

    if (req.method === "GET" && path.endsWith("/v1/models")) {
      const payload = {
        object: "list",
        data: models.map((id) => ({
          id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "recording-upstream",
        })),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method !== "POST" || !path.endsWith("/v1/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${path}` } }));
      return;
    }

    const bodyChunks: Buffer[] = [];
    req.on("data", (c: Buffer) => bodyChunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(bodyChunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Record the raw text even if it is not valid JSON.
      }

      received.push({
        method: req.method ?? "POST",
        path,
        headers: req.headers,
        body,
        raw,
      });

      const id = `chatcmpl-rec-${received.length}`;
      const created = Math.floor(Date.now() / 1000);
      const model = (body["model"] as string | undefined) ?? "recorded-model";

      const ctk = body["chat_template_kwargs"] as Record<string, unknown> | undefined;
      const thinkingDisabled = ctk?.["enable_thinking"] === false;
      const requestedBudget =
        typeof body["thinking_token_budget"] === "number" ? (body["thinking_token_budget"] as number) : null;

      let reasoningChunks: string[] = thinkingDisabled ? [] : allReasoningChunks;
      let effectiveReasoningTokens = thinkingDisabled ? 0 : reasoningTokens;
      // vLLM enforces the budget exactly (measured: 50->49, 200->199 reasoning tokens);
      // oMLX accepts the parameter but ignores it — ship the full reasoning regardless.
      if (!thinkingDisabled && dialect === "vllm" && requestedBudget !== null) {
        let acc = "";
        const truncated: string[] = [];
        for (const c of allReasoningChunks) {
          if (acc.length >= requestedBudget) break;
          truncated.push(c);
          acc += c;
        }
        reasoningChunks = truncated;
        effectiveReasoningTokens = Math.min(requestedBudget, reasoningTokens);
      }

      const usage: Record<string, unknown> = {
        prompt_tokens: 9,
        completion_tokens: effectiveReasoningTokens + contentChunks.length,
        total_tokens: 9 + effectiveReasoningTokens + contentChunks.length,
      };
      if (dialect === "vllm") {
        usage["completion_tokens_details"] = { reasoning_tokens: effectiveReasoningTokens };
      }

      // The proxy treats anything other than an explicit `stream: false` as streaming.
      if (body["stream"] === false) {
        const message: Record<string, unknown> = { role: "assistant", content: contentChunks.join("") };
        if (reasoningChunks.length > 0) message[reasoningField] = reasoningChunks.join("");
        const payload = {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message, finish_reason: "stop" }],
          usage,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
      });

      send(chunk({ role: "assistant", content: "" }));
      for (const r of reasoningChunks) send(chunk({ [reasoningField]: r }));
      for (const c of contentChunks) send(chunk({ content: c }));
      send(chunk({}, "stop"));

      const streamOptions = body["stream_options"] as Record<string, unknown> | undefined;
      if (streamOptions?.["include_usage"]) {
        send({ id, object: "chat.completion.chunk", created, model, choices: [], usage });
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    received,
    lastRequest: () => received[received.length - 1],
    reset: () => {
      received.length = 0;
    },
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
