import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hooks as hooksTable } from "@haai/core";
import type { AppContext } from "../../context.js";

export async function hooksRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // List all hooks
  app.get("/api/v1/hooks", async () => {
    return ctx.db.db.select().from(hooksTable).all();
  });

  // Get single hook
  app.get<{ Params: { id: string } }>("/api/v1/hooks/:id", async (req, reply) => {
    const hook = await ctx.db.db
      .select()
      .from(hooksTable)
      .where(eq(hooksTable.id, req.params.id))
      .get();
    if (!hook) return reply.status(404).send({ error: "Hook not found" });
    return hook;
  });

  // Create hook
  app.post<{ Body: Record<string, unknown> }>("/api/v1/hooks", async (req, reply) => {
    const body = req.body;
    const now = Date.now();
    const id = `hook-${nanoid(8)}`;

    await ctx.db.db
      .insert(hooksTable)
      .values({
        id,
        name: body["name"] as string,
        description: body["description"] as string | null ?? null,
        type: body["type"] as string,
        trigger: body["trigger"] as string,
        enabled: (body["enabled"] as boolean) ?? true,
        module: body["module"] as string | null ?? null,
        webhookUrl: body["webhookUrl"] as string | null ?? null,
        webhookSecret: body["webhookSecret"] as string | null ?? null,
        timeoutMs: (body["timeoutMs"] as number) ?? 5000,
        config: body["config"] ? JSON.stringify(body["config"]) : null,
        version: body["version"] as string | null ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = await ctx.db.db
      .select()
      .from(hooksTable)
      .where(eq(hooksTable.id, id))
      .get();
    return reply.status(201).send(created);
  });

  // Update hook
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/hooks/:id",
    async (req, reply) => {
      const hook = await ctx.db.db
        .select()
        .from(hooksTable)
        .where(eq(hooksTable.id, req.params.id))
        .get();
      if (!hook) return reply.status(404).send({ error: "Hook not found" });

      const updates: Partial<typeof hooksTable.$inferInsert> = { updatedAt: Date.now() };
      const body = req.body;
      for (const field of ["name", "description", "enabled", "timeoutMs", "webhookUrl", "config"] as const) {
        if (body[field] !== undefined) {
          (updates as Record<string, unknown>)[field] = body[field];
        }
      }

      await ctx.db.db.update(hooksTable).set(updates).where(eq(hooksTable.id, req.params.id)).run();
      return { success: true };
    },
  );

  // Delete hook
  app.delete<{ Params: { id: string } }>("/api/v1/hooks/:id", async (req, reply) => {
    await ctx.db.db.delete(hooksTable).where(eq(hooksTable.id, req.params.id)).run();
    return reply.status(204).send();
  });

  // Test hook (call it with mock payload)
  app.post<{ Params: { id: string } }>("/api/v1/hooks/:id/test", async (req, reply) => {
    const hook = await ctx.db.db
      .select()
      .from(hooksTable)
      .where(eq(hooksTable.id, req.params.id))
      .get();
    if (!hook) return reply.status(404).send({ error: "Hook not found" });

    if (hook.type === "external" && hook.webhookUrl) {
      const start = Date.now();
      try {
        const { fetch } = await import("undici");
        const res = await fetch(hook.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true, hookId: hook.id, timestamp: Date.now() }),
          signal: AbortSignal.timeout(hook.timeoutMs),
        });
        return { success: res.ok, statusCode: res.status, latencyMs: Date.now() - start };
      } catch (err) {
        return { success: false, error: String(err), latencyMs: Date.now() - start };
      }
    }

    return { success: true, message: "Internal hook test not yet implemented" };
  });
}
