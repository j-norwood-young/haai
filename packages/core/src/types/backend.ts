export const BACKEND_PROVIDERS = ["lmstudio", "ollama", "vllm", "omlx", "openai", "generic"] as const;

export type BackendProvider = (typeof BACKEND_PROVIDERS)[number];

export type BackendKeyMode = "passthrough" | "abstraction";

export interface Backend {
  id: string;
  name: string;
  displayName: string;
  hostName: string;
  provider: BackendProvider;
  baseUrl: string;
  keyMode: BackendKeyMode;
  /** Encrypted backend API key (when keyMode = "abstraction"). Null for passthrough. */
  encryptedApiKey: string | null;
  enabled: boolean;
  weight: number;
  /** Maximum concurrent requests to this backend */
  maxConcurrency: number;
  healthCheckEnabled: boolean;
  lastHealthCheck: number | null;
  lastHealthStatus: "healthy" | "degraded" | "unhealthy" | null;
  lastLatencyMs: number | null;
  lastHealthError: string | null;
  /** JSON-encoded string[] of model ids, or null when unknown/cleared */
  availableModels: string | null;
  /**
   * JSON-encoded partial override of this backend's reasoning capabilities
   * (see @haai/core reasoning module). Null means "derive entirely from provider".
   * Deliberately NOT part of the model-id composite key, unlike `provider` — safe
   * to change at any time via PATCH.
   */
  reasoningCaps: string | null;
  createdAt: number;
  updatedAt: number;
}

export type BackendInsert = Omit<
  Backend,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "lastHealthCheck"
  | "lastHealthStatus"
  | "lastLatencyMs"
  | "lastHealthError"
  | "availableModels"
  | "reasoningCaps"
>;
