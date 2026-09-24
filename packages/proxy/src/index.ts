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
import { LiveStatsTracker } from "./live-stats.js";
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
  // Pending migrations run in one transaction, so a failure leaves the schema entirely un-migrated.
  log.fatal({ err }, "Database migration failed; refusing to start against an outdated schema");
  await new Promise<void>((resolve) => log.flush(() => resolve()));
  process.exit(1);
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
const sse = new SseEmitter();
const balancer = new BackendBalancer();
const live = new LiveStatsTracker(sse, balancer);
const ctx: AppContext = {
  db,
  config,
  masterKey,
  keyAuth: new KeyAuthenticator(db),
  balancer,
  sse,
  live,
  pluginRuntime,
  pluginsDir,
};

// Start live stats tracker
live.start();

// Start health monitor
const healthMonitor = new HealthMonitor(
  db,
  masterKey,
  config.health.checkIntervalSecs,
  config.health.timeoutMs,
  ctx.sse,
  ctx.live,
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
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) {
    // A second signal while still draining: bail out immediately rather
    // than leave the user stuck.
    log.warn({ signal }, "Forcing shutdown");
    process.exit(1);
  }
  shuttingDown = true;
  log.info({ signal }, "Shutting down gracefully...");
  live.stop();
  healthMonitor.stop();
  pluginRuntime.dispose();
  // SSE (/api/v1/events) and keep-alive connections outlive app.close();
  // they would keep close() waiting forever. Tear them down first.
  app.server.closeAllConnections?.();
  await app.close();
  db.sqlite.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
