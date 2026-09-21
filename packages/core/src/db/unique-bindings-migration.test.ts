import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, runMigrations } from "./client.js";

const MIGRATION = fileURLToPath(new URL("../../migrations/0014_unique_bindings_and_mappings.sql", import.meta.url));

describe("0014_unique_bindings_and_mappings", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "haai-migration-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function freshDb(name: string): Database {
    const dbPath = join(dir, name);
    runMigrations(dbPath);
    const { sqlite } = createDbClient(dbPath);
    const now = 1_000;
    sqlite
      .prepare("INSERT INTO plugins (id, name, source, manifest, enabled, created_at, updated_at) VALUES ('p1', 'P1', 'local:/x', '{}', 1, ?, ?), ('p2', 'P2', 'local:/x', '{}', 1, ?, ?)")
      .run(now, now, now, now);
    sqlite
      .prepare("INSERT INTO backends (id, name, display_name, host_name, provider, base_url, enabled, created_at, updated_at) VALUES ('b1', 'b1', 'b1', 'h1', 'generic', 'http://x', 1, ?, ?)")
      .run(now, now);
    sqlite
      .prepare("INSERT INTO vmodels (id, model_id, display_name, balancing_strategy, streaming, allow_tool_calling, allow_vision, allow_embeddings, enabled, created_at, updated_at) VALUES ('v1', 'v1', 'V1', 'session-pin', 1, 1, 1, 1, 1, ?, ?), ('v2', 'v2', 'V2', 'session-pin', 1, 1, 1, 1, 1, ?, ?)")
      .run(now, now, now, now);
    return sqlite;
  }

  const bind = (db: Database, id: string, plugin: string, type: string, scopeId: string | null, createdAt: number) =>
    db
      .prepare('INSERT INTO plugin_bindings (id, plugin_id, scope_type, scope_id, "order", enabled, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)')
      .run(id, plugin, type, scopeId, createdAt);
  const map = (db: Database, id: string, vmodel: string, model: string, createdAt: number) =>
    db
      .prepare("INSERT INTO vmodel_backends (id, vmodel_id, backend_id, backend_model_id, weight, enabled, created_at) VALUES (?, ?, 'b1', ?, 1, 1, ?)")
      .run(id, vmodel, model, createdAt);
  const ids = (db: Database, table: string) =>
    (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((r) => r.id);

  it("makes the database refuse duplicate bindings and mappings", () => {
    const db = freshDb("guard.db");
    bind(db, "b-vm", "p1", "vmodel", "v1", 1);
    expect(() => bind(db, "b-vm-dup", "p1", "vmodel", "v1", 2)).toThrow(/UNIQUE/);

    // Global bindings have a NULL scope_id, which a plain unique index would treat as always distinct
    bind(db, "b-global", "p1", "global", null, 1);
    expect(() => bind(db, "b-global-dup", "p1", "global", null, 2)).toThrow(/UNIQUE/);

    // Different plugin, or different scope, is fine
    expect(() => bind(db, "b-other-plugin", "p2", "vmodel", "v1", 3)).not.toThrow();
    expect(() => bind(db, "b-other-scope", "p1", "vmodel", "v2", 3)).not.toThrow();
    // ...even when the scope ID coincides with another scope type's
    expect(() => bind(db, "b-other-type", "p1", "backend", "v1", 3)).not.toThrow();

    map(db, "m1", "v1", "model-a", 1);
    expect(() => map(db, "m1-dup", "v1", "model-a", 2)).toThrow(/UNIQUE/);
    expect(() => map(db, "m1-other-model", "v1", "model-b", 2)).not.toThrow();
    expect(() => map(db, "m1-other-vmodel", "v2", "model-a", 2)).not.toThrow();
    db.close();
  });

  it("dedupes existing rows on upgrade, keeping the oldest and leaving legitimate rows alone", () => {
    const db = freshDb("upgrade.db");
    // Recreate the pre-migration state: no unique indexes, duplicates present
    db.exec("DROP INDEX idx_plugin_bindings_unique_scope; DROP INDEX idx_vmodel_backends_unique_model;");

    bind(db, "b-old", "p1", "vmodel", "v1", 100); // oldest of the set: kept
    bind(db, "b-new", "p1", "vmodel", "v1", 200);
    bind(db, "b-newest", "p1", "vmodel", "v1", 300);
    bind(db, "g-old", "p1", "global", null, 100);
    bind(db, "g-new", "p1", "global", null, 150);
    bind(db, "tie-b", "p2", "backend", "b1", 100); // same timestamp: lowest id is kept
    bind(db, "tie-a", "p2", "backend", "b1", 100);
    bind(db, "keep-other-plugin", "p2", "vmodel", "v1", 500);
    bind(db, "keep-other-scope", "p1", "vmodel", "v2", 500);
    map(db, "m-old", "v1", "model-a", 100);
    map(db, "m-new", "v1", "model-a", 200);
    map(db, "m-keep", "v1", "model-b", 300);

    db.exec(readFileSync(MIGRATION, "utf8"));

    expect(ids(db, "plugin_bindings")).toEqual(
      ["b-old", "g-old", "keep-other-plugin", "keep-other-scope", "tie-a"].sort(),
    );
    expect(ids(db, "vmodel_backends")).toEqual(["m-keep", "m-old"]);

    // ...and the guard is in place afterwards
    expect(() => bind(db, "again", "p1", "vmodel", "v1", 999)).toThrow(/UNIQUE/);
    expect(() => map(db, "again-m", "v1", "model-a", 999)).toThrow(/UNIQUE/);
    db.close();
  });
});
