import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import chalk from "chalk";

/**
 * `haai serve` — boots the packaged server (dist/server.js, sibling of the
 * CLI bundle) and, once it answers /health, best-effort opens the admin UI.
 */
export const serveCommand = "serve";
export const serveDescriptor =
  "Start the HAAI server (default port 4000) and open the admin UI";

export interface ServeOptions {
  /** Listen port (default: $HAAI_PORT or 4000) */
  port?: string;
  /** Listen host/address (default: $HAAI_HOST or 0.0.0.0) */
  host?: string;
  /** Don't open the browser */
  noOpen?: boolean;
}

function hasBundledServer(): boolean {
  return existsSync(new URL("./server.js", import.meta.url));
}

export function serve(opts: ServeOptions): void {
  if (!hasBundledServer()) {
    console.error(
      chalk.red(
        "The server is not available in this build (this copy of the CLI has no bundled dist/server.js).",
      ),
    );
    console.error(
      "Run `pnpm dev` for the development server, or install the published package: npm i -g haai",
    );
    process.exit(1);
    return;
  }

  const serverPath = new URL("./server.js", import.meta.url);
  const port = Number(opts.port ?? process.env["HAAI_PORT"]) || 4000;
  const host = opts.host ?? process.env["HAAI_HOST"];

  const env = { ...process.env };
  if (opts.port !== undefined) env["HAAI_PORT"] = String(port);
  if (opts.host !== undefined) env["HAAI_HOST"] = host;

  const child: ChildProcess = spawn(process.execPath, [serverPath.pathname], {
    stdio: "inherit",
    env,
  });

  let exited = false;
  child.on("exit", (code, signal) => {
    exited = true;
    onServerExit(code, signal, port, host, opts.noOpen);
  });
  const forward = (signalName: NodeJS.Signals) => {
    if (!exited) child.kill(signalName);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  void pollHealth(port, host, 90_000).then((cameUp) => {
    if (!exited && cameUp && shouldOpenBrowser(opts.noOpen)) {
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
  noOpen: boolean | undefined,
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

function healthHost(host: string | undefined): string {
  return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollHealth(port: number, host: string | undefined, timeoutMs: number): Promise<boolean> {
  const url = `http://${healthHost(host)}:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (res.ok) return true;
    } catch {
      // not up yet — keep polling
    }
    await sleepMs(500);
  }
  return false;
}

function shouldOpenBrowser(noOpen: boolean | undefined): boolean {
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
