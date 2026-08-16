export type BalancingStrategy =
  | "session-pin"
  | "round-robin"
  | "weighted"
  | "least-connections"
  | "least-latency";

export type VModelHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type MappingUnavailableReason =
  | "backend_disabled"
  | "backend_unhealthy"
  | "model_missing"
  | "inventory_unknown";

export interface VModel {
  id: string;
  /** The alias exposed to users, e.g. "smart-chat" */
  modelId: string;
  displayName: string;
  description: string | null;
  balancingStrategy: BalancingStrategy;
  /** When false, responses are buffered before post-completion hooks */
  streaming: boolean;
  allowToolCalling: boolean;
  allowVision: boolean;
  allowEmbeddings: boolean;
  enabled: boolean;
  lastHealthStatus: VModelHealthStatus | null;
  lastHealthError: string | null;
  lastHealthCheck: number | null;
  createdAt: number;
  updatedAt: number;
}

export type VModelInsert = Omit<
  VModel,
  "id" | "createdAt" | "updatedAt" | "lastHealthStatus" | "lastHealthError" | "lastHealthCheck"
>;

export interface VModelBackend {
  id: string;
  vmodelId: string;
  backendId: string;
  /** The exact model ID on the backend, e.g. "qwen3.5-35b" */
  backendModelId: string;
  weight: number;
  enabled: boolean;
  lastAvailable: boolean | null;
  unavailableReason: MappingUnavailableReason | string | null;
  createdAt: number;
}
