export interface ApiKey {
  id: string;
  /** Short prefix shown to users, e.g. "haai-sk-abc1" */
  prefix: string;
  /** Argon2 hash of the full key */
  keyHash: string;
  /** AES-256-GCM encrypted full key; null when show-once mode or legacy keys */
  encryptedKey: string | null;
  name: string;
  enabled: boolean;
  suspended: boolean;
  suspendedReason: string | null;
  /** Unix timestamp ms; null = never expires */
  expiresAt: number | null;
  /** JSON-encoded v-model IDs, or null for all v-models */
  allowedModels: string | null;
  /** JSON-encoded backend IDs for pass-through, or null for all backends */
  allowedBackends: string | null;
  allowToolCalling: boolean;
  allowVision: boolean;
  allowEmbeddings: boolean;
  /** Requests per minute; null = unlimited */
  rateLimitRpm: number | null;
  /** Token budget per period; null = unlimited */
  tokenBudgetHour: number | null;
  tokenBudgetDay: number | null;
  tokenBudgetWeek: number | null;
  tokenBudgetMonth: number | null;
  logRequests: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export type ApiKeyInsert = Omit<
  ApiKey,
  "id" | "createdAt" | "updatedAt" | "lastUsedAt" | "keyHash" | "prefix"
>;

export interface KeyScope {
  id: string;
  keyId: string;
  modelId: string;
}

export type UsagePeriod = "hour" | "day" | "week" | "month";
