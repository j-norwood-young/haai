import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, pluginBindings, plugins, runMigrations, type DbClient } from "@haai/core";
import { findScopedBinding, isUniqueViolation } from "./bindings.js";

describe("plugin binding uniqueness helpers", () => {
  let dir: string;
  let db: DbClient;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "haai-bindings-"));
    const dbPath = join(dir, "data.db");
    runMigrations(dbPath);
    db = createDbClient(dbPath);
    db.db
      .insert(plugins)
      .values({ id: "p", name: "P", source: "local:/x", manifest: "{}", enabled: true, createdAt: 1, updatedAt: 1 })
      .run();
  });
  afterAll(() => {
    db.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const insert = (id: string, scopeType: string, scopeId: string | null) =>
    db.db
      .insert(pluginBindings)
      .values({ id, pluginId: "p", scopeType, scopeId, order: 0, enabled: true, createdAt: 1 })
      .run();

  it("recognises the unique-index violation as raised through drizzle, for scoped and global bindings", () => {
    insert("a", "vmodel", "v1");
    let scoped: unknown;
    try {
      insert("b", "vmodel", "v1");
    } catch (err) {
      scoped = err;
    }
    expect(isUniqueViolation(scoped)).toBe(true);

    insert("g1", "global", null);
    let global: unknown;
    try {
      insert("g2", "global", null);
    } catch (err) {
      global = err;
    }
    expect(isUniqueViolation(global)).toBe(true);
  });

  it("does not mistake other errors for a unique violation", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    let fk: unknown;
    try {
      db.db
        .insert(pluginBindings)
        .values({ id: "x", pluginId: "no-such-plugin", scopeType: "global", scopeId: null, order: 0, enabled: true, createdAt: 1 })
        .run();
    } catch (err) {
      fk = err;
    }
    expect(fk).toBeDefined();
    expect(isUniqueViolation(fk)).toBe(false);
  });

  it("finds the binding for exactly one scope, treating global as a null scope ID", async () => {
    expect((await findScopedBinding(db.db, "p", "vmodel", "v1"))?.id).toBe("a");
    expect(await findScopedBinding(db.db, "p", "vmodel", "v2")).toBeUndefined();
    expect((await findScopedBinding(db.db, "p", "global", null))?.id).toBe("g1");
    expect(await findScopedBinding(db.db, "p", "backend", "v1")).toBeUndefined();
  });
});
