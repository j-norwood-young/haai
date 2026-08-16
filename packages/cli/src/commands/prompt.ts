import type { Command } from "commander";
import chalk from "chalk";
import { stdin } from "node:process";
import type { ApiClient } from "../api-client.js";
import { readApiKeyFromEnv, resolveApiKey, sendPrompt } from "../inference.js";

async function readStdinMessage(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function registerPromptCommands(
  program: Command,
  getClient: () => ApiClient,
  getBaseUrl: () => string,
): void {
  program
    .command("prompt [message...]")
    .description("Send a prompt to a model and stream the response")
    .option("-m, --model <model>", "Virtual model alias or backend model ID")
    .option("-k, --key <key>", "API key (full haai-sk-… or prefix)", readApiKeyFromEnv())
    .option("--no-stream", "Wait for the full response instead of streaming")
    .option("-s, --system <prompt>", "Optional system message")
    .action(async (messageParts: string[], opts: { model?: string; key?: string; stream: boolean; system?: string }) => {
      const baseUrl = getBaseUrl();

      if (!opts.model) {
        console.error(chalk.red("Missing --model (-m). Choose a v-model or backend model ID."));
        process.exit(1);
      }

      if (!opts.key) {
        console.error(
          chalk.red("Missing --key (-k). Pass an API key or set HAAI_API_KEY."),
        );
        process.exit(1);
      }

      let message = messageParts.join(" ").trim();
      if (!message && !stdin.isTTY) {
        message = await readStdinMessage();
      }
      if (!message) {
        console.error(chalk.red("Provide a message argument or pipe prompt text on stdin."));
        process.exit(1);
      }

      let apiKey: string;
      try {
        apiKey = await resolveApiKey(opts.key, getClient());
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: message });

      try {
        await sendPrompt({
          baseUrl,
          apiKey,
          model: opts.model,
          messages,
          stream: opts.stream,
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
