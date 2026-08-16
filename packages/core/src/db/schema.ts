import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── Backends ──────────────────────────────────────────────────────────────────
export const backends = sqliteTable(
  "backends",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    displayName: text("display_name").notNull(),
    hostName: text("host_name").notNull(),
    provider: text("provider").notNull(), // lmstudio|ollama|vllm|openai|generic
    baseUrl: text("base_url").notNull(),
    keyMode: text("key_mode").notNull().default("passthrough"), // passthrough|abstraction
    encryptedApiKey: text("encrypted_api_key"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    weight: integer("weight").notNull().default(1),
    maxConcurrency: integer("max_concurrency").notNull().default(10),
    healthCheckEnabled: integer("health_check_enabled", { mode: "boolean" }).notNull().default(true),
    lastHealthCheck: integer("last_health_check"),
    lastHealthStatus: text("last_health_status"), // healthy|degraded|unhealthy
    lastLatencyMs: integer("last_latency_ms"),
    lastHealthError: text("last_health_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_backends_enabled").on(t.enabled)],
);

// ── Virtual Models ────────────────────────────────────────────────────────────
export const vmodels = sqliteTable(
  "vmodels",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    balancingStrategy: text("balancing_strategy").notNull().default("session-pin"),
    streaming: integer("streaming", { mode: "boolean" }).notNull().default(true),
    allowToolCalling: integer("allow_tool_calling", { mode: "boolean" }).notNull().default(true),
    allowVision: integer("allow_vision", { mode: "boolean" }).notNull().default(false),
    allowEmbeddings: integer("allow_embeddings", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_vmodels_model_id").on(t.modelId),
    index("idx_vmodels_enabled").on(t.enabled),
  ],
);

export const vmodelBackends = sqliteTable(
  "vmodel_backends",
  {
    id: text("id").primaryKey(),
    vmodelId: text("vmodel_id")
      .notNull()
      .references(() => vmodels.id, { onDelete: "cascade" }),
    backendId: text("backend_id")
      .notNull()
      .references(() => backends.id, { onDelete: "cascade" }),
    backendModelId: text("backend_model_id").notNull(),
    weight: integer("weight").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_vmodel_backends_vmodel").on(t.vmodelId),
    index("idx_vmodel_backends_backend").on(t.backendId),
  ],
);

// ── Virtual Model Hooks (join table) ─────────────────────────────────────────
export const vmodelHooks = sqliteTable("vmodel_hooks", {
  id: text("id").primaryKey(),
  vmodelId: text("vmodel_id")
    .notNull()
    .references(() => vmodels.id, { onDelete: "cascade" }),
  hookId: text("hook_id")
    .notNull()
    .references(() => hooks.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// ── API Keys ──────────────────────────────────────────────────────────────────
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /** AES-256-GCM encrypted full key; null when show-once mode or legacy keys */
    encryptedKey: text("encrypted_key"),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
    suspendedReason: text("suspended_reason"),
    expiresAt: integer("expires_at"),
    allowedModels: text("allowed_models"), // JSON v-model IDs or null for all
    allowedBackends: text("allowed_backends"), // JSON backend IDs or null for all pass-through
    allowToolCalling: integer("allow_tool_calling", { mode: "boolean" }).notNull().default(true),
    allowVision: integer("allow_vision", { mode: "boolean" }).notNull().default(false),
    allowEmbeddings: integer("allow_embeddings", { mode: "boolean" }).notNull().default(false),
    rateLimitRpm: integer("rate_limit_rpm"),
    tokenBudgetHour: integer("token_budget_hour"),
    tokenBudgetDay: integer("token_budget_day"),
    tokenBudgetWeek: integer("token_budget_week"),
    tokenBudgetMonth: integer("token_budget_month"),
    logRequests: integer("log_requests", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    index("idx_api_keys_prefix").on(t.prefix),
    uniqueIndex("idx_api_keys_hash").on(t.keyHash),
    index("idx_api_keys_enabled").on(t.enabled),
  ],
);

// ── App Settings ──────────────────────────────────────────────────────────────
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── Usage Events ──────────────────────────────────────────────────────────────
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    vmodelId: text("vmodel_id").references(() => vmodels.id, { onDelete: "set null" }),
    backendId: text("backend_id").references(() => backends.id, { onDelete: "set null" }),
    backendModelId: text("backend_model_id"),
    endpoint: text("endpoint").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    ttftMs: integer("ttft_ms"),
    durationMs: integer("duration_ms").notNull(),
    tps: real("tps"),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    statusCode: integer("status_code").notNull(),
    error: text("error"),
    timestamp: integer("timestamp").notNull(),
  },
  (t) => [
    index("idx_usage_events_key").on(t.keyId),
    index("idx_usage_events_vmodel").on(t.vmodelId),
    index("idx_usage_events_backend").on(t.backendId),
    index("idx_usage_events_timestamp").on(t.timestamp),
  ],
);

