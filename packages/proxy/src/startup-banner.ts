import { existsSync } from "node:fs";
import type { AppConfig, DbClient } from "@haai/core";
import { backends as backendsTable, vmodels as vmodelsTable } from "@haai/core";

const VERSION = "0.2.1";
const DEV_WEB_PORT = "5173";

const LOGO = [
  "  ██╗  ██╗  █████╗   █████╗  ██╗",
  "  ██║  ██║ ██╔══██╗ ██╔══██╗ ██║",
  "  ███████║ ███████║ ███████║ ██║",
  "  ██╔══██║ ██╔══██║ ██╔══██║ ██║",
  "  ██║  ██║ ██║  ██║ ██║  ██║ ██║",
  "  ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝",
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

/** True when running inside a Docker container (compose sets HAAI_DOCKER=1). */
export function isRunningInDocker(): boolean {
  return process.env["HAAI_DOCKER"] === "1" || existsSync("/.dockerenv");
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Public base URL for docs, banner, and CLI output. */
export function resolvePublicBaseUrl(config: AppConfig): string {
  if (isRunningInDocker()) {
    const explicit = process.env["HAAI_URL"]?.trim();
    if (explicit) return normalizeUrl(explicit);
  }

  const { host, port } = config.server;
  return `http://${displayHost(host)}:${port}`;
}

/** Admin UI URL — Docker external port, Vite dev server, or bundled with the proxy. */
export function resolveWebUiUrl(baseUrl: string): string {
  if (isRunningInDocker()) {
    const explicit = process.env["HAAI_WEB_URL"]?.trim();
    if (explicit) return normalizeUrl(explicit);
    return baseUrl;
  }

  if (process.env["HAAI_DEV"] === "1") {
    const port = process.env["HAAI_DEV_WEB_PORT"]?.trim() || DEV_WEB_PORT;
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
    case "disabled":
      return { glyph: "○", color: c.dim };
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
  const flag = process.env["HAAI_NO_BANNER"];
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
  const allVmodels = await db.db.select().from(vmodelsTable).all();
  const enabledVmodels = allVmodels.filter((v) => v.enabled);

  const lines: string[] = [""];

  for (const row of LOGO) {
    lines.push(paint(c.cyan, row));
  }

  lines.push(
    paint(c.dim, `  High Availability AI · OpenAI-compatible LLM proxy · v${VERSION}`),
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
      `  ${paint(c.dim, "→ haai backend add --name my-backend --provider lmstudio --base-url http://localhost:1234")}`,
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
    paint(c.bold, `  Virtual models (${enabledVmodels.length} enabled · ${allVmodels.length} total)`),
    paint(c.dim, "  ─────────────────────────────────────────────────────"),
  );

  if (allVmodels.length === 0) {
    lines.push(
      `  ${paint(c.dim, "No virtual models")}`,
      `  ${paint(c.dim, "→ haai vmodel create --model-id smart-chat --display-name \"Smart Chat\"")}`,
    );
  } else {
    for (const vm of allVmodels) {
      const health = vm.enabled ? (vm.lastHealthStatus ?? "unknown") : "disabled";
      const { glyph, color } = healthSymbol(health === "disabled" ? "disabled" : vm.lastHealthStatus);
      const modelId = padEnd(vm.modelId, 20);
      const strategy = padEnd(vm.balancingStrategy, 14);
      const detail = !vm.enabled
        ? "—"
        : vm.lastHealthError
          ? truncate(vm.lastHealthError, 42)
          : vm.displayName !== vm.modelId
            ? vm.displayName
            : "—";
      lines.push(
        `  ${paint(color, glyph)} ${modelId} ${paint(c.dim, strategy)} ${padEnd(health, 12)} ${paint(c.dim, detail)}`,
      );
    }
  }

  lines.push(
    "",
    paint(c.dim, "  Press Ctrl+C to stop · Set HAAI_NO_BANNER=1 to hide this banner"),
    "",
  );

  process.stdout.write(lines.join("\n") + "\n");
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}
