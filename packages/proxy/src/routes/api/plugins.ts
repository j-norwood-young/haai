import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  plugins as pluginsTable,
  pluginBindings as bindingsTable,
} from "@haai/core";
import type { AppContext } from "../../context.js";
import { installPlugin, preparePlugin } from "../../plugins/installer.js";
import { checkInstallConflict, samePluginName } from "../../plugins/version.js";
import { findScopedBinding, isUniqueViolation } from "../../plugins/bindings.js";
import { listExamplePlugins } from "../../plugins/examples.js";

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
    const bindingRows = await ctx.db.db.select().from(bindingsTable).all();
    const bindingsByPlugin = new Map<string, ReturnType<typeof mapBinding>[]>();
    for (const row of bindingRows) {
      const list = bindingsByPlugin.get(row.pluginId) ?? [];
      list.push(mapBinding(row));
      bindingsByPlugin.set(row.pluginId, list);
    }
    return rows.map((p) => ({
      ...p,
      manifest: JSON.parse(p.manifest) as unknown,
      configSchema: p.configSchema ? (JSON.parse(p.configSchema) as unknown) : null,
      bindings: bindingsByPlugin.get(p.id) ?? [],
    }));
  });

  // Example plugins shipped in the repo's examples/plugins/ (empty when running from an installed package)
  app.get("/api/v1/plugins/examples", async () => listExamplePlugins());

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

  // Install a plugin from source. A plugin's name is its identity: installing under a name that's
  // already taken is a 409 `name_taken`, unless the incoming plugin is a strictly newer version of
  // it — then it's a 409 `upgrade_available` until the caller re-posts with `upgrade: true`, which
  // replaces the plugin in place (same ID, so bindings survive).
  app.post<{ Body: { source: string; name?: string; upgrade?: boolean } }>("/api/v1/plugins", async (req, reply) => {
    const { source, upgrade } = req.body;
    if (!source) return reply.status(400).send({ error: "source is required" });
    const name = req.body.name?.trim() || undefined;

    const id = `plugin-${nanoid(8)}`;
    const now = Date.now();

    try {
      const prepared = await preparePlugin(source, id);
      const effectiveName = name ?? prepared.manifest.name;
      const installed = await ctx.db.db.select().from(pluginsTable).all();
      const conflict = checkInstallConflict(installed, effectiveName, prepared.version);

      if (conflict.kind === "name_taken") {
        const { existing } = conflict;
        return reply.status(409).send({
          code: "name_taken",
          error: `A plugin named '${existing.name}' is already installed${existing.version ? ` (v${existing.version})` : ""}. Choose a different name.`,
          name: existing.name,
        });
      }

      if (conflict.kind === "upgrade") {
        const { existing } = conflict;
        if (!upgrade) {
          return reply.status(409).send({
            code: "upgrade_available",
            error: `'${existing.name}' is already installed at v${existing.version}; v${prepared.version} is available.`,
            name: existing.name,
            pluginId: existing.id,
            currentVersion: existing.version,
            newVersion: prepared.version,
          });
        }

        const result = await prepared.bundle(ctx.pluginsDir, existing.id);
        await ctx.db.db
          .update(pluginsTable)
          .set({
            description: result.manifest.description ?? null,
            source,
            version: result.version,
            manifest: JSON.stringify(result.manifest),
            configSchema: result.configSchema ? JSON.stringify(result.configSchema) : null,
            bundlePath: result.bundlePath,
            needsResponseBuffer: result.needsResponseBuffer,
            updatedAt: now,
          })
          .where(eq(pluginsTable.id, existing.id))
          .run();
        ctx.pluginRuntime.invalidate(existing.id);

        const upgraded = await ctx.db.db.select().from(pluginsTable).where(eq(pluginsTable.id, existing.id)).get();
        return reply.status(200).send({
          ...upgraded,
          manifest: JSON.parse(upgraded!.manifest) as unknown,
          configSchema: upgraded!.configSchema ? (JSON.parse(upgraded!.configSchema) as unknown) : null,
          upgradedFrom: existing.version,
        });
      }

      const result = await prepared.bundle(ctx.pluginsDir, id);

      await ctx.db.db
        .insert(pluginsTable)
        .values({
          id,
          name: effectiveName,
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
      if (body["name"] !== undefined) {
        const name = (body["name"] as string).trim();
        const others = await ctx.db.db.select().from(pluginsTable).all();
        if (others.some((p) => p.id !== plugin.id && samePluginName(p.name, name))) {
          return reply.status(409).send({
            code: "name_taken",
            error: `A plugin named '${name}' is already installed. Choose a different name.`,
            name,
          });
        }
        updates.name = name;
      }
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

    // Global bindings have no scope ID; every other scope needs one.
    const scope = scopeType === "global" ? null : scopeId?.trim() || null;
    if (scopeType !== "global" && scope === null) {
      return reply.status(400).send({ error: `scopeId is required for ${scopeType} bindings` });
    }

    // A plugin binds to a given scope once — a second binding would run it twice per request.
    const alreadyBound = () => {
      const noun = { global: "all requests", vmodel: "this v-model", backend: "this backend", key: "this API key" }[
        scopeType as "global" | "vmodel" | "backend" | "key"
      ];
      return reply.status(409).send({
        code: "binding_exists",
        error: `'${plugin.name}' is already bound to ${noun}.`,
      });
    };
    if (await findScopedBinding(ctx.db.db, plugin.id, scopeType, scope)) return alreadyBound();

    const id = `binding-${nanoid(8)}`;
    const now = Date.now();

    try {
      await ctx.db.db
        .insert(bindingsTable)
        .values({
          id,
          pluginId: req.params.id,
          scopeType,
          scopeId: scope,
          config: config ? JSON.stringify(config) : null,
          order: order ?? 0,
          enabled: enabled ?? true,
          createdAt: now,
        })
        .run();
    } catch (err) {
      // Lost a race with a concurrent request; the unique index is the real guard.
      if (isUniqueViolation(err)) return alreadyBound();
      throw err;
    }

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
