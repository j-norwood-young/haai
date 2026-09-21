import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** An example plugin found in the repo's `examples/plugins/` directory */
export interface ExamplePlugin {
  /** Directory name, e.g. "talk-like-a-pirate" */
  id: string;
  name: string;
  description: string | null;
  version: string | null;
  hooks: string[];
  /** Installer source string, e.g. "local:/abs/path/to/examples/plugins/talk-like-a-pirate" */
  source: string;
  /** False until the example has been compiled (`pnpm build`) — the installer bundles from its dist output */
  built: boolean;
}

/**
 * Locate `examples/plugins/` by walking up from this module. Works from both `src/` (tsx) and
 * `dist/`; returns null for installed packages, which don't ship the examples.
 */
export function findExamplesDir(startDir = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "examples", "plugins");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function listExamplePlugins(examplesDir: string | null = findExamplesDir()): ExamplePlugin[] {
  if (!examplesDir) return [];

  const examples: ExamplePlugin[] = [];
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = resolve(examplesDir, entry.name);
    const pkgPath = join(packageDir, "package.json");
    if (!existsSync(pkgPath)) continue;

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const manifest = pkg["haai-plugin"] as
      | { name?: string; description?: string; version?: string; hooks?: string[] }
      | undefined;
    if (!manifest) continue;

    const mainField = (pkg["module"] ?? pkg["main"] ?? "index.js") as string;
    examples.push({
      id: entry.name,
      name: manifest.name ?? (pkg["name"] as string | undefined) ?? entry.name,
      description: manifest.description ?? (pkg["description"] as string | undefined) ?? null,
      version: manifest.version ?? (pkg["version"] as string | undefined) ?? null,
      hooks: manifest.hooks ?? [],
      source: `local:${packageDir}`,
      built: existsSync(join(packageDir, mainField)),
    });
  }

  return examples.sort((a, b) => a.name.localeCompare(b.name));
}
