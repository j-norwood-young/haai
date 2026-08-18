import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import type { ApiClient } from "../api-client.js";

interface Plugin {
  id: string;
  name: string;
  source: string;
  version: string | null;
  enabled: boolean;
  needsResponseBuffer: boolean;
  configSchema: Record<string, unknown> | null;
  manifest: {
    name: string;
    description?: string;
    hooks: string[];
  };
}

interface Binding {
  id: string;
  pluginId: string;
  scopeType: string;
  scopeId: string | null;
  config: Record<string, unknown> | null;
  order: number;
  enabled: boolean;
}

export function registerPluginCommands(program: Command, getClient: () => ApiClient): void {
  const cmd = program.command("plugin").description("Manage plugins");

  // list
  cmd
    .command("list")
    .description("List all installed plugins")
    .action(async () => {
      const client = getClient();
      const plugins = await client.get<Plugin[]>("/api/v1/plugins");
      if (plugins.length === 0) {
        console.log(chalk.yellow("No plugins installed. Use `haai plugin install` to add one."));
        return;
      }
      const rows = [
        ["Name", "Version", "Source", "Hooks", "Buffer", "Enabled"],
        ...plugins.map((p) => [
          p.name,
          p.version ?? "-",
          p.source,
          p.manifest.hooks.join(", ") || "-",
          p.needsResponseBuffer ? chalk.cyan("yes") : "no",
          p.enabled ? chalk.green("yes") : chalk.red("no"),
        ]),
      ];
      console.log(table(rows));
    });

  // install
  cmd
    .command("install <source>")
    .description(
      'Install a plugin. Source formats:\n' +
      '  npm:@my-org/my-plugin      Install from npm\n' +
      '  npm:@my-org/my-plugin@1.0  Specific version\n' +
      '  github:owner/repo          Install from GitHub\n' +
      '  local:/path/to/plugin      Local directory',
    )
    .option("--name <name>", "Override plugin display name")
    .action(async (source: string, opts: { name?: string }) => {
      const client = getClient();
      console.log(chalk.cyan(`Installing plugin from ${source}...`));
      try {
        const plugin = await client.post<Plugin>("/api/v1/plugins", { source, name: opts.name });
        console.log(chalk.green(`✓ Plugin '${plugin.name}' installed (${plugin.id})`));
        console.log(`  Version: ${plugin.version ?? "unknown"}`);
        console.log(`  Hooks:   ${plugin.manifest.hooks.join(", ") || "none"}`);
        if (plugin.manifest.description) {
          console.log(`  Desc:    ${plugin.manifest.description}`);
        }
        console.log();
        console.log(chalk.yellow("Now bind it to a scope:"));
        console.log(`  haai plugin bind ${plugin.id} --scope global`);
        console.log(`  haai plugin bind ${plugin.id} --scope vmodel --scope-id <modelId>`);
        console.log(`  haai plugin bind ${plugin.id} --scope backend --scope-id <backendId>`);
      } catch (err) {
        console.error(chalk.red("Installation failed:"), err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // enable / disable
  cmd
    .command("enable <id>")
    .description("Enable a plugin")
    .action(async (id: string) => {
      const client = getClient();
      await client.patch(`/api/v1/plugins/${id}`, { enabled: true });
      console.log(chalk.green(`Plugin ${id} enabled`));
    });

  cmd
    .command("disable <id>")
    .description("Disable a plugin")
    .action(async (id: string) => {
      const client = getClient();
      await client.patch(`/api/v1/plugins/${id}`, { enabled: false });
      console.log(chalk.yellow(`Plugin ${id} disabled`));
    });

  // reinstall (update to latest)
  cmd
    .command("update <id>")
    .description("Reinstall a plugin to get the latest version")
    .action(async (id: string) => {
      const client = getClient();
      console.log(chalk.cyan(`Updating plugin ${id}...`));
      await client.post(`/api/v1/plugins/${id}/reinstall`, {});
      console.log(chalk.green(`Plugin ${id} updated`));
    });

  // remove
  cmd
    .command("remove <id>")
    .description("Uninstall a plugin and all its bindings")
    .action(async (id: string) => {
      const client = getClient();
      await client.delete(`/api/v1/plugins/${id}`);
      console.log(chalk.green(`Plugin ${id} removed`));
    });

  // bind
  cmd
    .command("bind <pluginId>")
    .description("Bind a plugin to a scope")
    .requiredOption("--scope <scope>", "global|vmodel|backend|key")
    .option("--scope-id <id>", "ID of the specific vmodel/backend/key (required for non-global)")
    .option("--config <json>", "JSON config for this binding")
    .option("--order <n>", "Execution order (lower = first)", "0")
    .action(async (pluginId: string, opts: { scope: string; scopeId?: string; config?: string; order: string }) => {
      const client = getClient();
      const config = opts.config ? (JSON.parse(opts.config) as Record<string, unknown>) : undefined;
      const binding = await client.post<Binding>(`/api/v1/plugins/${pluginId}/bindings`, {
        scopeType: opts.scope,
        scopeId: opts.scopeId ?? null,
        config: config ?? null,
        order: parseInt(opts.order, 10),
      });
      console.log(chalk.green(`✓ Binding created (${binding.id})`));
      console.log(`  Scope: ${binding.scopeType}${binding.scopeId ? `:${binding.scopeId}` : ""}`);
    });

  // bindings — list
  cmd
    .command("bindings <pluginId>")
    .description("List bindings for a plugin")
    .action(async (pluginId: string) => {
      const client = getClient();
      const bindings = await client.get<Binding[]>(`/api/v1/plugins/${pluginId}/bindings`);
      if (bindings.length === 0) {
        console.log(chalk.yellow("No bindings. Use `haai plugin bind` to attach this plugin to a scope."));
        return;
      }
      const rows = [
        ["Binding ID", "Scope", "Scope ID", "Order", "Enabled"],
        ...bindings.map((b) => [
          b.id,
          b.scopeType,
          b.scopeId ?? "(all)",
          String(b.order),
          b.enabled ? chalk.green("yes") : chalk.red("no"),
        ]),
      ];
      console.log(table(rows));
    });

  // unbind
  cmd
    .command("unbind <pluginId> <bindingId>")
    .description("Remove a plugin binding")
    .action(async (pluginId: string, bindingId: string) => {
      const client = getClient();
      await client.delete(`/api/v1/plugins/${pluginId}/bindings/${bindingId}`);
      console.log(chalk.green(`Binding ${bindingId} removed`));
    });

  // create — scaffold a new plugin
  cmd
    .command("create <name>")
    .description("Scaffold a new plugin in the current directory")
    .option("--dir <path>", "Directory to create the plugin in (default: ./<name>)")
    .action((name: string, opts: { dir?: string }) => {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const targetDir = resolve(opts.dir ?? `./${slug}`);

      if (existsSync(targetDir)) {
        console.error(chalk.red(`Directory already exists: ${targetDir}`));
        process.exit(1);
      }

      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, "src"));

      // package.json
      writeFileSync(
        join(targetDir, "package.json"),
        JSON.stringify({
          name: `@my-org/${slug}`,
          version: "1.0.0",
          description: `${name} plugin for haai`,
          type: "module",
          main: "dist/index.js",
          module: "dist/index.js",
          scripts: {
            build: "tsc -p tsconfig.json",
            dev: "tsc -p tsconfig.json --watch",
          },
          "haai-plugin": {
            name,
            description: `${name} plugin`,
            version: "1.0.0",
            needsResponseBuffer: false,
            hooks: ["onRequest"],
            configSchema: {
              enabled: {
                type: "boolean",
                label: "Enabled",
                default: true,
              },
            },
          },
          devDependencies: {
            "@haai/plugin-sdk": "^0.2.2",
            typescript: "^5.8.3",
            "@types/node": "^22.0.0",
          },
        }, null, 2),
      );

      // tsconfig.json
      writeFileSync(
        join(targetDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            declaration: true,
            outDir: "./dist",
            rootDir: "./src",
          },
          include: ["src/**/*"],
        }, null, 2),
      );

      // src/index.ts
      writeFileSync(
        join(targetDir, "src/index.ts"),
        `import { definePlugin, t, prependSystemPrompt } from "@haai/plugin-sdk";

export default definePlugin({
  name: ${JSON.stringify(name)},
  version: "1.0.0",
  description: ${JSON.stringify(`${name} plugin`)},
  config: {
    enabled: t.boolean({ label: "Enabled", default: true }),
  },
  needsResponseBuffer: false,
  hooks: {
    onRequest(request, ctx) {
      if (!ctx.config.enabled) return request;
      // Modify the request here
      return prependSystemPrompt(request, "Your system prompt addition here.");
    },
    // Uncomment to add response transform (set needsResponseBuffer: true in package.json):
    // onResponse(response, ctx) {
    //   ctx.log("info", "Got response", { model: response.model });
    //   return response;
    // },
  },
});
`,
      );

      // README.md
      writeFileSync(
        join(targetDir, "README.md"),
        `# ${name} Plugin

An haai plugin.

## Development

\`\`\`bash
npm install
npm run build
\`\`\`

## Install in haai

\`\`\`bash
# From the local directory:
haai plugin install local:${targetDir}

# After publishing to npm:
haai plugin install npm:@my-org/${slug}
\`\`\`

## Config

See \`package.json\` under the \`"haai-plugin".configSchema\` key for available config options.
`,
      );

      console.log(chalk.green(`\n✓ Plugin scaffolded at ${targetDir}`));
      console.log();
      console.log("Next steps:");
      console.log(`  cd ${targetDir}`);
      console.log("  npm install");
      console.log("  # Edit src/index.ts to implement your plugin");
      console.log("  npm run build");
      console.log(`  haai plugin install local:${targetDir}`);
      console.log();
      console.log("See the plugin authoring guide: docs/guide/plugin-authoring.md");
    });

  // info — show plugin details and config schema
  cmd
    .command("info <id>")
    .description("Show plugin details including config schema")
    .action(async (id: string) => {
      const client = getClient();
      const plugin = await client.get<Plugin & { bindings: Binding[] }>(`/api/v1/plugins/${id}`);
      console.log(chalk.bold(`\n${plugin.name}`));
      if (plugin.manifest.description) console.log(chalk.gray(plugin.manifest.description));
      console.log(`  ID:      ${plugin.id}`);
      console.log(`  Source:  ${plugin.source}`);
      console.log(`  Version: ${plugin.version ?? "unknown"}`);
      console.log(`  Hooks:   ${plugin.manifest.hooks.join(", ")}`);
      console.log(`  Buffer:  ${plugin.needsResponseBuffer ? "yes" : "no"}`);
      console.log(`  Enabled: ${plugin.enabled ? chalk.green("yes") : chalk.red("no")}`);

      if (plugin.configSchema && Object.keys(plugin.configSchema).length > 0) {
        console.log(chalk.bold("\nConfig schema:"));
        for (const [key, field] of Object.entries(plugin.configSchema)) {
          const f = field as Record<string, unknown>;
          const required = f["required"] ? chalk.red(" (required)") : "";
          const def = "default" in f ? chalk.gray(` [default: ${JSON.stringify(f["default"])}]`) : "";
          console.log(`  ${chalk.cyan(key)} (${f["type"]})${required}${def}`);
          if (f["label"]) console.log(`    ${f["label"]}`);
          if (f["description"]) console.log(`    ${chalk.gray(f["description"] as string)}`);
        }
      }

      if (plugin.bindings.length > 0) {
        console.log(chalk.bold("\nBindings:"));
        for (const b of plugin.bindings) {
          const scope = b.scopeId ? `${b.scopeType}:${b.scopeId}` : b.scopeType;
          console.log(`  [${b.id}] ${scope} — order ${b.order} — ${b.enabled ? chalk.green("enabled") : chalk.red("disabled")}`);
        }
      }
      console.log();
    });
}
