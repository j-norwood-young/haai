import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { defaultDataDir, ensureDataDir, loadConfig } from "@haai/core/config";

/**
 * `haai serve` — boots the packaged server (dist/server.js, sibling of the
 * CLI bundle) in the background and, once it answers /health, best-effort
 * opens the admin UI. `--no-daemon` keeps it attached to the terminal instead.
 * `haai stop` stops a background instance started by `haai serve`.
 */
export const serveCommand = "serve";
export const serveDescriptor =
  "Start the HAAI server in the background (default port 4000) and open the admin UI";
export const stopCommand = "stop";
export const stopDescriptor = "Stop the background HAAI server started by `haai serve`";

export interface ServeOptions {
  /** Listen port (default: $HAAI_PORT or 4000) */
  port?: string;
  /** Listen host/address (default: $HAAI_HOST or 0.0.0.0) */
  host?: string;
  /** Open the browser (commander's `--no-open` sets this to false) */
  open?: boolean;
  /** Run in the background (commander's `--no-daemon` sets this to false) */
  daemon?: boolean;
}

export interface StopOptions {
  /** SIGKILL instead of SIGTERM, and skip the "is it really HAAI?" health check */
  force?: boolean;
}

const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;

interface DaemonInfo {
  pid: number;
  port: number;
  host?: string;
  startedAt: string;
}

function hasBundledServer(): boolean {
  return existsSync(new URL("./server.js", import.meta.url));
}

// fileURLToPath, not URL.pathname: the latter is `/C:/…` on Windows.
function serverScriptPath(): string {
  return fileURLToPath(new URL("./server.js", import.meta.url));
}

// `loadConfig` would also work out the data dir, but `stop` shouldn't fail on
// an invalid config.yaml, so both commands resolve it the way loadConfig does.
function resolveDataDir(): string {
  return process.env["HAAI_DATA_DIR"] ?? defaultDataDir();
}

function pidFilePath(dataDir: string): string {
  return join(dataDir, "haai.pid");
}

function logFilePath(dataDir: string): string {
  return join(dataDir, "logs", "haai.log");
}

export async function serve(opts: ServeOptions): Promise<void> {
  if (!hasBundledServer()) {
    console.error(
      chalk.red(
        "The server is not available in this build (this copy of the CLI has no bundled dist/server.js).",
      ),
    );
    console.error(
      "Run `pnpm dev` for the development server, or install the published package: npm i -g @jasony/haai",
    );
    process.exit(1);
    return;
  }

  // Flags win over env/config; the server child inherits process.env.
  if (opts.port !== undefined) process.env["HAAI_PORT"] = String(Number(opts.port) || 4000);
  if (opts.host !== undefined) process.env["HAAI_HOST"] = opts.host;

  // Resolve the effective listen address (flags > env > config.yaml > defaults)
  // so health polling and "already running" detection target the right port.
  let port: number;
  let host: string;
  try {
    ({ port, host } = loadConfig().server);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
    return;
  }

  const noOpen = opts.open === false;
  if (opts.daemon === false) {
    serveForeground(port, host, noOpen);
    return;
  }
  await serveDaemon(port, host, noOpen);
}

// ---------------------------------------------------------------------------
// Foreground (--no-daemon)
// ---------------------------------------------------------------------------

