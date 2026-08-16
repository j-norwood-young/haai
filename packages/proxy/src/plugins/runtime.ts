import { readFileSync } from "node:fs";
import ivm from "isolated-vm";
import type { ChatRequest, ChatResponse } from "@haai/plugin-sdk";
import type { ResolvedBinding } from "@haai/core";
import { getLogger } from "../logger.js";

/** Host-side context passed into every plugin execution */
export interface PluginHostContext {
  vmodelId: string;
  backendId: string;
  backendModelId: string;
  keyPrefix?: string;
  timestamp: number;
  /** Run a chat completion through this proxy's own backend selection */
  aiComplete: (opts: Record<string, unknown>) => Promise<ChatResponse>;
  /** Allowlisted fetch */
  fetch?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text: string; json: unknown }>;
}

const MEMORY_LIMIT_MB = 64;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Plugin runtime that executes sandboxed plugin bundles in isolated-vm V8 isolates.
 * Each plugin bundle is compiled once and cached; execution contexts are created fresh per call.
 */
export class PluginRuntime {
  /** Compiled script cache: pluginId -> compiled Script */
  private scriptCache = new Map<string, ivm.Script>();
  /** Isolate cache: pluginId -> Isolate (one isolate per plugin, contexts are created per-call) */
  private isolateCache = new Map<string, ivm.Isolate>();

  private getIsolate(pluginId: string): ivm.Isolate {
    let isolate = this.isolateCache.get(pluginId);
    if (!isolate || isolate.isDisposed) {
      isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
      this.isolateCache.set(pluginId, isolate);
      this.scriptCache.delete(pluginId); // invalidate cached script for old isolate
    }
    return isolate;
  }

  private async getScript(pluginId: string, bundlePath: string): Promise<ivm.Script> {
    const cached = this.scriptCache.get(pluginId);
    if (cached) return cached;

    const isolate = this.getIsolate(pluginId);
    const code = readFileSync(bundlePath, "utf8");
    const script = await isolate.compileScript(code);
    this.scriptCache.set(pluginId, script);
    return script;
  }

  /**
   * Run a plugin's onRequest hook inside a fresh V8 context.
   * Returns the (possibly modified) request. On error, returns original request.
   */
  async runOnRequest(
    binding: ResolvedBinding,
    request: ChatRequest,
    hostCtx: PluginHostContext,
  ): Promise<ChatRequest> {
    const log = getLogger();
    try {
      return await this.execute<ChatRequest>(binding, "onRequest", request, null, hostCtx);
    } catch (err) {
      log.error(
        { err, pluginId: binding.pluginId, pluginName: binding.pluginName },
        "Plugin onRequest failed — using original request",
      );
      return request;
    }
  }

  /**
   * Run a plugin's onResponse hook inside a fresh V8 context.
   * Returns the (possibly modified) response. On error, returns original response.
   */
  async runOnResponse(
    binding: ResolvedBinding,
    response: ChatResponse,
    hostCtx: PluginHostContext,
  ): Promise<ChatResponse> {
    const log = getLogger();
    try {
      return await this.execute<ChatResponse>(binding, "onResponse", null, response, hostCtx);
    } catch (err) {
      log.error(
        { err, pluginId: binding.pluginId, pluginName: binding.pluginName },
        "Plugin onResponse failed — using original response",
      );
      return response;
    }
  }

