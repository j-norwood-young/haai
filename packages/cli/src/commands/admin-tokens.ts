import type { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import type { ApiClient } from "../api-client.js";

interface AdminToken {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

interface CreateAdminTokenResponse extends AdminToken {
  token: string;
}

export function registerAdminTokenCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const cmd = program.command("admin-token").description("Manage admin API tokens (Bearer auth)");

  cmd
    .command("list")
    .description("List admin API tokens")
    .action(async () => {
      const client = getClient();
      const tokens = await client.get<AdminToken[]>("/api/v1/admin-tokens");
      if (tokens.length === 0) {
        console.log(chalk.yellow("No admin tokens."));
        return;
      }
      const data = [
        ["Prefix", "Name", "Enabled", "Expires", "Last used"],
        ...tokens.map((t) => [
          t.prefix,
          t.name,
          t.enabled ? chalk.green("yes") : chalk.red("no"),
          t.expiresAt ? new Date(t.expiresAt).toLocaleString() : "never",
          t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never",
        ]),
      ];
      console.log(table(data));
    });

  cmd
    .command("create")
    .description("Create a new admin API token")
    .requiredOption("--name <name>", "Token label")
    .option("--expires-in <days>", "Expiry in days")
    .action(async (opts: { name: string; expiresIn?: string }) => {
      const client = getClient();
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.expiresIn) body["expiresInDays"] = parseInt(opts.expiresIn, 10);

      const result = await client.post<CreateAdminTokenResponse>("/api/v1/admin-tokens", body);
      console.log(chalk.green("Admin token created"));
      console.log(chalk.bold("\n  Token (save this — shown once):\n"));
      console.log(`  ${result.token}\n`);
      console.log(chalk.dim(`  Prefix: ${result.prefix}`));
      console.log(chalk.dim(`  Export: export HAAI_ADMIN_TOKEN="${result.token}"`));
    });

  cmd
    .command("revoke")
    .description("Revoke an admin API token")
    .argument("<id>", "Token ID")
    .action(async (id: string) => {
      const client = getClient();
      await client.delete(`/api/v1/admin-tokens/${id}`);
      console.log(chalk.green(`Revoked token ${id}`));
    });
}
