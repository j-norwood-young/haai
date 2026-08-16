import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { getLogger } from "./logger.js";

export function resolveDocsBuildDir(): string | null {
  const candidates = [
    process.env["HAAI_DOCS_DIR"],
    join(process.cwd(), "docs/.vitepress/dist"),
    join(process.cwd(), "../../docs/.vitepress/dist"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

export async function registerDocsSite(app: FastifyInstance): Promise<boolean> {
  const log = getLogger();
  const docsDir = resolveDocsBuildDir();

  if (!docsDir) {
    log.info(
      "Documentation not bundled (docs/.vitepress/dist missing). Run `pnpm --filter @haai/docs build` to serve docs at /docs/",
    );
    return false;
  }

  try {
    const { default: fastifyStatic } = await import("@fastify/static");

  await app.register(fastifyStatic, {
      root: docsDir,
      prefix: "/docs/",
      decorateReply: false,
      index: ["index.html"],
    });

    app.get("/docs", async (_req, reply) => reply.redirect("/docs/"));

    log.info({ docsDir }, "Documentation enabled at /docs/");
    return true;
  } catch (err) {
    log.warn({ err }, "Documentation disabled — failed to register static file server");
    return false;
  }
}