// ── Usage Rollups ─────────────────────────────────────────────────────────────
export const usageRollups = sqliteTable(
  "usage_rollups",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull(), // hour|day|week|month
    bucket: text("bucket").notNull(),
    keyId: text("key_id"),
    vmodelId: text("vmodel_id"),
    backendId: text("backend_id"),
    requestCount: integer("request_count").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    avgTtftMs: real("avg_ttft_ms"),
    avgDurationMs: real("avg_duration_ms"),
    avgTps: real("avg_tps"),
  },
  (t) => [
    index("idx_rollups_period_bucket").on(t.period, t.bucket),
    index("idx_rollups_key").on(t.keyId),
    index("idx_rollups_vmodel").on(t.vmodelId),
    index("idx_rollups_backend").on(t.backendId),
  ],
);

// ── Token Budget Counters ─────────────────────────────────────────────────────
export const tokenBudgetCounters = sqliteTable(
  "token_budget_counters",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // hour|day|week|month
    bucket: text("bucket").notNull(), // ISO bucket start
    tokensUsed: integer("tokens_used").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_budget_counters_unique").on(t.keyId, t.period, t.bucket),
    index("idx_budget_counters_key").on(t.keyId),
  ],
);

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("viewer"), // admin|viewer
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    totpSecret: text("totp_secret"),
    totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => [uniqueIndex("idx_users_username").on(t.username)],
);

// ── Pending TOTP logins (intermediate step after password, before session) ────
export const pendingTotpLogins = sqliteTable(
  "pending_totp_logins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_pending_totp_token").on(t.token),
    index("idx_pending_totp_user").on(t.userId),
    index("idx_pending_totp_expires").on(t.expiresAt),
  ],
);

// ── WebAuthn passkeys ─────────────────────────────────────────────────────────
export const webauthnCredentials = sqliteTable(
  "webauthn_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    webauthnUserId: text("webauthn_user_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    transports: text("transports"),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("idx_webauthn_credential_id").on(t.credentialId),
    index("idx_webauthn_credentials_user").on(t.userId),
    index("idx_webauthn_webauthn_user_id").on(t.webauthnUserId),
  ],
);

export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    id: text("id").primaryKey(),
    challenge: text("challenge").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_webauthn_challenges_expires").on(t.expiresAt)],
);

// ── Sessions ──────────────────────────────────────────────────────────────────
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (t) => [
    uniqueIndex("idx_sessions_token").on(t.token),
    index("idx_sessions_user").on(t.userId),
    index("idx_sessions_expires").on(t.expiresAt),
  ],
);

// ── API Tokens (management) ────────────────────────────────────────────────────
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("idx_api_tokens_hash").on(t.tokenHash),
    index("idx_api_tokens_user").on(t.userId),
  ],
);

// ── Hooks ─────────────────────────────────────────────────────────────────────
export const hooks = sqliteTable("hooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  type: text("type").notNull(), // internal|external
  trigger: text("trigger").notNull(), // pre-request|post-completion
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  module: text("module"), // npm package or local path for internal hooks
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
  timeoutMs: integer("timeout_ms").notNull().default(5000),
  config: text("config"), // JSON
  version: text("version"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── Plugins ───────────────────────────────────────────────────────────────────
export const plugins = sqliteTable(
  "plugins",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** "npm:<pkg>" | "github:<owner>/<repo>" | "local:<path>" */
    source: text("source").notNull(),
    version: text("version"),
    /** JSON: PluginManifest */
    manifest: text("manifest").notNull(),
    /** JSON: ConfigSchema */
    configSchema: text("config_schema"),
    /** Absolute path to bundled JS on disk */
    bundlePath: text("bundle_path"),
    needsResponseBuffer: integer("needs_response_buffer", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_plugins_enabled").on(t.enabled)],
);

// ── Plugin Bindings ────────────────────────────────────────────────────────────
export const pluginBindings = sqliteTable(
  "plugin_bindings",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    /** "global" | "vmodel" | "backend" | "key" */
    scopeType: text("scope_type").notNull(),
    /** null for global; entity ID otherwise */
    scopeId: text("scope_id"),
    /** JSON: per-binding config values */
    config: text("config"),
    order: integer("order").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_plugin_bindings_plugin").on(t.pluginId),
    index("idx_plugin_bindings_scope").on(t.scopeType, t.scopeId),
  ],
);

// ── Audit Log ─────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    username: text("username"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    detail: text("detail"),
    ipAddress: text("ip_address"),
    timestamp: integer("timestamp").notNull(),
  },
  (t) => [
    index("idx_audit_log_user").on(t.userId),
    index("idx_audit_log_timestamp").on(t.timestamp),
    index("idx_audit_log_resource").on(t.resourceType, t.resourceId),
  ],
);

// ── Request Logs ──────────────────────────────────────────────────────────────
export const requestLogs = sqliteTable(
  "request_logs",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    vmodelId: text("vmodel_id").references(() => vmodels.id, { onDelete: "set null" }),
    backendId: text("backend_id").references(() => backends.id, { onDelete: "set null" }),
    backendModelId: text("backend_model_id"),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    ttftMs: integer("ttft_ms"),
    durationMs: integer("duration_ms").notNull(),
    tps: real("tps"),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    error: text("error"),
    requestSize: integer("request_size").notNull().default(0),
    responseSize: integer("response_size").notNull().default(0),
    timestamp: integer("timestamp").notNull(),
  },
  (t) => [
    index("idx_request_logs_key").on(t.keyId),
    index("idx_request_logs_vmodel").on(t.vmodelId),
    index("idx_request_logs_timestamp").on(t.timestamp),
  ],
);
