import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  loadConfig,
  defaultDataDir,
  ensureDataDir,
  createDbClient,
  getMasterKey,
} from "@haai/core";
import { createLogger } from "./logger.js";
import { createApp } from "./app.js";
import { printStartupBanner, resolvePublicBaseUrl } from "./startup-banner.js";
import { KeyAuthenticator } from "./key-auth.js";
import { BackendBalancer } from "./balancer.js";
import { HealthMonitor } from "./health.js";
import { SseEmitter } from "./sse.js";
import { ensureAdminUser } from "./setup.js";
import { PluginRuntime } from "./plugins/runtime.js";
import type { AppContext } from "./context.js";

const config = loadConfig();
const dataDir = config.dataDir ?? defaultDataDir();

ensureDataDir(dataDir);

const log = createLogger(config.log, dataDir);
log.info({ dataDir }, "Starting HAAI proxy");

// Database
const dbPath = join(dataDir, "data.db");
const db = createDbClient(dbPath);

// Run embedded migrations
const { runMigrations } = await import("@haai/core");
try {
  runMigrations(dbPath);
  log.info("Database migrations applied");
} catch (err) {
  log.warn({ err }, "Migration failed (may already be applied)");
}

// Master encryption key
const masterKey = getMasterKey(dataDir);

// Ensure admin user exists
await ensureAdminUser(db);

// Plugin runtime
const pluginsDir = join(dataDir, "plugins");
mkdirSync(pluginsDir, { recursive: true });
const pluginRuntime = new PluginRuntime();

// Build context
const ctx: AppContext = {
  db,
  config,
  masterKey,
  keyAuth: new KeyAuthenticator(db),
  balancer: new BackendBalancer(),
  sse: new SseEmitter(),
  pluginRuntime,
  pluginsDir,
};

// Start health monitor
const healthMonitor = new HealthMonitor(
  db,
  masterKey,
  config.health.checkIntervalSecs,
  config.health.timeoutMs,
  ctx.sse,
);
await healthMonitor.start();

function flushLogs(log: ReturnType<typeof createLogger>): Promise<void> {
  return new Promise((resolve) => log.flush(() => resolve()));
}

/** Allow async pino writes to land before printing the ASCII banner. */
function waitForLogDrain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 75));
}

// Build and start server
const app = await createApp(ctx);

const { host, port } = config.server;
await app.listen({ host, port });

const publicUrl = resolvePublicBaseUrl(config);
log.info({ host, port, publicUrl }, `HAAI listening on ${publicUrl}`);
await flushLogs(log);
await waitForLogDrain();
await printStartupBanner({ config, db, dataDir });

// Graceful shutdown
const shutdown = async (signal: string) => {
  log.info({ signal }, "Shutting down gracefully...");
  healthMonitor.stop();
  pluginRuntime.dispose();
  await app.close();
  db.sqlite.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
