import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { fetch } from "undici";
import { backends as backendsTable, buildBackendApiUrl, decrypt } from "@haai/core";
import type { AppContext } from "../../context.js";

export async function embeddingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post("/v1/embeddings", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const requestedModel = body["model"] as string | undefined;

    if (!requestedModel) {
      return reply.status(400).send({ error: { message: "model is required" } });
    }

    const authHeader = req.headers.authorization;
    const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!rawKey) {
      return reply.status(401).send({ error: { message: "Missing Authorization header" } });
    }

    const authResult = await ctx.keyAuth.authenticate(rawKey);
    if (!authResult.success) {
      return reply.status(authResult.status).send({ error: { message: authResult.error } });
    }

    const parts = requestedModel.split(":");
    if (parts.length < 3) {
      return reply.status(404).send({ error: { message: `Model '${requestedModel}' not found` } });
    }

    const modelId = parts.slice(0, -2).join(":");
    const hostName = parts[parts.length - 2];
    const provider = parts[parts.length - 1];

    const backend = await ctx.db.db
      .select()
      .from(backendsTable)
      .where(
        and(
          eq(backendsTable.hostName, hostName ?? ""),
          eq(backendsTable.provider, provider ?? ""),
          eq(backendsTable.enabled, true),
        ),
      )
      .get();

    if (!backend) {
      return reply.status(404).send({ error: { message: `Backend for model '${requestedModel}' not found` } });
    }

    const modelAccess = await ctx.keyAuth.checkBackendAccess(authResult.key, backend.id, {
      embeddings: true,
    });
    if (!modelAccess.allowed) {
      return reply.status(403).send({ error: { message: modelAccess.error } });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (backend.keyMode === "abstraction" && backend.encryptedApiKey) {
      headers["Authorization"] = `Bearer ${decrypt(backend.encryptedApiKey, ctx.masterKey)}`;
    } else if (backend.keyMode === "passthrough") {
      headers["Authorization"] = `Bearer ${rawKey}`;
    }

    const res = await fetch(buildBackendApiUrl(backend.baseUrl, "/v1/embeddings"), {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model: modelId }),
    });

    const responseBody = await res.text();
    return reply.status(res.status).header("Content-Type", "application/json").send(responseBody);
  });
}
