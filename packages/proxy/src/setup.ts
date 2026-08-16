import { hash } from "@node-rs/argon2";
import { nanoid } from "nanoid";
import { users } from "@ai-v-models/core";
import type { DbClient } from "@ai-v-models/core";
import { getLogger } from "./logger.js";

/**
 * Ensure at least one admin user exists.
 * On first run, creates the admin user from environment variables or defaults.
 */
export async function ensureAdminUser(db: DbClient): Promise<void> {
  const log = getLogger();
  const existing = await db.db.select().from(users).all();

  if (existing.length > 0) return;

  const adminUsername = process.env["AIVM_ADMIN_USER"] ?? "admin";
  const adminPassword = process.env["AIVM_ADMIN_PASSWORD"] ?? "admin";

  const passwordHash = await hash(adminPassword);
  const now = Date.now();

  await db.db
    .insert(users)
    .values({
      id: `user-${nanoid(8)}`,
      username: adminUsername,
      displayName: "Administrator",
      passwordHash,
      role: "admin",
      enabled: true,
      mustChangePassword: true,
      totpEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  log.warn(
    { username: adminUsername },
    "Created initial admin user (default password: admin). You must change the password on first login.",
  );
}
