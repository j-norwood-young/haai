import { fetch } from "undici";
import {
  buildBackendRootUrl,
  mergeCatalog,
  parseLmStudioV0Models,
  parseOllamaShow,
  type CatalogEntry,
} from "@haai/core";
import { backendAuthHeaders, type BackendAuthFields } from "./backend-auth.js";
import { getLogger } from "./logger.js";

const PROBE_TIMEOUT_MS = 3000;
const OLLAMA_PROBE_CONCURRENCY = 4;

export interface ProbeBackend extends BackendAuthFields {
  id: string;
  baseUrl: string;
  provider?: string;
}

/**
 * Enriches a base catalog (from `/v1/models`) with provider-native model
 * kind info where the backend's provider supports a probe endpoint.
 *
 * Contract: this function never throws and never rejects. Any failure
 * (timeout, non-200, unparseable body, unsupported provider) leaves the
 * base catalog unchanged (heuristic kinds only). It must never affect a
 * backend's reported health status or latency — callers should measure
 * latency before calling this.
 */
export async function probeModelKinds(
  backend: ProbeBackend,
  masterKey: Buffer,
  base: CatalogEntry[],
  previous: CatalogEntry[] | null,
): Promise<CatalogEntry[]> {
  try {
    if (backend.provider === "lmstudio") {
      return await probeLmStudio(backend, masterKey, base);
    }
    if (backend.provider === "ollama") {
      return await probeOllama(backend, masterKey, base, previous);
    }
    return base;
  } catch (err) {
    getLogger().debug({ err, backendId: backend.id }, "Model kind probe failed — using heuristic classification");
    return base;
  }
}

async function probeLmStudio(
  backend: ProbeBackend,
  masterKey: Buffer,
  base: CatalogEntry[],
): Promise<CatalogEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(buildBackendRootUrl(backend.baseUrl, "/api/v0/models"), {
      headers: {
        "Content-Type": "application/json",
        ...backendAuthHeaders(backend, masterKey),
      },
      signal: controller.signal,
    });
    if (!res.ok) return base;
    const json = (await res.json()) as unknown;
    const native = parseLmStudioV0Models(json);
    return mergeCatalog(base, native);
  } finally {
    clearTimeout(timer);
  }
}

async function probeOllama(
  backend: ProbeBackend,
  masterKey: Buffer,
  base: CatalogEntry[],
  previous: CatalogEntry[] | null,
): Promise<CatalogEntry[]> {
  // Only probe ids we don't already have a native classification for — a
  // steady-state Ollama host does zero probes per poll once every model has
  // been classified once.
  const previousById = new Map(previous?.map((entry) => [entry.id, entry]) ?? []);
  const toProbe = base.filter((entry) => previousById.get(entry.id)?.source !== "native");
  if (toProbe.length === 0) return base;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    ...backendAuthHeaders(backend, masterKey),
  };
  const url = buildBackendRootUrl(backend.baseUrl, "/api/show");

  const native = new Map<string, { kind: CatalogEntry["kind"] }>();
  try {
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < toProbe.length) {
        const entry = toProbe[cursor++];
        if (!entry) continue;
        try {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: entry.id }),
            signal: controller.signal,
          });
          if (!res.ok) continue;
          const json = (await res.json()) as unknown;
          const kind = parseOllamaShow(json);
          if (kind !== "unknown") native.set(entry.id, { kind });
        } catch {
          // Leave this entry's heuristic classification as-is.
        }
      }
    }
    const workers = Array.from(
      { length: Math.min(OLLAMA_PROBE_CONCURRENCY, toProbe.length) },
      () => worker(),
    );
    await Promise.all(workers);
  } finally {
    clearTimeout(timer);
  }

  if (native.size === 0) return base;
  return mergeCatalog(base, native);
}
