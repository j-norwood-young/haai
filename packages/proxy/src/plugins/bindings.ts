import { and, eq, isNull } from "drizzle-orm";
import { pluginBindings as bindingsTable } from "@haai/core";
import type { DbClient } from "@haai/core";

/** Anything with drizzle's `delete` — the db itself or a transaction handle */
type Deleter = Pick<DbClient["db"], "delete">;

export type BindingScope = "vmodel" | "backend" | "key";

/**
 * Remove the plugin bindings scoped to a v-model, backend or key. `scope_id` is a plain column,
 * not a foreign key, so deleting the entity doesn't cascade — every delete path must call this
 * (inside the same transaction as the delete) or the plugin keeps a binding to nothing.
 */
export function removeScopedBindings(db: Deleter, scopeType: BindingScope, scopeId: string): void {
  db.delete(bindingsTable)
    .where(and(eq(bindingsTable.scopeType, scopeType), eq(bindingsTable.scopeId, scopeId)))
    .run();
}

/** The binding of a plugin to exactly this scope, if there is one. `scopeId` is null for global. */
export function findScopedBinding(
  db: Pick<DbClient["db"], "select">,
  pluginId: string,
  scopeType: string,
  scopeId: string | null,
) {
  return db
    .select()
    .from(bindingsTable)
    .where(
      and(
        eq(bindingsTable.pluginId, pluginId),
        eq(bindingsTable.scopeType, scopeType),
        scopeId === null ? isNull(bindingsTable.scopeId) : eq(bindingsTable.scopeId, scopeId),
      ),
    )
    .get();
}

/** True for a SQLite unique-constraint failure, whether or not drizzle wrapped the driver error */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}
