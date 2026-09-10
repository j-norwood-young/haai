#!/usr/bin/env node
/**
 * Generates `packages/app/package.json` runtime metadata from the workspace:
 *
 * - `dependencies`: union of the runtime dependencies of @haai/{core,proxy,cli,mcp}
 *   (workspace-internal `@haai/*` deps are excluded — they get bundled by esbuild).
 *   Conflicting version ranges for the same package are a hard error so drift
 *   between workspace manifests is surfaced instead of silently resolved.
 * - `version`: synced from the monorepo root package.json.
 *
 * Idempotent: only rewrites the file when content actually changes, so CI
 * lockfiles stay valid.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = join(appDir, "..", "..");

/** Workspace packages whose runtime deps make up the published dependency set. */
const SOURCE_PACKAGES = [
  "@haai/core",
  "@haai/proxy",
  "@haai/cli",
  "@haai/mcp",
].map((name) => join(rootDir, "packages", name.replace("@haai/", "")));

const pkgNameOf = (manifest) => manifest.name;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const rootPkg = readJson(join(rootDir, "package.json"));

/** @type {Map<string, {spec: string, sources: string[]}>} */
const merged = new Map();
for (const dir of SOURCE_PACKAGES) {
  const manifest = readJson(join(dir, "package.json"));
  for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (dep.startsWith("@haai/")) continue; // bundled, not a runtime dep
    const existing = merged.get(dep);
    if (!existing) {
      merged.set(dep, { spec, sources: [pkgNameOf(manifest)] });
    } else if (existing.spec !== spec) {
      console.error(
        `[sync-deps] Conflicting version range for ${dep}:\n` +
          `  ${pkgNameOf(manifest)}: ${spec}\n` +
          `  ${existing.sources.join(", ")}: ${existing.spec}\n` +
          `Align the range across workspace manifests, then re-run.`,
      );
      process.exit(1);
    } else {
      existing.sources.push(pkgNameOf(manifest));
    }
  }
}

const dependencies = Object.fromEntries(
  [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dep, { spec }]) => [dep, spec]),
);

const appPkgPath = join(appDir, "package.json");
const current = readJson(appPkgPath);
const next = {
  ...current,
  version: rootPkg.version,
  dependencies,
};

const serialized = `${JSON.stringify(next, null, 2)}\n`;
const currentSerialized = `${JSON.stringify(current, null, 2)}\n`;
if (serialized !== currentSerialized) {
  writeFileSync(appPkgPath, serialized);
  const depCount = Object.keys(dependencies).length;
  console.log(
    `[sync-deps] packages/app/package.json updated (version ${next.version}, ${depCount} runtime deps). ` +
      "Run `pnpm install` to refresh the lockfile if dependencies changed.",
  );
} else {
  console.log(`[sync-deps] packages/app/package.json up to date (version ${next.version}).`);
}
