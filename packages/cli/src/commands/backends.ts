import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { table } from "table";
import type { ApiClient } from "../api-client.js";

interface Backend {
  id: string;
  name: string;
  displayName: string;
  hostName: string;
  provider: string;
  baseUrl: string;
  keyMode: string;
  enabled: boolean;
  weight: number;
  lastHealthStatus?: string;
  lastLatencyMs?: number;
}

export function registerBackendCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const cmd = program
    .command("backend")
    .description("Manage LLM backends");

  cmd
    .command("list")
    .description("List all backends")
    .action(async () => {
      const client = getClient();
      const backends = await client.get<Backend[]>("/api/v1/backends");
      if (backends.length === 0) {
        console.log(chalk.yellow("No backends configured."));
        return;
      }
      const data = [
        ["Name", "Provider", "Host", "URL", "Mode", "Status", "Latency"],
        ...backends.map((b) => [
          b.displayName,
          b.provider,
          b.hostName,
          b.baseUrl,
          b.keyMode,
          b.lastHealthStatus ?? "unknown",
          b.lastLatencyMs ? `${b.lastLatencyMs}ms` : "-",
        ]),
      ];
      console.log(table(data));
    });

  cmd
    .command("add")
    .description("Add a backend")
    .requiredOption("--name <name>", "Unique backend name")
    // Named --base-url (not --url) to avoid clashing with global haai --url (proxy URL).
    .requiredOption("--base-url <url>", "Backend base URL")
    .requiredOption("--provider <provider>", "Provider: lmstudio|ollama|vllm|openai|generic")
    .requiredOption("--hostname <hostname>", "Hostname label (e.g. bob)")
    .option("--api-key <key>", "API key for abstraction mode")
    .option("--mode <mode>", "Key mode: passthrough|abstraction", "passthrough")
    .option("--weight <weight>", "Load balancing weight", "1")
    .action(async (opts) => {
      const client = getClient();
      const spinner = ora("Adding backend...").start();
      try {
        const backend = await client.post<Backend>("/api/v1/backends", {
          name: opts.name,
          displayName: opts.name,
          hostName: opts.hostname,
          provider: opts.provider,
          baseUrl: opts.baseUrl,
          keyMode: opts.mode,
          apiKey: opts.apiKey,
          weight: parseInt(opts.weight, 10),
        });
        spinner.succeed(chalk.green(`Backend '${backend.name}' added (${backend.id})`));
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command("remove <name>")
    .description("Remove a backend by name")
    .action(async (name) => {
      const client = getClient();
      const backends = await client.get<Backend[]>("/api/v1/backends");
      const backend = backends.find((b) => b.name === name || b.id === name);
      if (!backend) {
        console.error(chalk.red(`Backend '${name}' not found`));
        process.exit(1);
      }
      await client.delete(`/api/v1/backends/${backend.id}`);
      console.log(chalk.green(`Backend '${name}' removed`));
    });

  cmd
    .command("test <name>")
    .description("Test backend connectivity")
    .action(async (name) => {
      const client = getClient();
      const backends = await client.get<Backend[]>("/api/v1/backends");
      const backend = backends.find((b) => b.name === name || b.id === name);
      if (!backend) {
        console.error(chalk.red(`Backend '${name}' not found`));
        process.exit(1);
      }
      const spinner = ora("Testing backend...").start();
      try {
        const result = await client.post<{
          success: boolean;
          latencyMs: number;
          statusCode?: number;
          models?: string[];
          error?: string;
        }>(`/api/v1/backends/${backend.id}/test`);
        if (result.success) {
          spinner.succeed(chalk.green(`Connected in ${result.latencyMs}ms`));
          if (result.models?.length) {
            console.log(`  Models: ${result.models.join(", ")}`);
          }
        } else {
          spinner.fail(chalk.red(`Connection failed: ${result.error}`));
        }
      } catch (err) {
        spinner.fail(chalk.red(String(err)));
        process.exit(1);
      }
    });
}
