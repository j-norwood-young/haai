import { fetch } from "undici";
import type { RequestInit } from "undici";
import type { FastifyReply } from "fastify";
import type { ChatResponse } from "@haai/plugin-sdk";
import type { ReasoningWarning } from "@haai/core";
import {
  httpRequestsTotal,
  httpRequestDurationMs,
  tokensTotal,
  ttftMs as ttftHistogram,
  tpsGauge,
  toolCallsTotal,
} from "./metrics.js";
import { getLogger } from "./logger.js";
import { aliasReasoningInChunk, aliasReasoningInMessage, aliasReasoningInResponse, buildWarningChunkLine, warningCodesHeader } from "./reasoning/index.js";

export interface ProxyRequestOptions {
  upstreamUrl: string;
  upstreamApiKey: string | null;
  requestBody: Record<string, unknown>;
  vmodelId: string;
  backendId: string;
  backendName: string;
  modelId: string;
  keyPrefix?: string;
  /** When true, buffer the full response (for response-transform plugins) */
  bufferResponse?: boolean;
  /**
   * When true, do not write error responses to the client reply.
   * Used for pre-stream failover retries — the caller sends the final error.
   */
  suppressClientError?: boolean;
  /** Pre-flight reasoning warnings computed in chat.ts from the selected backend's
   * capabilities (e.g. "this backend accepts a budget but doesn't enforce it"). */
  reasoningWarnings?: ReasoningWarning[];
  /**
   * When true, the raw SSE stream is buffered per-line and re-serialised instead of
   * written verbatim, so `reasoning`/`reasoning_content` can be aliased and a trailing
   * warning chunk can be injected before [DONE]. Only set when actually needed (the
   * selected backend's reasoning channel isn't already canonical, or there are warnings
   * to inject) — vLLM's default byte-verbatim fast path is otherwise untouched.
   */
  needsReasoningStreamRewrite?: boolean;
  /** Called once when the first upstream byte/token arrives (TTFT). */
  onFirstToken?: () => void;
  /** Called after each chunk with the running completion token count. */
  onProgress?: (completionTokens: number) => void;
}

export interface ProxyResult {
  statusCode: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ttftMs: number | null;
  durationMs: number;
  tps: number | null;
  toolCallCount: number;
  error: string | undefined;
  responseBody: string | undefined;
  /** Populated only when bufferResponse=true; the parsed ChatResponse for plugin transforms */
  bufferedResponse: ChatResponse | null;
}

