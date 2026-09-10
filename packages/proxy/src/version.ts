import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
function require(module: string): unknown {
  return _require(module);
}

/**
 * Package version, resolved from package.json at runtime.
 * Works in repo builds (packages/proxy/package.json) and in the published
 * npm bundle (resolves the `haai` package root next to dist/).
 */
export const VERSION: string = (require("../package.json") as { version: string }).version;
