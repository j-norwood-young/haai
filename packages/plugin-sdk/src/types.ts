// ── Chat types (OpenAI-compatible) ───────────────────────────────────────────

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
  function: { name: string; arguments: string };
}

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

// ── Config field definitions ───────────────────────────────────────────────

export type FieldType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "secret"
  | "model"
  | "backend";

interface FieldBase {
  label: string;
  description?: string;
  required?: boolean;
}

export interface StringField extends FieldBase {
  type: "string";
  default?: string;
}

export interface TextField extends FieldBase {
  type: "text";
  default?: string;
}

export interface NumberField extends FieldBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}

export interface BooleanField extends FieldBase {
  type: "boolean";
  default?: boolean;
}

export interface SelectField<T extends string = string> extends FieldBase {
  type: "select";
  options: readonly T[];
  default?: T;
}

export interface SecretField extends FieldBase {
  type: "secret";
  default?: string;
}

/** Renders a backend model picker in the UI. Value is a model ID string. */
export interface ModelField extends FieldBase {
  type: "model";
  default?: string;
}

/** Renders a backend picker in the UI. Value is a backend ID string. */
export interface BackendField extends FieldBase {
  type: "backend";
  default?: string;
}

export type ConfigField =
  | StringField
  | TextField
  | NumberField
  | BooleanField
  | SelectField
  | SecretField
  | ModelField
  | BackendField;

export type ConfigSchema = Record<string, ConfigField>;

/** Infer the runtime config value type from a ConfigSchema */
export type InferConfig<S extends ConfigSchema> = {
  [K in keyof S]: S[K] extends BooleanField
    ? boolean
    : S[K] extends NumberField
      ? number
      : S[K] extends SelectField<infer T>
        ? T
        : string;
};

// ── Plugin capability context ──────────────────────────────────────────────

export interface AiCompleteOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface PluginCapabilities {
  /** Run a chat completion through the proxy's backends (no raw network). */
  ai: {
    complete(opts: AiCompleteOptions): Promise<ChatResponse>;
  };
  /** Log a message (appears in proxy logs). */
  log(level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void;
  /** Fetch a URL — only allow-listed URLs may be used. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
}

export interface PluginContext<C extends ConfigSchema = ConfigSchema> extends PluginCapabilities {
  /** Typed config values for this binding */
  config: InferConfig<C>;
  /** The v-model ID being used (empty string for direct backend requests) */
  vmodelId: string;
  /** The selected backend ID */
  backendId: string;
  /** The backend model ID being sent upstream */
  backendModelId: string;
  /** API key prefix (never the full key) */
  keyPrefix?: string;
  /** Unix timestamp ms when this request started */
  timestamp: number;
}

// ── Plugin definition ──────────────────────────────────────────────────────

export interface PluginHooks<C extends ConfigSchema = ConfigSchema> {
  /**
   * Called before the request is sent upstream.
   * Return a modified ChatRequest to transform the request.
   */
  onRequest?: (request: ChatRequest, ctx: PluginContext<C>) => ChatRequest | Promise<ChatRequest>;
  /**
   * Called after the upstream response is received.
   * Only called when the plugin declares needsResponseBuffer: true.
   * Return a modified ChatResponse to transform the response.
   */
  onResponse?: (response: ChatResponse, ctx: PluginContext<C>) => ChatResponse | Promise<ChatResponse>;
}

export interface PluginDefinition<C extends ConfigSchema = ConfigSchema> {
  /** Display name for this plugin */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Config schema — drives the auto-generated UI */
  config?: C;
  /**
   * When true, the proxy buffers the full upstream response before calling
   * onResponse. Required for response transformation (translation, summary, etc.).
   * Adds latency; only enable when needed.
   */
  needsResponseBuffer?: boolean;
  /** Hook handlers */
  hooks: PluginHooks<C>;
}

/** The manifest stored in package.json under the "haai-plugin" key. */
export interface PluginManifest {
  name: string;
  description?: string;
  version: string;
  configSchema?: ConfigSchema;
  needsResponseBuffer?: boolean;
  hooks: Array<"onRequest" | "onResponse">;
}
