import { DEV_PORT, PROD_PORT } from "../config/constants.js";

const DEFAULT_PROBE_TIMEOUT_MS = 300;

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Candidate proxy base URLs when `HAAI_URL` is unset (prod first, then local `pnpm dev`). */
export function defaultProxyCandidateUrls(): string[] {
  return [`http://localhost:${PROD_PORT}`, `http://localhost:${DEV_PORT}`];
}

/**
 * Resolve the proxy base URL for CLI / MCP / TUI clients.
 *
 * - `HAAI_URL` wins when set.
 * - Otherwise probes `/health` on the production and dev listen ports so
 *   `pnpm haai` works against both `pnpm start` (:4000) and `pnpm dev` (:4001).
 * - If nothing responds, returns the production default (for clear error messages).
 */
export async function resolveDefaultProxyUrl(opts?: {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** When set (e.g. `-u`), skip env/probe and return this URL. */
  explicitUrl?: string;
}): Promise<string> {
  const explicit = opts?.explicitUrl?.trim() || process.env["HAAI_URL"]?.trim();
  if (explicit) return normalizeUrl(explicit);

  const fetchFn = opts?.fetch ?? globalThis.fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const candidates = defaultProxyCandidateUrls();

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${url}/health`, { signal: controller.signal });
        if (res.ok) return url;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // try next candidate
    }
  }

  return candidates[0]!;
}
