/** The OpenAI-compatible chat request body passed to a hook */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** The completed chat response (non-streaming, or buffered streaming) */
export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: UsageStats;
  [key: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Context available to every hook execution */
export interface HookContext {
  /** The v-model ID being used */
  vmodelId: string;
  /** The backend model ID chosen */
  backendModelId: string;
  /** The backend ID chosen */
  backendId: string;
  /** Key prefix (prefix only, never the full key) */
  keyPrefix?: string;
  /** Unix timestamp ms */
  timestamp: number;
  /** JSON config from hook registration */
  config: Record<string, unknown>;
}

/**
 * Pre-request hook interface.
 * Must export a default function matching this signature.
 * May mutate the request body (return modified copy).
 */
export interface PreRequestHook {
  (request: ChatRequest, ctx: HookContext): ChatRequest | Promise<ChatRequest>;
}

/**
 * Post-completion hook interface.
 * Non-mutating by default (return value ignored unless v-model has streaming=false).
 * For non-streaming v-models, may return a modified response.
 */
export interface PostCompletionHook {
  (response: ChatResponse, ctx: HookContext): void | ChatResponse | Promise<void | ChatResponse>;
}

/** The manifest declared in a hook package's package.json under "haai-hook" key. */
export interface HookManifest {
  /** Hook display name */
  name: string;
  description?: string;
  /** "pre-request" | "post-completion" */
  trigger: "pre-request" | "post-completion";
  /** Optional JSON Schema for the config object */
  configSchema?: Record<string, unknown>;
  version: string;
}
