import type { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import type { ApiClient } from "../api-client.js";

interface VModel {
  id: string;
  modelId: string;
  displayName: string;
  balancingStrategy: string;
  /** Which inference endpoint this v-model may serve. Immutable once it has members. */
  kind: "chat" | "embedding";
  streaming: boolean;
  enabled: boolean;
  backends?: Array<{ backendId: string; backendModelId: string; weight: number }>;
}

export function registerVModelCommands(program: Command, getClient: () => ApiClient): void {
  const cmd = program.command("vmodel").description("Manage virtual models");

  cmd
    .command("list")
    .description("List all v-models")
    .action(async () => {
      const client = getClient();
      const vmodels = await client.get<VModel[]>("/api/v1/vmodels");
      if (vmodels.length === 0) {
        console.log(chalk.yellow("No virtual models configured."));
        return;
      }
      const data = [
        ["Model ID", "Display Name", "Kind", "Strategy", "Streaming", "Backends", "Enabled"],
        ...vmodels.map((v) => [
          v.modelId,
          v.displayName,
          v.kind ?? "chat",
          v.balancingStrategy,
          v.streaming ? "yes" : "no",
          String(v.backends?.length ?? 0),
          v.enabled ? chalk.green("yes") : chalk.red("no"),
        ]),
      ];
      console.log(table(data));
    });

  cmd
    .command("create")
    .description("Create a virtual model")
    .requiredOption("--model-id <id>", "Model ID alias (e.g. smart-chat)")
    .option("--display-name <name>", "Display name")
    .option("--strategy <strategy>", "Balancing strategy", "session-pin")
    .option(
      "--kind <kind>",
      "Routing class: 'chat' or 'embedding'. An embedding v-model is only reachable on /v1/embeddings.",
      "chat",
    )
    .option("--no-streaming", "Disable streaming (buffer for post hooks)")
    .action(async (opts) => {
      const client = getClient();
      const vm = await client.post<VModel>("/api/v1/vmodels", {
        modelId: opts.modelId,
        displayName: opts.displayName ?? opts.modelId,
        balancingStrategy: opts.strategy,
        kind: opts.kind,
        streaming: opts.streaming !== false,
      });
      console.log(chalk.green(`V-Model '${vm.modelId}' created (${vm.id})`));
    });

  cmd
    .command("delete <modelId>")
    .description("Delete a virtual model")
    .action(async (modelId) => {
      const client = getClient();
      const vmodels = await client.get<VModel[]>("/api/v1/vmodels");
      const vm = vmodels.find((v) => v.modelId === modelId || v.id === modelId);
      if (!vm) {
        console.error(chalk.red(`V-Model '${modelId}' not found`));
        process.exit(1);
      }
      await client.delete(`/api/v1/vmodels/${vm.id}`);
      console.log(chalk.green(`V-Model '${modelId}' deleted`));
    });

  cmd
    .command("add-backend <modelId>")
    .description(
      "Add a backend to a v-model. Rejected with an error if the backend model's kind " +
        "(chat vs. embedding) doesn't match the v-model's kind.",
    )
    .requiredOption("--backend-id <id>", "Backend ID")
    .requiredOption("--backend-model <model>", "Backend model ID")
    .option("--weight <weight>", "Weight", "1")
    .action(async (modelId, opts) => {
      const client = getClient();
      const vmodels = await client.get<VModel[]>("/api/v1/vmodels");
      const vm = vmodels.find((v) => v.modelId === modelId || v.id === modelId);
      if (!vm) {
        console.error(chalk.red(`V-Model '${modelId}' not found`));
        process.exit(1);
      }
      await client.post(`/api/v1/vmodels/${vm.id}/backends`, {
        backendId: opts.backendId,
        backendModelId: opts.backendModel,
        weight: parseInt(opts.weight, 10),
      });
      console.log(chalk.green("Backend added to v-model"));
    });
}
