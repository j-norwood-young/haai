#!/usr/bin/env node
/**
 * Builds the publishable `haai` npm package from the workspace.
 *
 * Steps:
 *  1. Sync packages/app/package.json (version + generated runtime deps).
 *  2. Build the workspace packages the bundle needs (@haai/core dist for
 *     module resolution, apps/web build for the admin UI).
 *  3. esbuild-bundle the four entry points into dist/. Only @haai/* workspace
 *     code is inlined; ALL third-party deps stay external so native modules
 *     are fetched per-platform by npm at install time.
 *  4. Copy static assets (openapi.yaml, web build) and verify the package.
 *
 * Run via: pnpm --filter haai package
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = join(appDir, "..", "..");
const distDir = join(appDir, "dist");
const webDir = join(appDir, "web");

const log = (msg) => console.log(`[build-package] ${msg}`);
const fail = (msg) => {
  console.error(`[build-package] ERROR: ${msg}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    fail(`${cmd} ${args.join(" ")} failed (exit ${res.status})${opts.hint ? `\n${opts.hint}` : ""}`);
  }
}

// ── 1. Sync manifest ──────────────────────────────────────────────────────────
log("Syncing packages/app/package.json (version + generated deps)");
run(process.execPath, [join(appDir, "scripts", "sync-package-deps.mjs")], { cwd: rootDir });

// ── 2. Build upstream workspace packages ─────────────────────────────────────
for (const pkg of ["@haai/core", "@haai/hooks-sdk", "@haai/plugin-sdk"]) {
  log(`Building ${pkg}`);
  run("pnpm", ["--filter", pkg, "run", "build"], { cwd: rootDir });
}
log("Building @haai/web (SvelteKit admin UI)");
run("pnpm", ["--filter", "@haai/web", "run", "build"], { cwd: rootDir });

// ── 3. esbuild bundles ────────────────────────────────────────────────────────
let esbuild;
try {
  esbuild = await import("esbuild").then((m) => m.default ?? m);
} catch {
  fail(
    "esbuild is not resolvable from packages/app. " +
      "The generated dependencies were likely just updated — run `pnpm install` in the repo root, then re-run.",
  );
}

const appPkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const declaredDeps = new Set(Object.keys(appPkg.dependencies ?? {}));
const externalized = new Set();

/**
 * Bundle only @haai/* workspace code + relative/absolute paths; externalize all
 * third-party deps (deep/subpath imports included) so they stay real npm deps.
 */
const externalizeThirdParty = {
  name: "externalize-third-party",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const path = args.path;
      if (path.startsWith(".") || path.startsWith("/")) return null; // default resolution
      if (path.startsWith("@haai/")) return null; // bundle workspace code
      externalized.add(path.split("/").slice(0, path.startsWith("@") ? 2 : 1).join("/"));
      return { path, external: true };
    });
  },
};

/** Shared esbuild options: node ESM, Node 22, everything third-party external. */
const baseOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  logLevel: "warning",
  absWorkingDir: rootDir,
  plugins: [externalizeThirdParty],
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const entries = [
  { src: "packages/proxy/src/index.ts", out: "dist/server.js", label: "server (@haai/proxy)" },
  { src: "packages/cli/src/index.ts", out: "dist/cli.js", label: "cli (@haai/cli)" },
  { src: "packages/mcp/src/index.ts", out: "dist/mcp.js", label: "mcp (@haai/mcp)" },
  { src: "packages/proxy/src/hooks/worker.ts", out: "dist/worker.js", label: "hooks worker" },
];

for (const entry of entries) {
  log(`Bundling ${entry.label} → ${entry.out}`);
  await esbuild.build({
    ...baseOptions,
    entryPoints: [entry.src],
    outfile: join(appDir, entry.out),
  });
}

// ── 4. Static assets ──────────────────────────────────────────────────────────
log("Copying openapi.yaml → dist/openapi.yaml");
cpSync(join(rootDir, "packages/proxy/src/openapi.yaml"), join(distDir, "openapi.yaml"));

log("Copying packages/core/migrations → dist/migrations");
cpSync(join(rootDir, "packages/core/migrations"), join(distDir, "migrations"), { recursive: true });

log("Copying apps/web/build → web/");
if (!existsSync(join(rootDir, "apps/web/build", "handler.js"))) {
  fail("apps/web/build/handler.js missing — @haai/web build did not produce the expected output");
}
rmSync(webDir, { recursive: true, force: true });
mkdirSync(webDir, { recursive: true });
cpSync(join(rootDir, "apps/web/build"), webDir, { recursive: true });

// ── 5. Verification ───────────────────────────────────────────────────────────
for (const rel of ["dist/server.js", "dist/cli.js", "dist/mcp.js", "dist/worker.js", "dist/openapi.yaml", "dist/migrations/meta/_journal.json"]) {
  if (!existsSync(join(appDir, rel))) fail(`Missing build artifact: ${rel}`);
}
for (const bin of ["bin/haai.js", "bin/haai-server.js", "bin/haai-mcp.js"]) {
  if (!existsSync(join(appDir, bin))) fail(`Missing bin shim: ${bin}`);
}

// Dynamic-import sites must survive bundling: the SvelteKit handler is loaded
// via a runtime file-path import (import(handler.js)) and the hooks worker via
// new URL("./worker.js", import.meta.url).
const serverBundle = readFileSync(join(distDir, "server.js"), "utf8");
if (!serverBundle.includes("handler.js")) {
  fail(`dist/server.js does not reference "handler.js" — the admin UI dynamic import was rewritten`);
}
if (!serverBundle.includes("./worker.js")) {
  // Not fatal: hooks/runtime.ts is not wired into request handling yet, so the
  // site may be tree-shaken. dist/worker.js is still emitted as its own entry.
  console.warn('[build-package] WARNING: "./worker.js" site not in bundle (hooks runtime tree-shaken)');
}

// Every externalized third-party import must be a declared runtime dependency.
const builtinCheck = (name) =>
  [
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
    "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
    "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events", "tty",
    "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
  ].includes(name.replace(/^node:/, ""));
const undeclared = [...externalized]
  .filter((name) => !declaredDeps.has(name))
  .filter((name) => !builtinCheck(name));
if (undeclared.length > 0) {
  console.warn(
    `[build-package] WARNING: externalized imports without a declared runtime dependency:\n` +
      undeclared.map((n) => `  - ${n} (add to a @haai/* manifest's dependencies)`).join("\n"),
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
const sizeOf = (p) => {
  const st = statSync(p);
  return st.isDirectory()
    ? `${(sumDir(p) / 1024 / 1024).toFixed(1)} MB`
    : `${(st.size / 1024).toFixed(0)} KB`;
};
function sumDir(p) {
  let total = 0;
  for (const name of readdirSync(p)) {
    const full = join(p, name);
    total += statSync(full).isDirectory() ? sumDir(full) : statSync(full).size;
  }
  return total;
}

log("Build complete:");
for (const rel of ["dist/server.js", "dist/cli.js", "dist/mcp.js", "dist/worker.js", "dist/openapi.yaml"]) {
  log(`  ${relative(rootDir, join(appDir, rel))}: ${sizeOf(join(appDir, rel))}`);
}
log(`  web/: ${sizeOf(webDir)} (${declaredDeps.size} runtime deps kept external)`);
