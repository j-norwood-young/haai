import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { AppContext } from "./context.js";
import { modelsRoutes } from "./routes/v1/models.js";
import { chatRoutes } from "./routes/v1/chat.js";
import { embeddingsRoutes } from "./routes/v1/embeddings.js";
import { backendsRoutes } from "./routes/api/backends.js";
import { vmodelsRoutes } from "./routes/api/vmodels.js";
import { keysRoutes } from "./routes/api/keys.js";
import { hooksRoutes } from "./routes/api/hooks.js";
import { pluginsRoutes } from "./routes/api/plugins.js";
import { availableModelsRoute } from "./routes/api/available-models.js";
import { metricsApiRoutes } from "./routes/api/metrics-api.js";
import { authRoutes } from "./routes/api/auth.js";
import { webauthnRoutes } from "./routes/api/webauthn.js";
import { settingsRoutes } from "./routes/api/settings.js";
import { eventsRoutes } from "./routes/api/events.js";
import { registerAdminAuthHook } from "./admin-auth-hook.js";
import { registerDocsSite } from "./docs-site.js";
import { registerOpenApiDocs } from "./openapi.js";
import { registerWebUi } from "./web-ui.js";
import { getLogger } from "./logger.js";

export async function createApp(ctx: AppContext) {
  const log = getLogger();

  const app = Fastify({
    logger: false, // We use pino directly
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // Allow POST/PATCH with Content-Type: application/json but no body (e.g. test endpoints)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString();
    if (text.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // CORS
  await app.register(cors, {
    origin: ctx.config.server.corsOrigins,
    credentials: true,
  });

  // Cookies
  await app.register(cookie, {
    secret: ctx.config.security.sessionSecret ?? "haai-change-me-in-production",
  });

  // Rate limiting for login endpoint
  await app.register(rateLimit, {
    global: false,
    max: ctx.config.security.loginRateLimitMaxAttempts,
    timeWindow: ctx.config.security.loginRateLimitWindowSecs * 1000,
    keyGenerator: (req) => req.ip,
  });

  // Request logging hook
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/")) {
      log.info({ method: req.method, url: req.url, ip: req.ip }, "API request");
    } else {
      log.debug({ method: req.method, url: req.url, ip: req.ip }, "Incoming request");
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      log.info(
        { method: req.method, url: req.url, status: reply.statusCode, elapsed: reply.elapsedTime },
        "API response",
      );
    } else {
      log.debug(
        { method: req.method, url: req.url, status: reply.statusCode, elapsed: reply.elapsedTime },
        "Request completed",
      );
    }
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.2.1",
  }));

  // Readiness (checks DB)
  app.get("/ready", async (_req, reply) => {
    try {
      ctx.db.sqlite.prepare("SELECT 1").get();
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "not ready" });
    }
  });

  // Register routes
  await modelsRoutes(app, ctx);
  await chatRoutes(app, ctx);
  await embeddingsRoutes(app, ctx);
  await backendsRoutes(app, ctx);
  await vmodelsRoutes(app, ctx);
  await keysRoutes(app, ctx);
  await hooksRoutes(app, ctx);
  await pluginsRoutes(app, ctx);
  await availableModelsRoute(app, ctx);
  await metricsApiRoutes(app, ctx);
  await authRoutes(app, ctx);
  await webauthnRoutes(app, ctx);
  registerAdminAuthHook(app, ctx);
  await settingsRoutes(app, ctx);
  await eventsRoutes(app, ctx);

  // OpenAPI/Swagger UI and VitePress documentation (before admin UI catch-all)
  await registerOpenApiDocs(app);
  await registerDocsSite(app);

  // Admin UI (production build) — catch-all, registered last
  await registerWebUi(app);

  // 404 handler
  app.setNotFoundHandler(async (req, reply) => {
    return reply.status(404).send({
      error: { message: `Route ${req.method} ${req.url} not found`, type: "not_found" },
    });
  });

  // Error handler
  app.setErrorHandler(async (error, req, reply) => {
    const err = error as { statusCode?: number; message: string; code?: string };
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          message: err.message,
          type: typeof err.code === "string" ? err.code : "client_error",
        },
      });
    }

    log.error({ err: error, url: req.url }, "Unhandled error");
    return reply.status(500).send({
      error: { message: "Internal server error", type: "server_error" },
    });
  });

  return app;
}
