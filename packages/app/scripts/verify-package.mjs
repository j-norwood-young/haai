#!/usr/bin/env node
/** Prepack guard: refuses to pack/publish an unbuilt or incomplete package. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "dist/server.js",
  "dist/cli.js",
  "dist/mcp.js",
  "dist/worker.js",
  "dist/openapi.yaml",
  "dist/migrations/meta/_journal.json",
  "web/handler.js",
  "bin/haai.js",
  "bin/haai-server.js",
  "bin/haai-mcp.js",
  "README.md",
];

const missing = required.filter((rel) => !existsSync(join(appDir, rel)));
if (missing.length > 0) {
  console.error(
    `[verify-package] Refusing to pack: built artifacts missing:\n` +
      missing.map((rel) => `  - ${rel}`).join("\n") +
      `\nRun \`pnpm --filter @jasony/haai package\` first.`,
  );
  process.exit(1);
}
console.log("[verify-package] All package artifacts present.");
