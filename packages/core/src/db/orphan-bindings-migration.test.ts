import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, runMigrations } from "./client.js";

describe("0013_orphan_plugin_bindings", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "haai-migration-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is registered and deletes only bindings whose scope no longer exists", () => {
    const dbPath = join(dir, "data.db");
    runMigrations(dbPath); // proves the journal entry resolves and the SQL is valid to apply
    const { sqlite } = createDbClient(dbPath);

    const now = Date.now();
    sqlite
      .prepare(
        "INSERT INTO plugins (id, name, source, manifest, enabled, created_at, updated_at) VALUES ('p', 'P', 'local:/x', '{}', 1, ?, ?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO backends (id, name, display_name, host_name, provider, base_url, enabled, created_at, updated_at) VALUES ('be-live', 'be', 'be', 'h', 'generic', 'http://x', 1, ?, ?)",
      )
      .run(now, now);

    const insert = sqlite.prepare(
      "INSERT INTO plugin_bindings (id, plugin_id, scope_type, scope_id, \"order\", enabled, created_at) VALUES (?, 'p', ?, ?, 0, 1, ?)",
    );
    insert.run("b-global", "global", null, now);
    insert.run("b-live", "backend", "be-live", now);
    insert.run("b-dead-backend", "backend", "be-gone", now);
    insert.run("b-dead-vmodel", "vmodel", "vm-gone", now);
    insert.run("b-dead-key", "key", "key-gone", now);

    const sql = readFileSync(
      fileURLToPath(new URL("../../migrations/0013_orphan_plugin_bindings.sql", import.meta.url)),
      "utf8",
    );
    sqlite.exec(sql);

    const remaining = (sqlite.prepare("SELECT id FROM plugin_bindings ORDER BY id").all() as Array<{ id: string }>).map(
      (r) => r.id,
    );
    expect(remaining).toEqual(["b-global", "b-live"]);
    sqlite.close();
  });
});
