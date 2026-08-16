import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { hash } from "@node-rs/argon2";
import {
  createDbClient,
  getMasterKey,
  ensureDataDir,
  loadConfig,
  users,
  apiTokens,
  generateAdminToken,
  hashToken,
} from "@ai-v-models/core";
import { createApp } from "@ai-v-models/proxy/app";
import { KeyAuthenticator } from "@ai-v-models/proxy/key-auth";
import { BackendBalancer } from "@ai-v-models/proxy/balancer";
import { SseEmitter } from "@ai-v-models/proxy/sse";
import { PluginRuntime } from "@ai-v-models/proxy/plugins/runtime";
import { getPort } from "./ports.js";

export interface TestProxy {
  port: number;
  url: string;
  dataDir: string;
  db: ReturnType<typeof createDbClient>;
  masterKey: Buffer;
  adminToken: string;
  stop: () => Promise<void>;
}

export async function startTestProxy(): Promise<TestProxy> {
  const port = await getPort();
  const dataDir = mkdtempSync(join(tmpdir(), "aivm-test-"));
  ensureDataDir(dataDir);

  const dbPath = join(dataDir, "data.db");
  const db = createDbClient(dbPath);
  const masterKey = getMasterKey(dataDir);

  // Apply schema directly (no drizzle-kit in tests)
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS backends (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      host_name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL,
      key_mode TEXT NOT NULL DEFAULT 'passthrough', encrypted_api_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, weight INTEGER NOT NULL DEFAULT 1,
      max_concurrency INTEGER NOT NULL DEFAULT 10, health_check_enabled INTEGER NOT NULL DEFAULT 1,
      last_health_check INTEGER, last_health_status TEXT, last_latency_ms INTEGER,
      last_health_error TEXT, available_models TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vmodels (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      description TEXT, balancing_strategy TEXT NOT NULL DEFAULT 'session-pin',
      streaming INTEGER NOT NULL DEFAULT 1, allow_tool_calling INTEGER NOT NULL DEFAULT 1,
      allow_vision INTEGER NOT NULL DEFAULT 0, allow_embeddings INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_health_status TEXT, last_health_error TEXT, last_health_check INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vmodel_backends (
      id TEXT PRIMARY KEY, vmodel_id TEXT NOT NULL, backend_id TEXT NOT NULL,
      backend_model_id TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_available INTEGER, unavailable_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vmodel_hooks (
      id TEXT PRIMARY KEY, vmodel_id TEXT NOT NULL, hook_id TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      encrypted_key TEXT,
      name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      suspended INTEGER NOT NULL DEFAULT 0, suspended_reason TEXT,
      expires_at INTEGER, allowed_models TEXT, allowed_backends TEXT, allow_tool_calling INTEGER NOT NULL DEFAULT 1,
      allow_vision INTEGER NOT NULL DEFAULT 0, allow_embeddings INTEGER NOT NULL DEFAULT 0,
      rate_limit_rpm INTEGER, token_budget_hour INTEGER, token_budget_day INTEGER,
      token_budget_week INTEGER, token_budget_month INTEGER,
      log_requests INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY, key_id TEXT, vmodel_id TEXT, backend_id TEXT,
      backend_model_id TEXT, endpoint TEXT NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
      ttft_ms INTEGER, duration_ms INTEGER NOT NULL, tps REAL, tool_call_count INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER NOT NULL, error TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_rollups (
      id TEXT PRIMARY KEY, period TEXT NOT NULL, bucket TEXT NOT NULL, key_id TEXT,
      vmodel_id TEXT, backend_id TEXT, request_count INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
      avg_ttft_ms REAL, avg_duration_ms REAL, avg_tps REAL
    );
    CREATE TABLE IF NOT EXISTS token_budget_counters (
      id TEXT PRIMARY KEY, key_id TEXT NOT NULL, period TEXT NOT NULL, bucket TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
      enabled INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS pending_totp_logins (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE,
      webauthn_user_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0, transports TEXT,
      name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      user_agent TEXT, ip_address TEXT
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL, user_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      type TEXT NOT NULL, trigger TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      module TEXT, webhook_url TEXT, webhook_secret TEXT, timeout_ms INTEGER NOT NULL DEFAULT 5000,
      config TEXT, version TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, user_id TEXT, username TEXT, action TEXT NOT NULL,
      resource_type TEXT, resource_id TEXT, detail TEXT, ip_address TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY, key_id TEXT, vmodel_id TEXT, backend_id TEXT,
      backend_model_id TEXT, endpoint TEXT NOT NULL, method TEXT NOT NULL,
      status_code INTEGER NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
      ttft_ms INTEGER, duration_ms INTEGER NOT NULL, tps REAL,
      tool_call_count INTEGER NOT NULL DEFAULT 0, error TEXT,
      request_size INTEGER NOT NULL DEFAULT 0, response_size INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      source TEXT NOT NULL, version TEXT, manifest TEXT NOT NULL,
      config_schema TEXT, bundle_path TEXT,
      needs_response_buffer INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_bindings (
      id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL,
      scope_type TEXT NOT NULL, scope_id TEXT, config TEXT,
      "order" INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
    );
  `);

  const now = Date.now();
  const adminUserId = `user-${nanoid(8)}`;
  const passwordHash = await hash("test-admin-password");
  db.db.insert(users).values({
    id: adminUserId,
    username: "testadmin",
    displayName: "Test Admin",
    passwordHash,
    role: "admin",
    enabled: true,
    mustChangePassword: false,
    totpEnabled: false,
    createdAt: now,
    updatedAt: now,
  }).run();

  const { token: adminToken, prefix } = generateAdminToken();
  db.db.insert(apiTokens).values({
    id: `atok-${nanoid(8)}`,
    name: "e2e-test",
    tokenHash: hashToken(adminToken),
    prefix,
    userId: adminUserId,
    enabled: true,
    expiresAt: null,
    createdAt: now,
  }).run();

  const config = loadConfig({ configFile: join(dataDir, "config.yaml") });
  config.server.port = port;

  const pluginsDir = join(dataDir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });

  const ctx = {
    db,
    config,
    masterKey,
    keyAuth: new KeyAuthenticator(db),
    balancer: new BackendBalancer(),
    sse: new SseEmitter(),
    pluginRuntime: new PluginRuntime(),
    pluginsDir,
  };

  const app = await createApp(ctx);
  await app.listen({ port, host: "127.0.0.1" });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    dataDir,
    db,
    masterKey,
    adminToken,
    stop: async () => {
      await app.close();
      db.sqlite.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