  private async execute<T extends ChatRequest | ChatResponse>(
    binding: ResolvedBinding,
    hookName: "onRequest" | "onResponse",
    request: ChatRequest | null,
    response: ChatResponse | null,
    hostCtx: PluginHostContext,
  ): Promise<T> {
    const isolate = this.getIsolate(binding.pluginId);
    const script = await this.getScript(binding.pluginId, binding.bundlePath);
    const ctx = await isolate.createContext();

    try {
      const jail = ctx.global;
      await jail.set("global", jail.derefInto());

      // Inject host capabilities
      await this.injectCapabilities(ctx, jail, binding, hostCtx);

      // Run the bundle to register __haaiPluginDef on globalThis
      await script.run(ctx, { timeout: DEFAULT_TIMEOUT_MS });

      // Build the plugin context object visible inside the isolate
      const pluginCtxJson = JSON.stringify({
        config: binding.config,
        vmodelId: hostCtx.vmodelId,
        backendId: hostCtx.backendId,
        backendModelId: hostCtx.backendModelId,
        keyPrefix: hostCtx.keyPrefix,
        timestamp: hostCtx.timestamp,
      });

      const payloadJson = hookName === "onRequest"
        ? JSON.stringify(request)
        : JSON.stringify(response);

      // Execute the hook inside the isolate
      const resultJson = await ctx.eval(
        `(async () => {
          const def = globalThis.__haaiPluginDef;
          if (!def || !def.hooks || !def.hooks['${hookName}']) {
            return JSON.stringify(${payloadJson});
          }
          const ctx = Object.assign({}, ${pluginCtxJson}, __haaiCapabilities);
          const payload = ${payloadJson};
          const result = await def.hooks['${hookName}'](payload, ctx);
          return JSON.stringify(result != null ? result : payload);
        })()`,
        { timeout: DEFAULT_TIMEOUT_MS, promise: true },
      ) as string;

      return JSON.parse(resultJson) as T;
    } finally {
      ctx.release();
    }
  }

  private async injectCapabilities(
    ctx: ivm.Context,
    jail: ivm.Reference<Record<string | symbol, unknown>>,
    binding: ResolvedBinding,
    hostCtx: PluginHostContext,
  ): Promise<void> {
    const log = getLogger();

    // __haaiCapabilities is merged into ctx inside the isolate
    // We expose each capability as an async function reference

    // ctx.log
    const logFn = new ivm.Reference(
      (level: string, message: string, data?: string) => {
        const parsed = data ? (() => { try { return JSON.parse(data); } catch { return undefined; } })() : undefined;
        log[level as "info" | "warn" | "error" | "debug"]?.(parsed ?? {}, `[plugin:${binding.pluginName}] ${message}`);
      },
    );

    // ctx.ai.complete
    const aiCompleteFn = new ivm.Reference(async (optsJson: string): Promise<string> => {
      const opts = JSON.parse(optsJson) as Record<string, unknown>;
      const result = await hostCtx.aiComplete(opts);
      return JSON.stringify(result);
    });

    // ctx.fetch (basic, host-mediated)
    const fetchFn = hostCtx.fetch
      ? new ivm.Reference(async (url: string, initJson?: string): Promise<string> => {
          const init = initJson ? (JSON.parse(initJson) as Record<string, unknown>) : undefined;
          const result = await hostCtx.fetch!(url, init);
          return JSON.stringify(result);
        })
      : new ivm.Reference(async (_url: string): Promise<string> => {
          throw new Error("ctx.fetch is not available in this context");
        });

    // Build the capabilities glue that wires these references into promise-returning functions
    await jail.set("__haaiLogRef", logFn);
    await jail.set("__haaiAiCompleteRef", aiCompleteFn);
    await jail.set("__haaiFetchRef", fetchFn);
    await jail.set("__haaiCapabilities", undefined); // placeholder

    await ctx.eval(`
      globalThis.__haaiCapabilities = {
        log: (level, msg, data) => __haaiLogRef.apply(undefined, [level, msg, data ? JSON.stringify(data) : undefined]),
        ai: {
          complete: async (opts) => {
            const result = await __haaiAiCompleteRef.apply(undefined, [JSON.stringify(opts)], { result: { promise: true } });
            return JSON.parse(result);
          },
        },
        fetch: async (url, init) => {
          const result = await __haaiFetchRef.apply(undefined, [url, init ? JSON.stringify(init) : undefined], { result: { promise: true } });
          return JSON.parse(result);
        },
      };
    `, { timeout: 5_000 });
  }

  /** Invalidate a cached plugin (e.g. after update) */
  invalidate(pluginId: string): void {
    this.scriptCache.delete(pluginId);
    const isolate = this.isolateCache.get(pluginId);
    if (isolate && !isolate.isDisposed) isolate.dispose();
    this.isolateCache.delete(pluginId);
  }

  /** Dispose all isolates */
  dispose(): void {
    for (const [id, isolate] of this.isolateCache) {
      if (!isolate.isDisposed) isolate.dispose();
      this.isolateCache.delete(id);
    }
    this.scriptCache.clear();
  }
}
