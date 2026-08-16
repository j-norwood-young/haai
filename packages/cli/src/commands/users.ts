import type { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import {
  createDbClient,
  runMigrations,
  defaultDataDir,
  users,
} from "@haai/core";

async function openDb() {
  const dataDir = process.env["HAAI_DATA_DIR"] ?? defaultDataDir();
  const dbPath = join(dataDir, "data.db");
  runMigrations(dbPath);
  return { db: createDbClient(dbPath), dataDir, dbPath };
}

export function registerUserCommands(program: Command): void {
  const cmd = program.command("user").description("Manage admin users (direct database access)");

  cmd
    .command("list")
    .description("List all users")
    .action(async () => {
      const { db } = await openDb();
      const rows = await db.db.select().from(users).all();
      if (rows.length === 0) {
        console.log(chalk.yellow("No users found."));
        return;
      }
      const data = [
        ["Username", "Role", "Enabled", "Must change pw", "2FA", "Last login"],
        ...rows.map((u) => [
          u.username,
          u.role,
          u.enabled ? chalk.green("yes") : chalk.red("no"),
          u.mustChangePassword ? chalk.yellow("yes") : "no",
          u.totpEnabled ? chalk.green("yes") : "no",
          u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never",
        ]),
      ];
      console.log(table(data));
    });

  cmd
    .command("set-password")
    .description("Set a user's password")
    .requiredOption("--username <username>", "Username")
    .requiredOption("--password <password>", "New password")
    .option("--force-change", "Require password change on next login")
    .option("--no-force-change", "Do not require password change on next login")
    .action(async (opts: { username: string; password: string; forceChange?: boolean }) => {
      const { db, dbPath } = await openDb();
      const user = await db.db
        .select()
        .from(users)
        .where(eq(users.username, opts.username))
        .get();

      if (!user) {
        console.error(chalk.red(`User not found: ${opts.username}`));
        process.exit(1);
      }

      if (opts.password.length < 8) {
        console.error(chalk.red("Password must be at least 8 characters"));
        process.exit(1);
      }

      const mustChange =
        opts.forceChange === true
          ? true
          : opts.forceChange === false
            ? false
            : false;

      const passwordHash = await hash(opts.password);
      const now = Date.now();
      await db.db
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: mustChange,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
        .run();

      db.sqlite.close();
      console.log(chalk.green(`Password updated for ${opts.username}`));
      console.log(chalk.dim(`  Database: ${dbPath}`));
    });

  cmd
    .command("create")
    .description("Create a new user")
    .requiredOption("--username <username>", "Username")
    .requiredOption("--password <password>", "Password")
    .option("--display-name <name>", "Display name")
    .option("--role <role>", "Role (admin or viewer)", "viewer")
    .action(
      async (opts: {
        username: string;
        password: string;
        displayName?: string;
        role: string;
      }) => {
        const { db, dbPath } = await openDb();
        const existing = await db.db
          .select()
          .from(users)
          .where(eq(users.username, opts.username))
          .get();

        if (existing) {
          console.error(chalk.red(`User already exists: ${opts.username}`));
          process.exit(1);
        }

        if (opts.password.length < 8) {
          console.error(chalk.red("Password must be at least 8 characters"));
          process.exit(1);
        }

        const { nanoid } = await import("nanoid");
        const now = Date.now();
        const id = `user-${nanoid(8)}`;

        await db.db
          .insert(users)
          .values({
            id,
            username: opts.username,
            displayName: opts.displayName ?? opts.username,
            passwordHash: await hash(opts.password),
            role: opts.role,
            enabled: true,
            mustChangePassword: false,
            totpEnabled: false,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        db.sqlite.close();
        console.log(chalk.green(`Created user ${opts.username} (${opts.role})`));
        console.log(chalk.dim(`  Database: ${dbPath}`));
      },
    );
}
