import { existsSync } from "node:fs";
import type { AppConfig, DbClient } from "@ai-v-models/core";
import { backends as backendsTable, vmodels as vmodelsTable } from "@ai-v-models/core";

const VERSION = "0.0.1";
const DEV_WEB_PORT = "5173";

const LOGO = [
  "   █████╗   ██╗  ██╗   ██╗  ███╗   ███╗",
  "  ██╔══██╗  ╚═╝  ██║   ██║  ████╗ ████║",
  "  ███████║  ██╗  ██║   ██║  ██╔████╔██║",
  "  ██╔══██║  ██║  ╚██╗ ██╔╝  ██║╚██╔╝██║",
  "  ██║  ██║  ██║   ╚████╔╝   ██║ ╚═╝ ██║",
  "  ╚═╝  ╚═╝  ╚═╝    ╚═══╝    ╚═╝     ╚═╝",
];

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function displayHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "localhost" : host;
}

/** True when running inside a Docker container (compose sets AIVM_DOCKER=1). */
export function isRunningInDocker(): boolean {
  return process.env["AIVM_DOCKER"] === "1" || existsSync("/.dockerenv");
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Public base URL for docs, banner, and CLI output. */
export function resolvePublicBaseUrl(config: AppConfig): string {
  if (isRunningInDocker()) {
    const explicit = process.env["AIVM_URL"]?.trim();
    if (explicit) return normalizeUrl(explicit);
  }

  const { host, port } = config.server;
  return `http://${displayHost(host)}:${port}`;
}

/** Admin UI URL — Docker external port, Vite dev server, or bundled with the proxy. */
export function resolveWebUiUrl(baseUrl: string): string {
  if (isRunningInDocker()) {
    const explicit = process.env["AIVM_WEB_URL"]?.trim();
    if (explicit) return normalizeUrl(explicit);
    return baseUrl;
  }

  if (process.env["AIVM_DEV"] === "1") {
    const port = process.env["AIVM_DEV_WEB_PORT"]?.trim() || DEV_WEB_PORT;
    return `http://localhost:${port}`;
  }

  return baseUrl;
}

function healthSymbol(status: string | null | undefined): { glyph: string; color: string } {
  switch (status) {
    case "healthy":
      return { glyph: "●", color: c.green };
    case "degraded":
      return { glyph: "◐", color: c.yellow };
    case "unhealthy":
      return { glyph: "○", color: c.red };
    default:
      return { glyph: "?", color: c.dim };
  }
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

export interface StartupBannerOptions {
  config: AppConfig;
  db: DbClient;
  dataDir: string;
}

export function shouldPrintBanner(): boolean {
  const flag = process.env["AIVM_NO_BANNER"];
  return flag !== "1" && flag !== "true";
}

export async function printStartupBanner(opts: StartupBannerOptions): Promise<void> {
  if (!shouldPrintBanner()) return;

  const { config, db, dataDir } = opts;
  const baseUrl = resolvePublicBaseUrl(config);
  const webUiUrl = resolveWebUiUrl(baseUrl);
  const useColor = process.stdout.isTTY && process.env["NO_COLOR"] === undefined;

  const paint = (color: string, text: string) => (useColor ? `${color}${text}${c.reset}` : text);

  const allBackends = await db.db.select().from(backendsTable).all();
  const enabledBackends = allBackends.filter((b) => b.enabled);
  const vmodelCount = (await db.db.select().from(vmodelsTable).all()).length;

  const lines: string[] = [""];

  for (const row of LOGO) {
    lines.push(paint(c.cyan, row));
  }

  lines.push(
    paint(c.dim, `  AI Virtual Models · OpenAI-compatible LLM proxy · v${VERSION}`),
    "",
    paint(c.bold, "  Server"),
    paint(c.dim, "  ─────────────────────────────────────────────────────"),
    `  ${paint(c.dim, "URL")}       ${paint(c.bold, baseUrl)}`,
    `  ${paint(c.dim, "Data")}      ${dataDir}`,
    "",
    paint(c.bold, "  Endpoints"),
    paint(c.dim, "  ─────────────────────────────────────────────────────"),
    `  ${padEnd(paint(c.magenta, "Web UI"), 16)} ${webUiUrl}/`,
    `  ${padEnd(paint(c.magenta, "Chat"), 16)} POST ${baseUrl}/v1/chat/completions`,
    `  ${padEnd(paint(c.magenta, "Models"), 16)} GET  ${baseUrl}/v1/models`,
    `  ${padEnd(paint(c.magenta, "Embeddings"), 16)} POST ${baseUrl}/v1/embeddings`,
    `  ${padEnd(paint(c.magenta, "Health"), 16)} GET  ${baseUrl}/health`,
    `  ${padEnd(paint(c.magenta, "Ready"), 16)} GET  ${baseUrl}/ready`,
  );

  if (config.metrics.enabled) {
    lines.push(`  ${padEnd(paint(c.magenta, "Metrics"), 16)} GET  ${baseUrl}/metrics`);
  }

  lines.push(
    `  ${padEnd(paint(c.magenta, "API docs"), 16)} GET  ${baseUrl}/api/docs`,
    `  ${padEnd(paint(c.magenta, "Docs"), 16)} GET  ${baseUrl}/docs`,
    "",
    paint(c.bold, `  Backends (${enabledBackends.length} enabled · ${allBackends.length} total)`),
    paint(c.dim, "  ─────────────────────────────────────────────────────"),
  );

  if (allBackends.length === 0) {
    lines.push(
      `  ${paint(c.dim, "No backends configured")}`,
      `  ${paint(c.dim, "→ aivm backend add --name my-backend --provider lmstudio --base-url http://localhost:1234")}`,
    );
  } else {
    for (const backend of allBackends) {
      const { glyph, color } = healthSymbol(backend.lastHealthStatus);
      const status = backend.enabled
        ? (backend.lastHealthStatus ?? "unchecked")
        : "disabled";
      const latency =
        backend.lastLatencyMs != null && backend.enabled ? `${backend.lastLatencyMs}ms` : "—";
      const name = padEnd(backend.name, 20);
      const provider = padEnd(backend.provider, 10);
      lines.push(
        `  ${paint(color, glyph)} ${name} ${paint(c.dim, provider)} ${padEnd(status, 12)} ${paint(c.dim, latency)}`,
      );
    }
  }

  lines.push(
    "",
    paint(c.bold, "  Virtual models"),
    paint(c.dim, "  ─────────────────────────────────────────────────────"),
  );

  if (vmodelCount === 0) {
    lines.push(
      `  ${paint(c.dim, "No virtual models")}`,
      `  ${paint(c.dim, "→ aivm vmodel create --model-id smart-chat --display-name \"Smart Chat\"")}`,
    );
  } else {
    lines.push(`  ${vmodelCount} configured · GET ${baseUrl}/v1/models to list`);
  }

  lines.push(
    "",
    paint(c.dim, "  Press Ctrl+C to stop · Set AIVM_NO_BANNER=1 to hide this banner"),
    "",
  );

  process.stdout.write(lines.join("\n") + "\n");
}