export async function streamingProxy(
  reply: FastifyReply,
  opts: ProxyRequestOptions,
): Promise<ProxyResult> {
  const log = getLogger();
  const start = Date.now();
  let ttft: number | null = null;
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCallCount = 0;
  let statusCode = 200;
  let error: string | undefined = undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "haai/1.0",
  };
  if (opts.upstreamApiKey) {
    headers["Authorization"] = `Bearer ${opts.upstreamApiKey}`;
  }

  try {
    const response = await fetch(opts.upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.requestBody),
    } as RequestInit);

    statusCode = response.status;

    if (!response.ok) {
      const body = await response.text();
      error = body;
      httpRequestsTotal.inc({
        method: "POST",
        endpoint: "/v1/chat/completions",
        status: String(statusCode),
        vmodel: opts.vmodelId,
        backend: opts.backendName,
      });
      return {
        statusCode,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        ttftMs: null,
        durationMs: Date.now() - start,
        tps: null,
        toolCallCount: 0,
        error: body,
        responseBody: undefined,
        bufferedResponse: null,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming =
      contentType.includes("text/event-stream") ||
      (opts.requestBody["stream"] !== false);

    // Buffered mode: collect full upstream response for plugin response-transforms
    if (opts.bufferResponse && response.body) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) {
        chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as ArrayBuffer));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const durationMs = Date.now() - start;
      ttft = durationMs;
      opts.onFirstToken?.();

      let bufferedResponse: ChatResponse | null = null;
      try {
        // If streaming, reconstruct a ChatResponse from SSE chunks
        if (isStreaming) {
          bufferedResponse = reconstructResponseFromSse(rawBody);
        } else {
          bufferedResponse = JSON.parse(rawBody) as ChatResponse;
        }
        if (bufferedResponse) {
          aliasReasoningInResponse(bufferedResponse as unknown as Record<string, unknown>);
        }
        const usage = bufferedResponse?.usage;
        if (usage) {
          promptTokens = usage.prompt_tokens;
          completionTokens = usage.completion_tokens;
          totalTokens = usage.total_tokens;
        }
      } catch {
        // Not parseable — fall through with empty stats
      }

      return {
        statusCode: 200,
        promptTokens,
        completionTokens,
        totalTokens,
        ttftMs: ttft,
        durationMs,
        tps: null,
        toolCallCount,
        error: undefined,
        responseBody: rawBody,
        bufferedResponse,
      };
    }

    if (isStreaming && response.body) {
      const streamHeaders: Record<string, string> = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      };
      if (opts.reasoningWarnings?.length) {
        streamHeaders["X-HAAI-Warning"] = warningCodesHeader(opts.reasoningWarnings);
      }
      reply.raw.writeHead(200, streamHeaders);

      const decoder = new TextDecoder();
      let buffer = "";

      if (opts.needsReasoningStreamRewrite) {
        // Buffer-transform-write path: needed to alias reasoning field names and/or
        // inject a warning chunk before [DONE]. vLLM's default fast path (below) is
        // untouched — this only runs for backends whose reasoning channel isn't
        // already canonical, or when there's a warning to attach.
        let warningsSent = false;
        for await (const chunk of response.body) {
          if (ttft === null) {
            ttft = Date.now() - start;
            ttftHistogram.observe({ vmodel: opts.vmodelId, backend: opts.backendName }, ttft);
            opts.onFirstToken?.();
          }

          const text = decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as ArrayBuffer), { stream: true });
          buffer += text;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          const outLines: string[] = [];
          for (const line of lines) {
            if (line === "data: [DONE]") {
              if (opts.reasoningWarnings?.length && !warningsSent) {
                outLines.push(buildWarningChunkLine(opts.reasoningWarnings, opts.modelId));
                warningsSent = true;
              }
              outLines.push(line);
              continue;
            }
            if (!line.startsWith("data: ")) {
              outLines.push(line);
              continue;
            }
            try {
              const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
              if (choices?.[0]) {
                const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
                if (delta?.["content"] || delta?.["reasoning"] || delta?.["reasoning_content"]) completionTokens++;
                const toolCalls = delta?.["tool_calls"] as unknown[] | undefined;
                if (toolCalls?.length) toolCallCount += toolCalls.length;
              }
              const usage = parsed["usage"] as Record<string, number> | undefined;
              if (usage) {
                promptTokens = usage["prompt_tokens"] ?? promptTokens;
                completionTokens = usage["completion_tokens"] ?? completionTokens;
                totalTokens = usage["total_tokens"] ?? totalTokens;
              }
              const changed = aliasReasoningInChunk(parsed);
              outLines.push(changed ? `data: ${JSON.stringify(parsed)}` : line);
            } catch {
              outLines.push(line);
            }
          }
          if (outLines.length) reply.raw.write(outLines.join("\n") + "\n");
          opts.onProgress?.(completionTokens);
        }
        if (buffer) reply.raw.write(buffer);
      } else {
        for await (const chunk of response.body) {
          if (ttft === null) {
            ttft = Date.now() - start;
            ttftHistogram.observe({ vmodel: opts.vmodelId, backend: opts.backendName }, ttft);
            opts.onFirstToken?.();
          }

          const text = decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as ArrayBuffer), { stream: true });
          buffer += text;
          reply.raw.write(text);

          // Parse SSE for token counting
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            try {
              const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
              if (choices?.[0]) {
                const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
                if (delta?.["content"]) completionTokens++;
                const toolCalls = delta?.["tool_calls"] as unknown[] | undefined;
                if (toolCalls?.length) toolCallCount += toolCalls.length;
              }
              const usage = parsed["usage"] as Record<string, number> | undefined;
              if (usage) {
                promptTokens = usage["prompt_tokens"] ?? promptTokens;
                completionTokens = usage["completion_tokens"] ?? completionTokens;
                totalTokens = usage["total_tokens"] ?? totalTokens;
              }
            } catch {
              // Ignore parse errors for individual chunks
            }
          }
          opts.onProgress?.(completionTokens);
        }
      }

      reply.raw.end();
    } else {
      // Non-streaming
      const rawBody = await response.text();
      const durationMs = Date.now() - start;
      let outBody = rawBody;
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        const usage = parsed["usage"] as Record<string, number> | undefined;
        if (usage) {
          promptTokens = usage["prompt_tokens"] ?? 0;
          completionTokens = usage["completion_tokens"] ?? 0;
          totalTokens = usage["total_tokens"] ?? 0;
        }
        const aliased = aliasReasoningInResponse(parsed);
        const hasWarnings = (opts.reasoningWarnings?.length ?? 0) > 0;
        if (hasWarnings) {
          parsed["haai"] = { warnings: opts.reasoningWarnings };
        }
        if (aliased || hasWarnings) {
          outBody = JSON.stringify(parsed);
        }
      } catch {
        // not JSON
      }
      opts.onFirstToken?.();
      opts.onProgress?.(completionTokens);

      const outReply = reply.status(200).header("Content-Type", "application/json");
      if (opts.reasoningWarnings?.length) {
        outReply.header("X-HAAI-Warning", warningCodesHeader(opts.reasoningWarnings));
      }
      outReply.send(outBody);

      return {
        statusCode: 200,
        promptTokens,
        completionTokens,
        totalTokens,
        ttftMs: durationMs,
        durationMs,
        tps: null,
        toolCallCount,
        error: undefined,
        responseBody: outBody,
        bufferedResponse: null,
      };
    }
  } catch (err) {
    statusCode = 502;
    error = err instanceof Error ? err.message : String(err);
    log.error({ err, backend: opts.backendName }, "Upstream request failed");

    if (!opts.suppressClientError && !reply.sent) {
      reply.status(502).send({ error: { message: "Upstream error", type: "proxy_error" } });
    }
  }

  const durationMs = Date.now() - start;
  if (totalTokens === 0) totalTokens = promptTokens + completionTokens;

  // TPS is averaged over the token-generation window only: from the first
  // token to the end of the stream, excluding the TTFT wait.
  const generatingMs = ttft !== null ? Math.max(0, durationMs - ttft) : durationMs;
  const tps = generatingMs > 0 && completionTokens > 0 ? (completionTokens / (generatingMs / 1000)) : null;
  if (tps !== null) tpsGauge.set({ vmodel: opts.vmodelId, backend: opts.backendName }, tps);
  if (totalTokens > 0) {
    tokensTotal.inc({ type: "prompt", vmodel: opts.vmodelId, backend: opts.backendName, key_prefix: opts.keyPrefix ?? "unknown" }, promptTokens);
    tokensTotal.inc({ type: "completion", vmodel: opts.vmodelId, backend: opts.backendName, key_prefix: opts.keyPrefix ?? "unknown" }, completionTokens);
  }
  if (toolCallCount > 0) {
    toolCallsTotal.inc({ vmodel: opts.vmodelId, backend: opts.backendName }, toolCallCount);
  }
  httpRequestsTotal.inc({
    method: "POST",
    endpoint: "/v1/chat/completions",
    status: String(statusCode),
    vmodel: opts.vmodelId,
    backend: opts.backendName,
  });
  httpRequestDurationMs.observe(
    { method: "POST", endpoint: "/v1/chat/completions", vmodel: opts.vmodelId, backend: opts.backendName },
    durationMs,
  );

  return { statusCode, promptTokens, completionTokens, totalTokens, ttftMs: ttft, durationMs, tps, toolCallCount, error, responseBody: undefined, bufferedResponse: null };
}

