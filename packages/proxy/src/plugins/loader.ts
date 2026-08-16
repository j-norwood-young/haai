import { eq, and, or } from "drizzle-orm";
import { plugins as pluginsTable, pluginBindings as bindingsTable } from "@haai/core";
import type { ResolvedBinding } from "@haai/core";
import type { DbClient } from "@haai/core";
import { getLogger } from "../logger.js";

export interface BindingLookupOpts {
  vmodelId: string | null;
  backendId: string;
  keyId: string | null;
}

/**
 * Collect all enabled plugin bindings that apply to this request, ordered by
 * (order ASC, binding_id ASC).
 *
 * A binding applies when:
 *   - scope_type = "global"
 *   - scope_type = "vmodel" AND scope_id = vmodelId
 *   - scope_type = "backend" AND scope_id = backendId
 *   - scope_type = "key"    AND scope_id = keyId
 */
export async function resolveBindings(
  db: DbClient,
  opts: BindingLookupOpts,
): Promise<ResolvedBinding[]> {
  const log = getLogger();

  const scopeConditions = [
    eq(bindingsTable.scopeType, "global"),
    ...(opts.vmodelId ? [and(eq(bindingsTable.scopeType, "vmodel"), eq(bindingsTable.scopeId, opts.vmodelId))!] : []),
    and(eq(bindingsTable.scopeType, "backend"), eq(bindingsTable.scopeId, opts.backendId))!,
    ...(opts.keyId ? [and(eq(bindingsTable.scopeType, "key"), eq(bindingsTable.scopeId, opts.keyId))!] : []),
  ];

  const rows = await db.db
    .select({
      bindingId: bindingsTable.id,
      pluginId: pluginsTable.id,
      pluginName: pluginsTable.name,
      bundlePath: pluginsTable.bundlePath,
      needsResponseBuffer: pluginsTable.needsResponseBuffer,
      configSchema: pluginsTable.configSchema,
      bindingConfig: bindingsTable.config,
      order: bindingsTable.order,
    })
    .from(bindingsTable)
    .innerJoin(pluginsTable, eq(bindingsTable.pluginId, pluginsTable.id))
    .where(
      and(
        eq(bindingsTable.enabled, true),
        eq(pluginsTable.enabled, true),
        or(...scopeConditions),
      ),
    )
    .all();

  const resolved: ResolvedBinding[] = [];
  for (const row of rows) {
    if (!row.bundlePath) {
      log.warn({ pluginId: row.pluginId }, "Plugin has no bundle — skipping");
      continue;
    }

    const configSchema = row.configSchema
      ? (JSON.parse(row.configSchema) as Record<string, unknown>)
      : {};
    const config = row.bindingConfig
      ? (JSON.parse(row.bindingConfig) as Record<string, unknown>)
      : buildDefaultConfig(configSchema);

    resolved.push({
      bindingId: row.bindingId,
      pluginId: row.pluginId,
      pluginName: row.pluginName,
      bundlePath: row.bundlePath,
      needsResponseBuffer: row.needsResponseBuffer,
      configSchema,
      config,
      order: row.order,
    });
  }

  // Sort by order then by binding ID for stability
  resolved.sort((a, b) => a.order - b.order || a.bindingId.localeCompare(b.bindingId));
  return resolved;
}

function buildDefaultConfig(schema: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const f = field as Record<string, unknown>;
    if ("default" in f) defaults[key] = f["default"];
  }
  return defaults;
}
