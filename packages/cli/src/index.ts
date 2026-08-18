#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { loadHaaiDotenv } from "@haai/core/config";
import { resolveDefaultProxyUrl } from "@haai/core/http";
import { ApiHttpError, createApiClient } from "./api-client.js";
import { registerBackendCommands } from "./commands/backends.js";
import { registerVModelCommands } from "./commands/vmodels.js";
import { registerKeyCommands } from "./commands/keys.js";
import { registerHookCommands } from "./commands/hooks.js";
import { registerPluginCommands } from "./commands/plugins.js";
import { registerUserCommands } from "./commands/users.js";
import { registerAdminTokenCommands } from "./commands/admin-tokens.js";
import { registerPromptCommands } from "./commands/prompt.js";
import { registerCompletionCommands, runDynamicComplete } from "./commands/completion.js";

function explicitUrlFromArgs(args: string[]): string | undefined {
  const urlFlagIndex = args.findIndex((arg) => arg === "-u" || arg === "--url");
  if (urlFlagIndex >= 0 && args[urlFlagIndex + 1]) return args[urlFlagIndex + 1];
  return undefined;
}

function resolveAdminToken(args: string[]): string | undefined {
  const tokenFlagIndex = args.findIndex((arg) => arg === "-t" || arg === "--token");
  if (tokenFlagIndex >= 0 && args[tokenFlagIndex + 1]) return args[tokenFlagIndex + 1];
  return process.env["HAAI_ADMIN_TOKEN"];
}

function printCliError(err: unknown): void {
  if (err instanceof ApiHttpError) {
    if (err.status === 401) {
      console.error(chalk.red("✗ Not authenticated"));
      console.error(
        chalk.dim(
          "  Set HAAI_ADMIN_TOKEN in .env (or pass -t) to a valid haai-at-… token from Settings → Admin API tokens.",
        ),
      );
      return;
    }
    console.error(chalk.red(`✗ ${err.message}`));
    return;
  }
  if (err instanceof Error && /fetch failed|ECONNREFUSED/i.test(err.message + String(err.cause ?? ""))) {
    console.error(chalk.red("✗ Proxy is not reachable"));
    console.error(chalk.dim("  Is the proxy running? Try: pnpm haai status"));
    return;
  }
  console.error(err instanceof Error ? err.message : err);
}

async function main(): Promise<void> {
  loadHaaiDotenv();

  const args = process.argv.slice(2);
  const explicitUrl = explicitUrlFromArgs(args);
  const defaultUrl = await resolveDefaultProxyUrl({
    ...(explicitUrl ? { explicitUrl } : {}),
  });
  const completeIndex = args.indexOf("__complete");
  if (completeIndex >= 0 && args[completeIndex + 1]) {
    const baseUrl = defaultUrl;
    const client = createApiClient(baseUrl);
    const token = resolveAdminToken(args);
    if (token) client["opts"].token = token;
    await runDynamicComplete(args[completeIndex + 1]!, baseUrl, client);
    return;
  }

  const program = new Command();

  program
    .name("haai")
    .description("HAAI CLI — manage your LLM reverse proxy")
    .version("0.2.2")
    .option("-u, --url <url>", "Proxy URL (default: HAAI_URL, or auto-detect :4000/:4001)", defaultUrl)
    .option("-t, --token <token>", "Admin API token", process.env["HAAI_ADMIN_TOKEN"]);

  program.hook("preSubcommand", (thisCmd) => {
    const opts = thisCmd.opts() as { url: string; token?: string };
    const client = createApiClient(opts.url);
    if (opts.token) client["opts"].token = opts.token;
    thisCmd.setOptionValue("client", client);
  });

  // Status / health
  program
    .command("status")
    .description("Show proxy status")
    .action(async () => {
      const opts = program.opts() as { url: string };
      try {
        const res = await fetch(`${opts.url}/health`);
        const data = (await res.json()) as Record<string, unknown>;
        console.log(chalk.green("✓ Proxy is running"));
        console.log(`  URL:     ${opts.url}`);
        console.log(`  Status:  ${data["status"]}`);
        console.log(`  Version: ${data["version"]}`);
        console.log(`  Time:    ${data["timestamp"]}`);
      } catch {
        console.error(chalk.red("✗ Proxy is not reachable at"), opts.url);
        process.exit(1);
      }
    });

  // Register sub-command groups
  const getClient = () => {
    const opts = program.opts() as { url: string; token?: string };
    const client = createApiClient(opts.url);
    if (opts.token) client["opts"].token = opts.token;
    return client;
  };

  registerBackendCommands(program, getClient);
  registerVModelCommands(program, getClient);
  registerKeyCommands(program, getClient);
  registerHookCommands(program, getClient);
  registerPluginCommands(program, getClient);
  registerUserCommands(program);
  registerAdminTokenCommands(program, getClient);

  const getBaseUrl = () => (program.opts() as { url: string }).url;
  registerPromptCommands(program, getClient, getBaseUrl);
  registerCompletionCommands(program);

  // Config command
  program
    .command("config")
    .description("Show current configuration")
    .action(async () => {
      const opts = program.opts() as { url: string };
      console.log(chalk.bold("haai configuration"));
      console.log(`  Proxy URL: ${opts.url}`);
      console.log(`  Admin token: ${process.env["HAAI_ADMIN_TOKEN"] ? "set" : "not set"}`);
      console.log(`  API key:     ${process.env["HAAI_API_KEY"] ? "set" : "not set"}`);
    });

  await program.parseAsync();
}

main().catch((err) => {
  printCliError(err);
  process.exit(1);
});
