import { Worker } from "node:worker_threads";
import { createHmac } from "node:crypto";
import { fetch } from "undici";
import type {
  ChatRequest,
  ChatResponse,
  HookContext,
  PreRequestHook,
  PostCompletionHook,
} from "@haai/hooks-sdk";
import { getLogger } from "../logger.js";

export interface HookDefinition {
  id: string;
  type: "internal" | "external";
  trigger: "pre-request" | "post-completion";
  module?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  timeoutMs: number;
  config: Record<string, unknown>;
}

export class HookRuntime {
  private moduleCache = new Map<string, { preRequest?: PreRequestHook; postCompletion?: PostCompletionHook }>();

  async runPreRequestHooks(
    hooks: HookDefinition[],
    request: ChatRequest,
    ctx: HookContext,
  ): Promise<ChatRequest> {
    const log = getLogger();
    let current = request;

    for (const hook of hooks.filter((h) => h.trigger === "pre-request")) {
      try {
        if (hook.type === "internal" && hook.module) {
          current = await this.runInternalPreRequest(hook, current, ctx);
        } else if (hook.type === "external" && hook.webhookUrl) {
          current = await this.runExternalPreRequest(hook, current, ctx);
        }
      } catch (err) {
        log.error({ err, hookId: hook.id }, "Pre-request hook failed, continuing with original request");
      }
    }

    return current;
  }

  async runPostCompletionHooks(
    hooks: HookDefinition[],
    response: ChatResponse,
    ctx: HookContext,
    streaming: boolean,
  ): Promise<ChatResponse> {
    const log = getLogger();
    let current = response;

    for (const hook of hooks.filter((h) => h.trigger === "post-completion")) {
      try {
        if (hook.type === "internal" && hook.module) {
          const result = await this.runInternalPostCompletion(hook, current, ctx);
          // Only apply mutation if streaming is disabled
          if (!streaming && result) {
            current = result;
          }
        } else if (hook.type === "external" && hook.webhookUrl) {
          await this.runExternalPostCompletion(hook, current, ctx);
          // External post-completion hooks are always non-mutating
        }
      } catch (err) {
        log.error({ err, hookId: hook.id }, "Post-completion hook failed");
      }
    }

    return current;
  }

  private async runInternalPreRequest(
    hook: HookDefinition,
    request: ChatRequest,
    ctx: HookContext,
  ): Promise<ChatRequest> {
    return new Promise<ChatRequest>((resolve, reject) => {
      const worker = new Worker(
        new URL("./worker.js", import.meta.url),
        {
          workerData: {
            type: "pre-request",
            module: hook.module,
            request,
            ctx: { ...ctx, config: hook.config },
          },
        },
      );

      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Hook ${hook.id} timed out after ${hook.timeoutMs}ms`));
      }, hook.timeoutMs);

      worker.on("message", (result: ChatRequest) => {
        clearTimeout(timer);
        resolve(result);
      });
      worker.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async runInternalPostCompletion(
    hook: HookDefinition,
    response: ChatResponse,
    ctx: HookContext,
  ): Promise<ChatResponse | void> {
    return new Promise<ChatResponse | void>((resolve, reject) => {
      const worker = new Worker(
        new URL("./worker.js", import.meta.url),
        {
          workerData: {
            type: "post-completion",
            module: hook.module,
            response,
            ctx: { ...ctx, config: hook.config },
          },
        },
      );

      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Hook ${hook.id} timed out after ${hook.timeoutMs}ms`));
      }, hook.timeoutMs);

      worker.on("message", (result: ChatResponse | void) => {
        clearTimeout(timer);
        resolve(result);
      });
      worker.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async runExternalPreRequest(
    hook: HookDefinition,
    request: ChatRequest,
    ctx: HookContext,
  ): Promise<ChatRequest> {
    const body = JSON.stringify({ request, ctx });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-HAAI-Hook-Trigger": "pre-request",
    };

    if (hook.webhookSecret) {
      const sig = createHmac("sha256", hook.webhookSecret).update(body).digest("hex");
      headers["X-HAAI-Signature"] = `sha256=${sig}`;
    }

    const res = await fetch(hook.webhookUrl!, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(hook.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`);
    }

    const result = await res.json() as { request?: ChatRequest };
    return result.request ?? request;
  }

  private async runExternalPostCompletion(
    hook: HookDefinition,
    response: ChatResponse,
    ctx: HookContext,
  ): Promise<void> {
    const body = JSON.stringify({ response, ctx });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-HAAI-Hook-Trigger": "post-completion",
    };

    if (hook.webhookSecret) {
      const sig = createHmac("sha256", hook.webhookSecret).update(body).digest("hex");
      headers["X-HAAI-Signature"] = `sha256=${sig}`;
    }

    await fetch(hook.webhookUrl!, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(hook.timeoutMs),
    });
  }
}