interface AccumulatingToolCall {
  id?: string;
  type?: string;
  function: { name?: string; arguments: string };
}

/**
 * Reconstruct a single ChatResponse object by concatenating SSE delta chunks.
 * Used when bufferResponse=true for streaming upstreams.
 *
 * Previously this dropped everything except id/model/created/content/finish_reason/usage
 * — silently destroying reasoning output the moment any response-buffering plugin was
 * bound (see tests/e2e/src/thinking-passthrough.test.ts). Fixed to also accumulate
 * `reasoning`, `reasoning_content`, `refusal`, `tool_calls`, and the full `usage` object
 * (including completion_tokens_details), then alias reasoning field names.
 */
function reconstructResponseFromSse(raw: string): ChatResponse {
  const lines = raw.split("\n");
  let id = "";
  let model = "";
  let created = Math.floor(Date.now() / 1000);
  let content = "";
  let reasoning = "";
  let reasoningContent = "";
  let refusal: string | null = null;
  let finishReason: string | null = null;
  let usage: ChatResponse["usage"] | undefined;
  const toolCallsByIndex = new Map<number, AccumulatingToolCall>();

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const chunk = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (!id && chunk["id"]) id = chunk["id"] as string;
      if (!model && chunk["model"]) model = chunk["model"] as string;
      if (chunk["created"]) created = chunk["created"] as number;
      const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
      if (choices?.[0]) {
        const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
        if (delta) {
          if (typeof delta["content"] === "string") content += delta["content"];
          if (typeof delta["reasoning"] === "string") reasoning += delta["reasoning"];
          if (typeof delta["reasoning_content"] === "string") reasoningContent += delta["reasoning_content"];
          if (typeof delta["refusal"] === "string") refusal = (refusal ?? "") + delta["refusal"];
          const toolCalls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const idx = typeof tc["index"] === "number" ? (tc["index"] as number) : 0;
              const existing = toolCallsByIndex.get(idx) ?? { function: { arguments: "" } };
              if (typeof tc["id"] === "string") existing.id = tc["id"] as string;
              if (typeof tc["type"] === "string") existing.type = tc["type"] as string;
              const fn = tc["function"] as Record<string, unknown> | undefined;
              if (fn) {
                if (typeof fn["name"] === "string") existing.function.name = fn["name"] as string;
                if (typeof fn["arguments"] === "string") existing.function.arguments += fn["arguments"] as string;
              }
              toolCallsByIndex.set(idx, existing);
            }
          }
        }
        if (choices[0]["finish_reason"]) finishReason = choices[0]["finish_reason"] as string;
      }
      const u = chunk["usage"] as ChatResponse["usage"] | undefined;
      if (u) usage = u;
    } catch {
      // skip bad chunks
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content };
  if (reasoning) message["reasoning"] = reasoning;
  if (reasoningContent) message["reasoning_content"] = reasoningContent;
  if (refusal !== null) message["refusal"] = refusal;
  if (toolCallsByIndex.size > 0) {
    message["tool_calls"] = [...toolCallsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({ id: tc.id ?? "", type: tc.type ?? "function", function: tc.function }));
  }
  aliasReasoningInMessage(message);

  const result: ChatResponse = {
    id: id || `haai-reconstructed-${Date.now()}`,
    object: "chat.completion",
    created,
    model: model || "unknown",
    choices: [
      {
        index: 0,
        message: message as unknown as ChatResponse["choices"][number]["message"],
        finish_reason: finishReason,
      },
    ],
  };
  if (usage) result.usage = usage;
  return result;
}
