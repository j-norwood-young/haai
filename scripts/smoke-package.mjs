#!/usr/bin/env node
/**
 * End-to-end smoke test for the packaged `@jasony/haai` npm package.
 *
 * Prerequisites: `npm pack` in packages/app (tarball present), then this script
 * installs the tarball globally and exercises the real installed bins:
 *
 *   node scripts/smoke-package.mjs [--port 4100] [--tarball <path>]
 *
 * Optional: set HAAI_SMOKE_PLUGIN_DIR to a local plugin directory to also run
 * the `haai plugin install` leg (CI enables it on Linux only).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORT = Number(argValue("--port") ?? process.env["HAAI_SMOKE_PORT"] ?? 4100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PLUGIN_DIR = process.env["HAAI_SMOKE_PLUGIN_DIR"]
  ? resolve(process.env["HAAI_SMOKE_PLUGIN_DIR"])
  : undefined;
const IS_WIN = process.platform === "win32";
const REPO_ROOT = resolve(import.meta.dirname, "..");

const stepResults = [];
const serverLogs = [];

function step(name, fn) {
  return (async () => {
    process.stdout.write(`▸ ${name} ... `);
    try {
      await fn();
      console.log("ok");
      stepResults.push({ name, ok: true });
    } catch (err) {
      console.log("FAIL");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      stepResults.push({ name, ok: false });
      throw err;
    }
  })();
}
function runBin(bin, binArgs, env = {}, opts = {}) {
  const res = spawnSync(bin, binArgs, {
    env: { ...process.env, ...env },
    cwd: opts.cwd,
    encoding: "utf8",
    shell: IS_WIN,
    timeout: opts.timeoutMs ?? 60_000,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchOk(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res;
}

async function pollHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) });
      if (res.ok) return (await res.json());
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function isHealthy() {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

async function waitUntilDown(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isHealthy())) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function findTarball() {
  const explicit = argValue("--tarball");
  if (explicit) return resolve(explicit);
  const appDir = join(REPO_ROOT, "packages/app");
  const tarballs = readdirSync(appDir).filter((f) => /^(?:jasony-)?haai-\d.*\.tgz$/.test(f));
  if (tarballs.length === 0) {
    console.error("No haai-*.tgz found in packages/app — run `npm pack` there first.");
    process.exit(1);
  }
  return join(appDir, tarballs[tarballs.length - 1]);
}

function stopServer(child) {
  if (IS_WIN) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
    return Promise.resolve();
  }
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 15_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.kill("SIGTERM");
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const tarball = findTarball();
const expectedVersion = /haai-(\d+\.\d+\.\d+.*)\.tgz$/.exec(tarball)?.[1];
const dataDir = mkdtempSync(join(tmpdir(), "haai-smoke-data-"));
const skipInstall = args.includes("--skip-install");
let server;

try {
  if (skipInstall) {
    console.log("▸ install tarball globally ... skipped (--skip-install)");
  } else {
    await step("install tarball globally", () => {
      const res = runBin("npm", ["install", "--global", tarball], {}, { timeoutMs: 300_000 });
      assert(res.status === 0, `npm install -g failed:\n${res.stdout}\n${res.stderr}`);
    });
  }

  await step("haai --version reports packaged version", () => {
    const res = runBin("haai", ["--version"]);
    assert(res.status === 0, `haai --version failed:\n${res.stderr}`);
    assert(
      !expectedVersion || res.stdout.trim().startsWith(expectedVersion.split("-")[0]),
      `version mismatch: expected ${expectedVersion}, got "${res.stdout.trim()}"`,
    );
  });

  await step("boot haai-server", () => {
    server = spawn("haai-server", [], {
      // cwd: a clean dir with no .env that could override the smoke config
      cwd: dataDir,
      env: { ...process.env, HAAI_PORT: String(PORT), HAAI_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WIN,
    });
    server.stdout.on("data", (d) => serverLogs.push(String(d)));
    server.stderr.on("data", (d) => serverLogs.push(String(d)));
    assert(!server.killed, "failed to spawn haai-server");
  });

  await step("GET /health returns 200 with version", async () => {
    const body = await pollHealth();
    assert(body.status === "ok", `unexpected /health body: ${JSON.stringify(body)}`);
  });

  await step("GET / serves admin UI", async () => {
    const res = await fetchOk("/");
    assert(res.status === 200, `GET / returned ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    assert(type.includes("text/html"), `GET / content-type was ${type}`);
  });

  await step("GET /api/docs serves OpenAPI UI", async () => {
    const res = await fetchOk("/api/docs", { redirect: "manual" });
    assert(
      res.status === 200 || (res.status >= 300 && res.status < 400),
      `GET /api/docs returned ${res.status}`,
    );
  });

  let sessionCookie;
  let adminToken;
  await step("login as default admin + change password", async () => {
    const login = await fetchOk("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    assert(login.status === 200, `login returned ${login.status}`);
    sessionCookie = login.headers
      .getSetCookie()
      .find((c) => c.startsWith("haai_session="));
    assert(sessionCookie, "no haai_session cookie set on login");

    const change = await fetchOk("/api/v1/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ currentPassword: "admin", newPassword: "smoke-test-pass-123" }),
    });
    assert(change.status === 200, `change-password returned ${change.status}: ${await change.text()}`);
  });

  await step("mint admin API token", async () => {
    const res = await fetchOk("/api/v1/admin-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: "smoke-test" }),
    });
    assert(res.status === 201 || res.status === 200, `admin-tokens returned ${res.status}`);
    const body = await res.json();
    adminToken = body.token;
    assert(typeof adminToken === "string" && adminToken.length > 0, "no token in response");
  });

  const cliEnv = { HAAI_URL: BASE_URL, HAAI_ADMIN_TOKEN: adminToken };
  await step("haai status", () => {
    const res = runBin("haai", ["-u", BASE_URL, "status"], cliEnv, { cwd: dataDir });
    assert(res.status === 0, `haai status failed:\n${res.stdout}\n${res.stderr}`);
    assert(res.stdout.includes("Proxy is running"), `unexpected output: ${res.stdout}`);
  });

  const vmodelName = "smoke-vmodel";
  await step("haai vmodel create", () => {
    const res = runBin(
      "haai",
      ["-u", BASE_URL, "vmodel", "create", "--model-id", vmodelName, "--display-name", "Smoke Test"],
      cliEnv,
      { cwd: dataDir },
    );
    assert(res.status === 0, `vmodel create failed:\n${res.stdout}\n${res.stderr}`);
  });

  await step("haai vmodel list shows created v-model", () => {
    const res = runBin("haai", ["-u", BASE_URL, "vmodel", "list"], cliEnv, { cwd: dataDir });
    assert(res.status === 0, `vmodel list failed:\n${res.stdout}\n${res.stderr}`);
    assert(res.stdout.includes(vmodelName), `vmodel ${vmodelName} not in list:\n${res.stdout}`);
  });

  if (PLUGIN_DIR) {
    await step(`haai plugin install local:${PLUGIN_DIR}`, () => {
      assert(existsSync(PLUGIN_DIR), `plugin dir missing: ${PLUGIN_DIR}`);
      const res = runBin(
        "haai",
        ["-u", BASE_URL, "plugin", "install", `local:${PLUGIN_DIR}`],
        cliEnv,
        { cwd: dataDir, timeoutMs: 180_000 },
      );
      assert(res.status === 0, `plugin install failed:\n${res.stdout}\n${res.stderr}`);
    });
  } else {
    console.log("▸ plugin install leg skipped (set HAAI_SMOKE_PLUGIN_DIR to enable)");
  }

  await step("SIGTERM shuts server down cleanly", async () => {
    await stopServer(server);
    if (!IS_WIN) {
      assert(server.exitCode === 0, `server exited with code ${server.exitCode} (expected 0)`);
    }
  });

  // `haai serve` daemonizes by default; exercise the detach → healthy → `haai stop` round trip
  // (the piece most likely to differ per OS: detached spawn, PID file, signalling).
  await step("haai serve daemonizes and haai stop stops it", async () => {
    assert(await waitUntilDown(), "port still busy after stopping the server");
    const env = { HAAI_DATA_DIR: dataDir };
    const started = runBin(
      "haai",
      ["serve", "--no-open", "--port", String(PORT)],
      env,
      { cwd: dataDir, timeoutMs: 120_000 },
    );
    assert(started.status === 0, `haai serve failed:\n${started.stdout}\n${started.stderr}`);
    assert(await isHealthy(), "server not healthy after `haai serve` returned");
    assert(existsSync(join(dataDir, "haai.pid")), "haai.pid not written");

    const again = runBin("haai", ["serve", "--no-open", "--port", String(PORT)], env, { cwd: dataDir });
    assert(
      again.status === 0 && /already running/i.test(again.stdout),
      `second serve should report already running:\n${again.stdout}\n${again.stderr}`,
    );

    const stopped = runBin("haai", ["stop"], env, { cwd: dataDir });
    assert(stopped.status === 0, `haai stop failed:\n${stopped.stdout}\n${stopped.stderr}`);
    assert(await waitUntilDown(), "server still answering after `haai stop`");
    assert(!existsSync(join(dataDir, "haai.pid")), "haai.pid not removed by `haai stop`");
  });

  console.log(`\nSmoke test PASSED (${stepResults.filter((r) => r.ok).length} checks)`);
} catch {
  console.log(`\nSmoke test FAILED — server logs (tail):`);
  console.log(serverLogs.slice(-40).join(""));
  const daemonLog = join(dataDir, "logs", "haai.log");
  if (existsSync(daemonLog)) {
    console.log(`\nDaemon log (tail):`);
    console.log(readFileSync(daemonLog, "utf8").split("\n").slice(-40).join("\n"));
  }
  if (server && server.exitCode === null && !IS_WIN) server.kill("SIGKILL");
  process.exitCode = 1;
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
