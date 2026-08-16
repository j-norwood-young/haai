#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiFetch } from "@haai/core/http";
import { z } from "zod";

const BASE_URL = process.env["HAAI_URL"] ?? "http://localhost:4000";
const TOKEN = process.env["HAAI_ADMIN_TOKEN"];

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  return apiFetch<T>(`${BASE_URL}${path}`, { method, headers, body });
}

const server = new McpServer({
  name: "haai",
  version: "0.0.1",
});

// ── Backend tools ─────────────────────────────────────────────────────────────
server.tool("list_backends", "List all configured LLM backends", {}, async () => {
  const backends = await apiRequest<unknown[]>("GET", "/api/v1/backends");
  return { content: [{ type: "text" as const, text: JSON.stringify(backends, null, 2) }] };
});

server.tool(
  "add_backend",
  "Add a new LLM backend",
  {
    name: z.string().describe("Unique backend name"),
    baseUrl: z.string().url().describe("Backend base URL"),
    provider: z.enum(["lmstudio", "ollama", "vllm", "openai", "generic"]).describe("Provider type"),
    hostName: z.string().describe("Host label (e.g. bob)"),
    keyMode: z.enum(["passthrough", "abstraction"]).default("passthrough").describe("Key mode"),
    apiKey: z.string().optional().describe("API key (for abstraction mode)"),
  },
  async (args) => {
    const backend = await apiRequest("POST", "/api/v1/backends", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(backend, null, 2) }] };
  },
);

server.tool(
  "test_backend",
  "Test connectivity to a backend",
  { backendId: z.string().describe("Backend ID") },
  async ({ backendId }) => {
    const result = await apiRequest("POST", `/api/v1/backends/${backendId}/test`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "remove_backend",
  "Remove a backend",
  { backendId: z.string().describe("Backend ID") },
  async ({ backendId }) => {
    await apiRequest("DELETE", `/api/v1/backends/${backendId}`);
    return { content: [{ type: "text" as const, text: "Backend removed" }] };
  },
);

// ── VModel tools ──────────────────────────────────────────────────────────────
server.tool("list_vmodels", "List all virtual models", {}, async () => {
  const vmodels = await apiRequest<unknown[]>("GET", "/api/v1/vmodels");
  return { content: [{ type: "text" as const, text: JSON.stringify(vmodels, null, 2) }] };
});

server.tool(
  "create_vmodel",
  "Create a virtual model",
  {
    modelId: z.string().describe("Model alias (e.g. smart-chat)"),
    displayName: z.string().optional().describe("Display name"),
    balancingStrategy: z
      .enum(["session-pin", "round-robin", "weighted", "least-connections", "least-latency"])
      .default("session-pin"),
    streaming: z.boolean().default(true),
  },
  async (args) => {
    const vm = await apiRequest("POST", "/api/v1/vmodels", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(vm, null, 2) }] };
  },
);

server.tool(
  "add_backend_to_vmodel",
  "Add a backend to a virtual model",
  {
    vmodelId: z.string(),
    backendId: z.string(),
    backendModelId: z.string().describe("The model ID on the backend"),
    weight: z.number().int().default(1),
  },
  async ({ vmodelId, ...rest }) => {
    await apiRequest("POST", `/api/v1/vmodels/${vmodelId}/backends`, rest);
    return { content: [{ type: "text" as const, text: "Backend added to virtual model" }] };
  },
);

// ── Key tools ─────────────────────────────────────────────────────────────────
server.tool("list_keys", "List all API keys", {}, async () => {
  const keys = await apiRequest<unknown[]>("GET", "/api/v1/keys");
  return { content: [{ type: "text" as const, text: JSON.stringify(keys, null, 2) }] };
});

server.tool(
  "create_key",
  "Create an API key",
  {
    name: z.string().describe("Key name/label"),
    allowedModels: z.array(z.string()).optional().describe("Allowed v-model IDs (null = all)"),
    allowedBackends: z.array(z.string()).optional().describe("Allowed backend IDs for pass-through (null = all)"),
    rateLimitRpm: z.number().int().optional(),
    tokenBudgetDay: z.number().int().optional(),
    tokenBudgetMonth: z.number().int().optional(),
    expiresInDays: z.number().int().optional(),
  },
  async ({ expiresInDays, ...rest }) => {
    const body = {
      ...rest,
      expiresAt: expiresInDays ? Date.now() + expiresInDays * 86400 * 1000 : undefined,
    };
    const result = await apiRequest<{ id: string; key: string; prefix: string }>("POST", "/api/v1/keys", body);
    return {
      content: [
        {
          type: "text" as const,
          text: `API key created:\nID: ${result.id}\nKey: ${result.key}\nPrefix: ${result.prefix}\n\n⚠ Save this key - it won't be shown again!`,
        },
      ],
    };
  },
);

server.tool(
  "suspend_key",
  "Suspend an API key",
  {
    keyId: z.string(),
    reason: z.string().optional(),
  },
  async ({ keyId, reason }) => {
    await apiRequest("POST", `/api/v1/keys/${keyId}/suspend`, { reason });
    return { content: [{ type: "text" as const, text: "Key suspended" }] };
  },
);

// ── Metrics tools ─────────────────────────────────────────────────────────────
server.tool("get_metrics_summary", "Get 24h metrics summary", {}, async () => {
  const summary = await apiRequest("GET", "/api/v1/metrics/summary");
  return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
});

server.tool(
  "get_key_logs",
  "Get request logs for an API key",
  {
    keyId: z.string(),
    limit: z.number().int().default(20),
  },
  async ({ keyId, limit }) => {
    const logs = await apiRequest("GET", `/api/v1/keys/${keyId}/logs?limit=${limit}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(logs, null, 2) }] };
  },
);

// ── Start server ─────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
