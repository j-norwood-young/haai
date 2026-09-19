import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { plugins as pluginsTable, pluginBindings as pluginBindingsTable } from "@haai/core";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import {
  startRecordingUpstream,
  type StartedRecordingUpstream,
} from "./helpers/recording-upstream.js";
import { insertBackend, insertKey, insertVModel } from "./helpers/seed.js";

/**
 * These tests exist because of a support question: "thinking budgets work when I hit
 * http://ripper:8000/v1 directly, but seem to get lost through Haai."
 *
 * The suite below proves the proxy's request path is a byte-faithful passthrough for
 * thinking/reasoning parameters (no allowlist, no schema stripping — see
 * packages/proxy/src/routes/v1/chat.ts and streaming-proxy.ts), and that plain streaming
 * and non-streaming responses relay `reasoning` untouched.
 *
 * The final describe block pins a known, separate gap: when a plugin declares
 * `needsResponseBuffer: true`, the proxy reconstructs the response from SSE chunks and
 * that reconstruction drops `reasoning` entirely (streaming-proxy.ts's
 * `reconstructResponseFromSse`). See docs/guide/debugging-thinking.md for how to tell
 * this apart from the (more likely) cause: a v-model whose balancer can route a request
 * to a non-vLLM backend that doesn't understand these params at all.
 */
describe("Thinking budget request passthrough", () => {
  let upstream: StartedRecordingUpstream;
  let proxy: TestProxy;
  let apiKey: string;
  let backendId: string;

  beforeAll(async () => {
    upstream = await startRecordingUpstream({ models: ["thinking-model"] });
    proxy = await startTestProxy();

    backendId = await insertBackend(proxy, {
      name: "thinking-backend",
      hostName: "thinking-host",
      baseUrl: upstream.url,
      provider: "vllm",
      availableModels: ["thinking-model"],
      lastHealthStatus: "healthy",
    });

    await insertVModel(proxy, {
      modelId: "thinking-chat",
      backends: [{ backendId, backendModelId: "thinking-model" }],
    });

    ({ key: apiKey } = await insertKey(proxy));
  });

  afterAll(async () => {
    await proxy.stop();
    await upstream.stop();
  });

  it("rewrites only `model`, forwarding every thinking-related param verbatim", async () => {
    upstream.reset();
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "thinking-chat",
        messages: [{ role: "user", content: "What is 17*23?" }],
        stream: false,
        temperature: 0.4,
        // vLLM/Qwen native knob — the one that reliably works against ripper directly.
        chat_template_kwargs: { enable_thinking: false, thinking_budget: 64 },
        // OpenAI-style knob — measured as unreliable against ripper, but must still pass through untouched.
        reasoning_effort: "low",
        // Anthropic-style shape — Haai has no /v1/messages translation layer, so this
        // must be relayed as-is rather than dropped or reinterpreted.
        thinking: { type: "enabled", budget_tokens: 1024 },
      }),
    });
    expect(res.status).toBe(200);
    await res.json();

    const sent = upstream.lastRequest();
    expect(sent).toBeDefined();
    expect(sent!.body["model"]).toBe("thinking-model"); // the only field the proxy is allowed to rewrite
    expect(sent!.body["temperature"]).toBe(0.4);
    expect(sent!.body["chat_template_kwargs"]).toEqual({
      enable_thinking: false,
      thinking_budget: 64,
    });
    expect(sent!.body["reasoning_effort"]).toBe("low");
    expect(sent!.body["thinking"]).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("streams reasoning deltas and the reasoning-token usage chunk to the client untouched", async () => {
    upstream.reset();
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "thinking-chat",
        messages: [{ role: "user", content: "What is 17*23?" }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain('"reasoning":"Let me "');
    expect(text).toContain('"reasoning":"think about "');
    expect(text).toContain('"reasoning":"this."');
    expect(text).toContain('"reasoning_tokens":12');
    expect(text).toContain("[DONE]");
  });

  it("preserves message.reasoning on a non-streaming response", async () => {
    upstream.reset();
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "thinking-chat",
        messages: [{ role: "user", content: "What is 17*23?" }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { choices: Array<{ message: Record<string, unknown> }> };
    expect(data.choices[0]!.message["reasoning"]).toBe("Let me think about this.");
  });
});

/**
 * Identity plugin bundle matching what packages/proxy/src/plugins/runtime.ts expects:
 * it must set `globalThis.__haaiPluginDef.hooks`. `needsResponseBuffer` is a column on
 * the `plugins` row (read via resolveBindings in plugins/loader.ts), not something the
 * bundle declares — this bundle's hooks are pure passthroughs so any dropped field is
 * attributable to the buffering/reconstruction path, not to plugin logic.
 */
const IDENTITY_PLUGIN_BUNDLE = `
globalThis.__haaiPluginDef = {
  hooks: {
    onRequest(request) { return request; },
    onResponse(response) { return response; },
  },
};
`;

describe("Known gap: response buffering drops reasoning", () => {
  let upstream: StartedRecordingUpstream;
  let proxy: TestProxy;
  let apiKey: string;

  beforeAll(async () => {
    upstream = await startRecordingUpstream({ models: ["thinking-model"] });
    proxy = await startTestProxy();

    const backendId = await insertBackend(proxy, {
      name: "thinking-backend",
      hostName: "thinking-host",
      baseUrl: upstream.url,
      provider: "vllm",
      availableModels: ["thinking-model"],
      lastHealthStatus: "healthy",
    });

    const vmodelId = await insertVModel(proxy, {
      modelId: "thinking-chat-buffered",
      backends: [{ backendId, backendModelId: "thinking-model" }],
    });

    ({ key: apiKey } = await insertKey(proxy));

    // Install a plugin bundle on disk and register it with needs_response_buffer=1,
    // bound globally to this test's vmodel. This mirrors what an admin-installed
    // response-transform plugin (e.g. redaction, output rewriting) would look like.
    const pluginId = `plugin-${nanoid(8)}`;
    const pluginDir = join(proxy.dataDir, "plugins", pluginId);
    mkdirSync(pluginDir, { recursive: true });
    const bundlePath = join(pluginDir, "bundle.js");
    writeFileSync(bundlePath, IDENTITY_PLUGIN_BUNDLE, "utf8");

    const now = Date.now();
    proxy.db.db
      .insert(pluginsTable)
      .values({
        id: pluginId,
        name: "identity-buffering-plugin",
        description: "Test-only identity plugin that forces response buffering",
        source: "test",
        version: "1.0.0",
        manifest: JSON.stringify({ name: "identity-buffering-plugin", version: "1.0.0" }),
        configSchema: null,
        bundlePath,
        needsResponseBuffer: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    proxy.db.db
      .insert(pluginBindingsTable)
      .values({
        id: `binding-${nanoid(8)}`,
        pluginId,
        scopeType: "vmodel",
        scopeId: vmodelId,
        config: null,
        order: 0,
        enabled: true,
        createdAt: now,
      })
      .run();
  });

  afterAll(async () => {
    await proxy.stop();
    await upstream.stop();
  });

  // Was a known, real defect: streaming-proxy.ts's reconstructResponseFromSse only
  // carried over id/model/created/content/finish_reason/usage, silently dropping
  // `reasoning` (and `tool_calls`, `refusal`) whenever a response-buffering plugin was
  // bound. Fixed — see reconstructResponseFromSse in streaming-proxy.ts.
  it("preserves message.reasoning even when a plugin forces response buffering", async () => {
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "thinking-chat-buffered",
        messages: [{ role: "user", content: "What is 17*23?" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"reasoning":"Let me think about this."');
  });
});
