import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export interface DbClient {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: SqliteDatabase;
}

export function createDbClient(dbPath: string): DbClient {
  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent reads + better performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function runMigrations(dbPath: string): void {
  const { db } = createDbClient(dbPath);
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Workspace layout: packages/core/dist/db → packages/core/migrations.
  // Published npm bundle: <pkg>/dist → <pkg>/dist/migrations (copied by the
  // packages/app build). Pick the first candidate that has a journal.
  const candidates = [join(__dirname, "../../migrations"), join(__dirname, "migrations")];
  const migrationsFolder = candidates.find((dir) => existsSync(join(dir, "meta", "_journal.json")));
  if (!migrationsFolder) {
    throw new Error(`Migrations folder not found (searched: ${candidates.join(", ")})`);
  }
  migrate(db, { migrationsFolder });
}

export { schema };
