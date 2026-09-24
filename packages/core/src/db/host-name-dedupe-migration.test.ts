import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, runMigrations } from "./client.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

describe("0010/0011 backend host name dedupe", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "haai-migration-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** A database migrated only up to (and including) `lastTag`, as an older release would leave it. */
  function dbAt(name: string, lastTag: string): string {
    const folder = join(dir, `${name}-migrations`);
    cpSync(MIGRATIONS, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const cut = journal.entries.findIndex((e: { tag: string }) => e.tag === lastTag);
    journal.entries = journal.entries.slice(0, cut + 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const dbPath = join(dir, `${name}.db`);
    const { db, sqlite } = createDbClient(dbPath);
    migrate(db, { migrationsFolder: folder });
    sqlite.close();
    return dbPath;
  }

  function insertBackends(dbPath: string, rows: Array<[id: string, host: string, provider: string, createdAt: number]>) {
    const { sqlite } = createDbClient(dbPath);
    const stmt = sqlite.prepare(
      "INSERT INTO backends (id, name, display_name, host_name, provider, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'http://x', 1, ?, ?)",
    );
    for (const [id, host, provider, createdAt] of rows) stmt.run(id, `n-${id}`, id, host, provider, createdAt, createdAt);
    sqlite.close();
  }

  function hosts(dbPath: string): Record<string, string> {
    const { sqlite } = createDbClient(dbPath);
    const rows = sqlite.prepare("SELECT id, host_name FROM backends").all() as Array<{ id: string; host_name: string }>;
    sqlite.close();
    return Object.fromEntries(rows.map((r) => [r.id, r.host_name]));
  }

  it("upgrades a pre-0010 database with duplicate host names, keeping the oldest", () => {
    const dbPath = dbAt("pre0010", "0009_backend_reasoning_caps");
    insertBackends(dbPath, [
      ["old", "gpu1", "ollama", 100],
      ["same-provider", "gpu1", "ollama", 200],
      ["other-provider", "gpu1", "vllm", 300],
      ["tie-b", "gpu2", "ollama", 100],
      ["tie-a", "gpu2", "vllm", 100],
      ["solo", "gpu3", "ollama", 100],
    ]);

    expect(() => runMigrations(dbPath)).not.toThrow();
    expect(hosts(dbPath)).toEqual({
      old: "gpu1",
      "same-provider": "gpu1-n-same-provider",
      "other-provider": "gpu1-n-other-provider",
      "tie-a": "gpu2",
      "tie-b": "gpu2-n-tie-b",
      solo: "gpu3",
    });
  });

  it("upgrades a database that applied the original 0010 (duplicates across providers)", () => {
    const dbPath = dbAt("post0010", "0010_backend_host_provider_unique");
    insertBackends(dbPath, [
      ["a", "gpu1", "ollama", 100],
      ["b", "gpu1", "vllm", 200],
    ]);

    expect(() => runMigrations(dbPath)).not.toThrow();
    expect(hosts(dbPath)).toEqual({ a: "gpu1", b: "gpu1-n-b" });
  });
});