function serveForeground(port: number, host: string, noOpen: boolean): void {
  const child: ChildProcess = spawn(process.execPath, [serverScriptPath()], {
    stdio: "inherit",
  });

  let exited = false;
  child.on("exit", (code, signal) => {
    exited = true;
    void onServerExit(code, signal, port, host, noOpen);
  });
  const forward = (signalName: NodeJS.Signals) => {
    if (!exited) child.kill(signalName);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  void pollHealth(port, host, START_TIMEOUT_MS).then((cameUp) => {
    if (!exited && cameUp && shouldOpenBrowser(noOpen)) {
      const url = `http://localhost:${port}`;
      console.log(`Opening admin UI at ${url} (pass --no-open to skip)`);
      openBrowser(url);
    }
  });
}

async function onServerExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  port: number,
  host: string | undefined,
  noOpen: boolean,
): Promise<void> {
  if (code === 0 || signal) {
    process.exit(0);
    return;
  }
  // Non-zero exit right after start usually means the port is taken by an
  // already-running instance — detect that and just open the UI instead of
  // crashing the user's shell.
  const responds = await pollHealth(port, host, 2_500);
  if (responds) {
    console.log(`HAAI is already running at http://localhost:${port}`);
    if (shouldOpenBrowser(noOpen)) openBrowser(`http://localhost:${port}`);
    process.exit(0);
  }
  process.exit(code ?? 1);
}

// ---------------------------------------------------------------------------
// Daemon (default)
// ---------------------------------------------------------------------------

async function serveDaemon(port: number, host: string, noOpen: boolean): Promise<void> {
  const dataDir = resolveDataDir();
  const url = `http://localhost:${port}`;
  const logPath = logFilePath(dataDir);

  const existing = readPidFile(dataDir);
  if (existing) {
    if (!isAlive(existing.pid)) {
      removePidFile(dataDir); // left behind by a crash or reboot
    } else if (await isUp(existing.port, existing.host)) {
      console.log(
        `HAAI is already running (pid ${existing.pid}) at http://localhost:${existing.port}`,
      );
      if (shouldOpenBrowser(noOpen)) openBrowser(`http://localhost:${existing.port}`);
      process.exit(0);
      return;
    } else {
      console.error(
        chalk.red(
          `✗ ${pidFilePath(dataDir)} says HAAI is running as pid ${existing.pid}, but it isn't answering on port ${existing.port}.`,
        ),
      );
      console.error(
        chalk.dim(
          `  If the PID file is stale (that pid now belongs to another process), delete it and retry.\n  If HAAI is hung, check ${logPath} or run: haai stop --force`,
        ),
      );
      process.exit(1);
      return;
    }
  }

  if (await isUp(port, host)) {
    console.log(`HAAI is already running at ${url} (not started by \`haai serve\`, so \`haai stop\` can't stop it)`);
    if (shouldOpenBrowser(noOpen)) openBrowser(url);
    process.exit(0);
    return;
  }

  ensureDataDir(dataDir);
  const logOffset = existsSync(logPath) ? statSync(logPath).size : 0;
  const logFd = openSync(logPath, "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [serverScriptPath()], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      windowsHide: true,
    });
  } finally {
    closeSync(logFd); // the child holds its own copy
  }

  let exitCode: number | null | undefined;
  child.once("exit", (code, signal) => {
    exitCode = code ?? (signal ? 1 : 0);
  });
  const spawnFailed = new Promise<Error>((resolve) => child.once("error", resolve));
  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    console.error(chalk.red(`✗ Failed to start the server: ${(await spawnFailed).message}`));
    process.exit(1);
    return;
  }
  writePidFile(dataDir, { pid, port, host, startedAt: new Date().toISOString() });

  const cameUp = await pollHealth(port, host, START_TIMEOUT_MS, () => exitCode !== undefined);
  if (cameUp) {
    console.log(chalk.green(`✓ HAAI is running at ${url} (pid ${pid})`));
    console.log(chalk.dim(`  Logs: ${logPath}`));
    console.log(chalk.dim("  Stop: haai stop"));
    if (shouldOpenBrowser(noOpen)) openBrowser(url);
    process.exit(0);
    return;
  }

  if (exitCode !== undefined) {
    removePidFile(dataDir);
    console.error(chalk.red(`✗ The server exited during startup (code ${exitCode})`));
    const tail = readLogTail(logPath, logOffset);
    if (tail) console.error(chalk.dim(tail));
    console.error(chalk.dim(`  Full log: ${logPath}`));
  } else {
    console.error(
      chalk.red(`✗ HAAI (pid ${pid}) hasn't answered on ${url} after ${START_TIMEOUT_MS / 1000}s`),
    );
    console.error(chalk.dim(`  It is still running in the background — check ${logPath}, or run: haai stop`));
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// haai stop
// ---------------------------------------------------------------------------

export async function stop(opts: StopOptions): Promise<void> {
  const dataDir = resolveDataDir();
  const info = readPidFile(dataDir);

  if (!info) {
    console.log("HAAI isn't running in the background (no PID file).");
    return;
  }
  if (!isAlive(info.pid)) {
    removePidFile(dataDir);
    console.log("HAAI isn't running (removed a stale PID file).");
    return;
  }
  // PIDs get reused (e.g. after a reboot). Don't signal a process we can't
  // confirm is HAAI unless the user insists.
  if (!opts.force && !(await isUp(info.port, info.host))) {
    console.error(
      chalk.red(`✗ pid ${info.pid} is alive but nothing is answering on port ${info.port}, so it may not be HAAI.`),
    );
    console.error(chalk.dim(`  If HAAI is hung, run: haai stop --force (or delete ${pidFilePath(dataDir)} if it's stale)`));
    process.exit(1);
    return;
  }

  try {
    process.kill(info.pid, opts.force ? "SIGKILL" : "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error(chalk.red(`✗ Could not signal pid ${info.pid}: ${(err as Error).message}`));
      process.exit(1);
      return;
    }
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(info.pid) && Date.now() < deadline) await sleepMs(100);

  if (isAlive(info.pid)) {
    console.error(
      chalk.red(`✗ HAAI (pid ${info.pid}) didn't exit within ${STOP_TIMEOUT_MS / 1000}s`),
    );
    console.error(chalk.dim("  Run: haai stop --force"));
    process.exit(1);
    return;
  }
  removePidFile(dataDir);
  console.log(chalk.green(`✓ Stopped HAAI (pid ${info.pid})`));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPidFile(dataDir: string): DaemonInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(pidFilePath(dataDir), "utf8")) as Partial<DaemonInfo>;
    if (typeof info.pid === "number" && typeof info.port === "number") return info as DaemonInfo;
  } catch {
    // missing or unreadable — treat as not running
  }
  return undefined;
}

