# Plan: Publish HAAI as the `haai` npm package

## Goal

Ship HAAI as a single npm package named **`haai`** so a home user on macOS, Linux, or Windows with Node ≥ 22 can run:

```bash
npx haai serve        # boot server + admin UI, open browser
npm i -g haai         # alternative: global install
```

The package contains the full product: streaming proxy + OpenAI-compatible API + SvelteKit admin web UI + CLI + MCP server. Docker remains a supported install path; the Tauri/Homebrew phases come later and build on this work.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Package name | `haai` (unscoped; verified unclaimed on registry) |
| Shape | Single non-private workspace package `packages/app` |
| Mechanics | esbuild bundles **only** the six `@haai/*` workspace packages; **all** third-party deps (incl. native modules) stay real npm `dependencies`, so binaries are fetched per-user-platform at install time. Do **not** ship an installed `node_modules` (npm strips it; `bundleDependencies` would embed the CI machine's linux-x64 `better-sqlite3` binary and break macOS/Windows). |
| Bins | `haai` (CLI + `serve` sugar), `haai-server` (proxy), `haai-mcp` (MCP) |
| Excluded | Ink TUI (not in Docker image today), VitePress docs bundle (hosted online) — both match Docker parity; absence is already graceful (`docs-site.ts:23`) |
| Release | Tag-driven: push `v*` → GitHub Actions build + cross-OS smoke matrix → `npm publish --provenance` via npm trusted publishing (OIDC) |
| Node support | `engines.node: ">=22"`; smoke-test on 22 and 24 |

## Published package layout

```
haai/
  package.json      # name "haai", bin × 3, engines >=22, deps = union of runtime deps of @haai/{core,proxy,cli,mcp}
  bin/
    haai.js         # Node-version check; `serve` dispatch; otherwise imports dist/cli.js
    haai-server.js  # imports ../dist/server.js
    haai-mcp.js     # imports ../dist/mcp.js
  dist/
    cli.js          # bundled @haai/cli
    server.js       # bundled @haai/proxy
    mcp.js          # bundled @haai/mcp
    worker.js       # hooks worker (runtime-loaded via new URL("./worker.js", import.meta.url))
    openapi.yaml
  web/              # copy of apps/web/build (SvelteKit adapter-node output)
  README.md
```

Why this works: every runtime file lookup in the codebase already resolves from `import.meta.url` (openapi.ts:7 → first candidate `dist/openapi.yaml`; hooks/runtime.ts:86 → `dist/worker.js`; plugins/installer.ts:10). The SvelteKit UI loads via runtime file-path dynamic import (`web-ui.ts:47`) and ships as files in `web/`, not as an import.

## Tasks (ordered)

### 1. npm account & trusted publishing setup (at first release)
Per your decision, the `haai` name is **not** pre-registered during development — it is claimed by the first `npm publish`. Before that first release: create/verify the npm account with 2FA, then configure **npm trusted publishing** on npmjs.com (link GitHub repo `j-norwood-young/haai`, workflow `release.yml`) — no long-lived NPM_TOKEN needed. Immediately before releasing, re-check registry availability (`npm view haai`) since the name is unclaimed until publish (see Risks).

### 2. Create `packages/app` (new workspace package, name `haai`)
- `package.json`: `private: false`, `type: module`, `version` (sync with root, currently 0.2.3), `engines: { node: ">=22" }`, three `bin` entries, `files: ["bin", "dist", "web", "README.md"]`.
- `dependencies`: **generated, not hand-maintained** — a small sync script merges the runtime `dependencies` of `@haai/core`, `@haai/proxy`, `@haai/cli`, `@haai/mcp` (union, respecting version ranges) into `packages/app/package.json` as part of the build. This prevents drift when proxy deps change. Native deps (`better-sqlite3`, `isolated-vm`, `@node-rs/argon2`, `esbuild`) arrive this way as ordinary deps.
- Build script (Node, run via pnpm script):
  1. Run the dep-sync script.
  2. `pnpm --filter @haai/web build` (and core/proxy/cli/mcp builds via turbo) so `apps/web/build` and package `dist/` outputs exist.
  3. esbuild: three entries (`packages/proxy/src/index.ts` → `dist/server.js`, `packages/cli/src/index.ts` → `dist/cli.js`, `packages/mcp/src/index.ts` → `dist/mcp.js`); `platform=node`, `format=esm`, `target=node22`, `bundle=true`; **external = every third-party dep from the merged list** (workspace `@haai/*` imports get inlined). Keep `openapi.yaml` as an external file (do not let a plugin inline it).
  4. esbuild second pass or copy: `packages/proxy/src/hooks/worker.ts` → `dist/worker.js` (external-file emit, same externals).
  5. Copy `src/openapi.yaml` → `dist/openapi.yaml`; copy `apps/web/build/*` → `web/`.
  6. Write `bin/*.js` shims.
- esbuild loader: any `import(pathVariable)` dynamic imports (SvelteKit handler, plugin bundles) are left untouched by esbuild — verify with a grep of the bundle for `apps/web/build` and confirm no bundler warnings about unresolvable dynamic paths.

### 3. Bin shim: `bin/haai.js` (the UX-critical piece)
- Node version check: parse `process.versions.node`; if < 22, print friendly error with install link and exit non-zero (npm only *warns* on `engines` mismatch — this is the hard gate).
- If `process.argv[2] === "serve"`:
  - Spawn `process.execPath dist/server.js` with `stdio: "inherit"`, passing through remaining args/env (`HAAI_PORT`, `HAAI_HOST`, etc.).
  - Forward `SIGINT`/`SIGTERM`; exit with child's code.
  - Best-effort open `http://localhost:4000` in the default browser once `/health` responds (platform `open`/`xdg-open` via `child_process`, wrapped in try/catch; skip when `!process.stdout.isTTY` or `CI` set; `--no-open` flag to disable).
  - If port already in use, print "HAAI already running at http://localhost:4000" and just open the browser (no crash).
- Else: `await import("../dist/cli.js")` (CLI handles its own argv).
- `bin/haai-server.js` and `bin/haai-mcp.js` are 3-line shims.

### 4. Small source fixes (workspace packages)
- `packages/proxy/src/web-ui.ts:19` `resolveWebBuildDir()`: add a first candidate `join(dirname(fileURLToPath(import.meta.url)), "web")` (before `HAAI_WEB_DIR` env override? No — env override stays first, bundled path second, cwd candidates last). In the repo build this path doesn't exist → falls through; in the published package it finds `web/`.
- `packages/cli/src/index.ts:74`: replace hardcoded `.version("0.2.2")` with version read from its own `package.json` via `createRequire(import.meta.url)`.

### 5. CI: cross-platform smoke matrix (`.github/workflows/ci.yml`)
New `package-smoke` job, matrix: os `[ubuntu-latest, macos-14, macos-13, windows-latest]` × node `[22, 24]`:
1. Checkout, pnpm, node setup; `pnpm install --frozen-lockfile`; `pnpm build`; build `packages/app`.
2. `npm pack` in `packages/app` → tarball.
3. `npm i -g ./haai-<ver>.tgz`.
4. Boot `haai-server` on a test port (env `HAAI_PORT=4100`); poll `/health` until 200; `curl` an admin-UI asset from `/`; run `haai status`; `haai vmodel create` + `haai vmodel list` round-trip; SIGTERM; assert clean exit.
5. Linux only: `haai plugin install` one example plugin from `examples/plugins/` to prove the npm-based installer works in the packaged layout.
This job is the gate that catches native-prebuild gaps (the `isolated-vm` watch-item) before publish.

### 6. Release workflow (`.github/workflows/release.yml`)
- `on: push: tags: ["v*"]`.
- Steps: build → run the same smoke matrix → `npm version` from tag into `packages/app/package.json` (or read tag and pass `--no-git-tag-version`) → `npm publish --provenance` (workflow needs `permissions: { id-token: write }`; trusted publishing per task 1).- On smoke failure: no publish.
- Optional same-tag Docker image build can hook in later (out of scope here).

### 7. Docs
- `README.md`: add an "Install" section above Docker — `npx haai serve` as the one-liner quickstart, `npm i -g haai` alternative, requirement "Node.js 22+", note data lives in `~/.haai` (`%USERPROFILE%\.haai` on Windows).
- `docs/guide/`: new `installation.md` covering npm/npx per-OS, config via env/`~/.haai/config.yaml`, and a "which install method" table (npx vs Docker vs build-from-source). Update `docs/guide/quickstart.md` links.
- Note for pnpm users: pnpm blocks install scripts by default — document `pnpm approve-builds` for `better-sqlite3`/`isolated-vm`/`esbuild`.

## Risks / watch-items
- **`isolated-vm` prebuild coverage** for exotic OS×ABI combos → fallback is source compile (needs toolchain); smoke matrix catches gaps; worst case document "use Node LTS".
- **esbuild + ESM bundling** of Fastify plugins/dynamic requires — mitigated by keeping ALL third-party code external; only plain tsc-compiled workspace code is inlined.
- **Worker/asset path drift** (`dist/worker.js`, `dist/openapi.yaml`, `web/`) — assert these files exist as a post-build check in the build script; smoke job exercises each (UI asset fetch, hooks via plugin install path, `/api/docs`).
- **Plugin installer** shells out to `npm install --prefix` (`plugins/installer.ts:58`) — works wherever npm/Node exist (all our paths); a registry-tarball rewrite to drop the npm dependency is a future improvement, not v1.
- **Name squatting** — `haai` is unclaimed today but stays claimable by third parties until the first publish (accepted trade-off per your decision). Mitigation: run `npm view haai` right before the first release; if taken, fall back to a scoped name (e.g. `@haai/haai`) and update bins/docs accordingly.

## Validation plan
1. Local: full build → `npm pack` → install into a clean prefix → boot on port 4100 → `/health` 200 → admin UI asset 200 → `/api/docs` 200 → CLI vmodel CRUD round-trip → plugin install from examples → mock chat completion through a v-model.
2. Repeat inside a Windows container / clean macOS VM if available before first publish.
3. CI smoke matrix green on all 8 combos (4 OS × 2 Node).
4. Post-publish: `npx haai@latest serve` on a clean machine; verify admin login flow and that `~/.haai` is created.

## Out of scope (later phases)
Homebrew formula/tap (wraps this package), Tauri/Electron desktop shell (needs a self-contained server story), native Tailscale integration, plugin installer rewrite, npm auto-update beyond `npm i -g haai@latest`.
