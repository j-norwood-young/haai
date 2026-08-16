import type { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import type { ApiClient } from "../api-client.js";

interface Hook {
  id: string;
  name: string;
  type: string;
  trigger: string;
  enabled: boolean;
  module?: string;
  webhookUrl?: string;
  timeoutMs: number;
}

export function registerHookCommands(program: Command, getClient: () => ApiClient): void {
  const cmd = program.command("hook").description("Manage hooks");

  cmd
    .command("list")
    .description("List all hooks")
    .action(async () => {
      const client = getClient();
      const hooks = await client.get<Hook[]>("/api/v1/hooks");
      if (hooks.length === 0) {
        console.log(chalk.yellow("No hooks configured."));
        return;
      }
      const data = [
        ["Name", "Type", "Trigger", "Enabled", "Module/URL"],
        ...hooks.map((h) => [
          h.name,
          h.type,
          h.trigger,
          h.enabled ? chalk.green("yes") : chalk.red("no"),
          h.module ?? h.webhookUrl ?? "-",
        ]),
      ];
      console.log(table(data));
    });

  cmd
    .command("add-webhook")
    .description("Register an external webhook hook")
    .requiredOption("--name <name>", "Hook name")
    // Named --webhook-url (not --url) to avoid clashing with global haai --url (proxy URL).
    .requiredOption("--webhook-url <url>", "Webhook URL")
    .requiredOption("--trigger <trigger>", "pre-request|post-completion")
    .option("--secret <secret>", "Signing secret")
    .option("--timeout <ms>", "Timeout in ms", "5000")
    .action(async (opts) => {
      const client = getClient();
      const hook = await client.post<Hook>("/api/v1/hooks", {
        name: opts.name,
        type: "external",
        trigger: opts.trigger,
        webhookUrl: opts.webhookUrl,
        webhookSecret: opts.secret,
        timeoutMs: parseInt(opts.timeout, 10),
      });
      console.log(chalk.green(`Hook '${hook.name}' registered (${hook.id})`));
    });

  cmd
    .command("add-internal")
    .description("Register an internal (NPM/local) hook")
    .requiredOption("--name <name>", "Hook name")
    .requiredOption("--module <module>", "NPM package or local file path")
    .requiredOption("--trigger <trigger>", "pre-request|post-completion")
    .option("--timeout <ms>", "Timeout in ms", "5000")
    .action(async (opts) => {
      const client = getClient();
      const hook = await client.post<Hook>("/api/v1/hooks", {
        name: opts.name,
        type: "internal",
        trigger: opts.trigger,
        module: opts.module,
        timeoutMs: parseInt(opts.timeout, 10),
      });
      console.log(chalk.green(`Hook '${hook.name}' registered (${hook.id})`));
    });

  cmd
    .command("test <name>")
    .description("Test a hook with a mock payload")
    .action(async (name) => {
      const client = getClient();
      const hooks = await client.get<Hook[]>("/api/v1/hooks");
      const hook = hooks.find((h) => h.name === name || h.id === name);
      if (!hook) {
        console.error(chalk.red(`Hook '${name}' not found`));
        process.exit(1);
      }
      const result = await client.post<{ success: boolean; latencyMs?: number; error?: string }>(
        `/api/v1/hooks/${hook.id}/test`,
      );
      if (result.success) {
        console.log(chalk.green(`Hook test succeeded${result.latencyMs ? ` (${result.latencyMs}ms)` : ""}`));
      } else {
        console.error(chalk.red(`Hook test failed: ${result.error}`));
      }
    });

  cmd
    .command("delete <name>")
    .description("Delete a hook")
    .action(async (name) => {
      const client = getClient();
      const hooks = await client.get<Hook[]>("/api/v1/hooks");
      const hook = hooks.find((h) => h.name === name || h.id === name);
      if (!hook) {
        console.error(chalk.red(`Hook '${name}' not found`));
        process.exit(1);
      }
      await client.delete(`/api/v1/hooks/${hook.id}`);
      console.log(chalk.green(`Hook '${name}' deleted`));
    });
}
