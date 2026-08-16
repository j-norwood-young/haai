import { buildChatCompletionUrl } from "@haai/core/http";
import type { ApiClient } from "./api-client.js";

const API_KEY_PREFIX = "haai-sk-";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  stream: boolean;
}

interface ModelsListResponse {
  data: Array<{ id: string }>;
}

interface VModelRow {
  modelId: string;
  enabled: boolean;
}

interface ApiKeyRow {
  id: string;
  prefix: string;
  enabled: boolean;
}

/** Resolve a full API key or key prefix to the secret value. */
export async function resolveApiKey(
  keyOrPrefix: string,
  adminClient?: ApiClient,
): Promise<string> {
  if (keyOrPrefix.startsWith(API_KEY_PREFIX) && keyOrPrefix.length > 13) {
    return keyOrPrefix;
  }

  if (!adminClient) {
    throw new Error(
      "Key prefix given but no admin token — set HAAI_ADMIN_TOKEN or pass a full haai-sk-… key",
    );
  }

  const keys = await adminClient.get<ApiKeyRow[]>("/api/v1/keys");
  const match = keys.find((k) => k.prefix === keyOrPrefix || k.id === keyOrPrefix);
  if (!match) {
    throw new Error(`API key '${keyOrPrefix}' not found`);
  }
  if (!match.enabled) {
    throw new Error(`API key '${match.prefix}' is disabled`);
  }

  try {
    const secret = await adminClient.get<{ key: string }>(`/api/v1/keys/${match.id}/secret`);
    return secret.key;
  } catch {
    throw new Error(
      `Cannot retrieve secret for key '${match.prefix}' — use the full key or create a retrievable key`,
    );
  }
}

export async function listInferenceModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as ModelsListResponse;
  return data.data.map((m) => m.id);
}

export async function listVModelIds(adminClient: ApiClient): Promise<string[]> {
  const vmodels = await adminClient.get<VModelRow[]>("/api/v1/vmodels");
  return vmodels.filter((v) => v.enabled).map((v) => v.modelId);
}

export async function listKeyPrefixes(adminClient: ApiClient): Promise<string[]> {
  const keys = await adminClient.get<ApiKeyRow[]>("/api/v1/keys");
  return keys.filter((k) => k.enabled).map((k) => k.prefix);
}

export async function sendPrompt(opts: PromptOptions): Promise<void> {
  const url = buildChatCompletionUrl(opts.baseUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: opts.stream,
    }),
  });

  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") detail = parsed.error;
      else if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* use raw text */
    }
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }

  if (opts.stream) {
    await streamResponse(res);
    return;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  process.stdout.write(content);
  if (content && !content.endsWith("\n")) process.stdout.write("\n");
}

async function streamResponse(res: Response): Promise<void> {
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") {
        process.stdout.write("\n");
        return;
      }

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) process.stdout.write(content);
      } catch {
        /* skip malformed chunks */
      }
    }
  }

  process.stdout.write("\n");
}

export function readApiKeyFromEnv(): string | undefined {
  return process.env["HAAI_API_KEY"];
}
