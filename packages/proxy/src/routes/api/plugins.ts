import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  plugins as pluginsTable,
  pluginBindings as bindingsTable,
} from "@haai/core";
import type { AppContext } from "../../context.js";
import { installPlugin } from "../../plugins/installer.js";

type BindingRow = typeof bindingsTable.$inferSelect;

function mapBinding(row: BindingRow) {
  return {
    ...row,
    config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : null,
  };
}

export async function pluginsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ── Plugins ─────────────────────────────────────────────────────────────────

  // List all plugins
  app.get("/api/v1/plugins", async () => {
    const rows = await ctx.db.db.select().from(pluginsTable).all();
    return rows.map((p) => ({
      ...p,
      manifest: JSON.parse(p.manifest) as unknown,
      configSchema: p.configSchema ? (JSON.parse(p.configSchema) as unknown) : null,
    }));
  });

  // Get single plugin
  app.get<{ Params: { id: string } }>("/api/v1/plugins/:id", async (req, reply) => {
    const plugin = await ctx.db.db
      .select()
      .from(pluginsTable)
      .where(eq(pluginsTable.id, req.params.id))
      .get();
    if (!plugin) return reply.status(404).send({ error: "Plugin not found" });

    const bindings = await ctx.db.db
      .select()
      .from(bindingsTable)
      .where(eq(bindingsTable.pluginId, plugin.id))
      .all();

    return {
      ...plugin,
      manifest: JSON.parse(plugin.manifest) as unknown,
      configSchema: plugin.configSchema ? (JSON.parse(plugin.configSchema) as unknown) : null,
      bindings: bindings.map(mapBinding),
    };
  });

  // Install a plugin from source
  app.post<{ Body: { source: string; name?: string } }>("/api/v1/plugins", async (req, reply) => {
    const { source, name } = req.body;
    if (!source) return reply.status(400).send({ error: "source is required" });

    const id = `plugin-${nanoid(8)}`;
    const now = Date.now();

    try {
      const result = await installPlugin(source, ctx.pluginsDir, id);

      await ctx.db.db
        .insert(pluginsTable)
        .values({
          id,
          name: name ?? result.manifest.name,
          description: result.manifest.description ?? null,
          source,
          version: result.version,
          manifest: JSON.stringify(result.manifest),
          configSchema: result.configSchema ? JSON.stringify(result.configSchema) : null,
          bundlePath: result.bundlePath,
          needsResponseBuffer: result.needsResponseBuffer,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const created = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, id)).get();
      return reply.status(201).send({
        ...created,
        manifest: JSON.parse(created!.manifest) as unknown,
        configSchema: created!.configSchema ? (JSON.parse(created!.configSchema) as unknown) : null,
      });
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update plugin (enable/disable, name, description)
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/plugins/:id",
    async (req, reply) => {
      const plugin = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, req.params.id)).get();
      if (!plugin) return reply.status(404).send({ error: "Plugin not found" });

      const updates: Partial<typeof pluginsTable.$inferInsert> = { updatedAt: Date.now() };
      const body = req.body;
      if (body["enabled"] !== undefined) updates.enabled = body["enabled"] as boolean;
      if (body["name"] !== undefined) updates.name = body["name"] as string;
      if (body["description"] !== undefined) updates.description = body["description"] as string;

      await ctx.db.db.update(pluginsTable).set(updates).where(eq(pluginsTable.id, req.params.id)).run();

      // Invalidate cached bundle when disabling/re-enabling
      if (body["enabled"] === false) {
        ctx.pluginRuntime.invalidate(req.params.id);
      }

      return { success: true };
    },
  );

  // Reinstall/update a plugin (re-run installer)
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/reinstall", async (req, reply) => {
    const plugin = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, req.params.id)).get();
    if (!plugin) return reply.status(404).send({ error: "Plugin not found" });

    try {
      const result = await installPlugin(plugin.source, ctx.pluginsDir, plugin.id);
      await ctx.db.db
        .update(pluginsTable)
        .set({
          version: result.version,
          manifest: JSON.stringify(result.manifest),
          configSchema: result.configSchema ? JSON.stringify(result.configSchema) : null,
          bundlePath: result.bundlePath,
          needsResponseBuffer: result.needsResponseBuffer,
          updatedAt: Date.now(),
        })
        .where(eq(pluginsTable.id, plugin.id))
        .run();

      ctx.pluginRuntime.invalidate(plugin.id);
      return { success: true };
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete plugin
  app.delete<{ Params: { id: string } }>("/api/v1/plugins/:id", async (req, reply) => {
    ctx.pluginRuntime.invalidate(req.params.id);
    await ctx.db.db.delete(pluginsTable).where(eq(pluginsTable.id, req.params.id)).run();
    return reply.status(204).send();
  });

  // ── Bindings ─────────────────────────────────────────────────────────────────

  // List bindings for a plugin
  app.get<{ Params: { id: string } }>("/api/v1/plugins/:id/bindings", async (req, reply) => {
    const plugin = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, req.params.id)).get();
    if (!plugin) return reply.status(404).send({ error: "Plugin not found" });
    const rows = await ctx.db.db.select().from(bindingsTable).where(eq(bindingsTable.pluginId, req.params.id)).all();
    return rows.map(mapBinding);
  });

  // Create a binding
  app.post<{
    Params: { id: string };
    Body: {
      scopeType: string;
      scopeId?: string | null;
      config?: Record<string, unknown> | null;
      order?: number;
      enabled?: boolean;
    };
  }>("/api/v1/plugins/:id/bindings", async (req, reply) => {
    const plugin = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, req.params.id)).get();
    if (!plugin) return reply.status(404).send({ error: "Plugin not found" });

    const { scopeType, scopeId, config, order, enabled } = req.body;
    if (!["global", "vmodel", "backend", "key"].includes(scopeType)) {
      return reply.status(400).send({ error: "scopeType must be global|vmodel|backend|key" });
    }

    const id = `binding-${nanoid(8)}`;
    const now = Date.now();

    await ctx.db.db
      .insert(bindingsTable)
      .values({
        id,
        pluginId: req.params.id,
        scopeType,
        scopeId: scopeId ?? null,
        config: config ? JSON.stringify(config) : null,
        order: order ?? 0,
        enabled: enabled ?? true,
        createdAt: now,
      })
      .run();

    const created = await ctx.db.db.select().from(bindingsTable).where(eq(bindingsTable.id, id)).get();
    return reply.status(201).send(mapBinding(created!));
  });

  // Update a binding
  app.patch<{ Params: { id: string; bindingId: string }; Body: Record<string, unknown> }>(
    "/api/v1/plugins/:id/bindings/:bindingId",
    async (req, reply) => {
      const binding = await ctx.db.db
        .select()
        .from(bindingsTable)
        .where(and(eq(bindingsTable.id, req.params.bindingId), eq(bindingsTable.pluginId, req.params.id)))
        .get();
      if (!binding) return reply.status(404).send({ error: "Binding not found" });

      const body = req.body;
      const updates: Partial<typeof bindingsTable.$inferInsert> = {};
      if (body["enabled"] !== undefined) updates.enabled = body["enabled"] as boolean;
      if (body["config"] !== undefined) updates.config = body["config"] ? JSON.stringify(body["config"]) : null;
      if (body["order"] !== undefined) updates.order = body["order"] as number;

      await ctx.db.db.update(bindingsTable).set(updates).where(eq(bindingsTable.id, req.params.bindingId)).run();
      return { success: true };
    },
  );

  // Delete a binding
  app.delete<{ Params: { id: string; bindingId: string } }>(
    "/api/v1/plugins/:id/bindings/:bindingId",
    async (req, reply) => {
      await ctx.db.db
        .delete(bindingsTable)
        .where(and(eq(bindingsTable.id, req.params.bindingId), eq(bindingsTable.pluginId, req.params.id)))
        .run();
      return reply.status(204).send();
    },
  );
}