function writePidFile(dataDir: string, info: DaemonInfo): void {
  writeFileSync(pidFilePath(dataDir), JSON.stringify(info), { mode: 0o600 });
}

function removePidFile(dataDir: string): void {
  rmSync(pidFilePath(dataDir), { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

/** Last lines written to the log since `offset` (i.e. by the run that just failed). */
function readLogTail(logPath: string, offset: number, maxLines = 20): string {
  try {
    const size = statSync(logPath).size;
    const buf = Buffer.alloc(Math.max(0, size - offset));
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buf, 0, buf.length, offset);
    } finally {
      closeSync(fd);
    }
    return buf.toString("utf8").trimEnd().split("\n").slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

function healthHost(host: string | undefined): string {
  return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isUp(port: number, host: string | undefined): Promise<boolean> {
  try {
    const res = await fetch(`http://${healthHost(host)}:${port}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollHealth(
  port: number,
  host: string | undefined,
  timeoutMs: number,
  giveUp: () => boolean = () => false,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !giveUp()) {
    if (await isUp(port, host)) return true;
    await sleepMs(500);
  }
  return false;
}

function shouldOpenBrowser(noOpen: boolean): boolean {
  return !noOpen && Boolean(process.stdout.isTTY) && !process.env["CI"];
}

function openBrowser(url: string): void {
  try {
    const opts = { stdio: "ignore" as const, detached: true };
    const proc: ChildProcess =
      process.platform === "darwin"
        ? spawn("open", [url], opts)
        : process.platform === "win32"
          ? spawn("rundll32", ["url.dll,FileProtocolHandler", url], opts)
          : spawn("xdg-open", [url], opts);
    proc.on("error", () => {}); // best effort — absence of xdg-open etc. is fine
    proc.unref();
  } catch {
    // best effort
  }
}
