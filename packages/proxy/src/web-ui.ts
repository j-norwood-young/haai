import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { getLogger } from "./logger.js";

/** Path prefixes owned by the proxy — not the SvelteKit admin UI. */
const PROXY_PREFIXES = ["/api/", "/v1/"];

/** Exact paths owned by the proxy (Prometheus convention uses /metrics). */
const PROXY_EXACT = ["/health", "/ready", "/metrics"];

function isProxyRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (PROXY_EXACT.includes(path)) return true;
  return PROXY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function resolveWebBuildDir(): string | null {
  const candidates = [
    process.env["HAAI_WEB_DIR"],
    join(process.cwd(), "apps/web/build"),
    join(process.cwd(), "../../apps/web/build"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(join(dir, "handler.js"))) return dir;
  }
  return null;
}

export async function registerWebUi(app: FastifyInstance): Promise<boolean> {
  const log = getLogger();

  if (process.env["HAAI_DEV"] === "1") {
    log.info("Admin UI disabled in development — use the Vite dev server (pnpm dev:web)");
    return false;
  }

  const webDir = resolveWebBuildDir();

  if (!webDir) {
    log.info("Admin UI not bundled (apps/web/build missing). Run `pnpm build` to serve the UI from the proxy.");
    return false;
  }

  const handlerModule = (await import(pathToFileURL(join(webDir, "handler.js")).href)) as {
    handler: (req: unknown, res: unknown) => Promise<void>;
  };

  const { handler } = handlerModule;

  const uiHandler = async (
    req: { method: string; url: string; raw: unknown },
    reply: { hijack: () => void; raw: unknown; status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (isProxyRoute(req.url)) {
      return reply.status(404).send({
        error: { message: `Route ${req.method} ${req.url} not found`, type: "not_found" },
      });
    }

    reply.hijack();
    await handler(req.raw, reply.raw);
  };

  // Register UI routes per-method (exclude HEAD — Fastify adds it for GET; OPTIONS — CORS owns those)
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
    app.route({ method, url: "/*", handler: uiHandler });
  }

  log.info({ webDir }, "Admin UI enabled at /");
  return true;
}
