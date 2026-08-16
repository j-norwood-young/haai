export type BackendProvider = "lmstudio" | "ollama" | "vllm" | "openai" | "generic";

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
>;
