import { classifyModelIdHeuristic, type ModelKind } from "./kind.js";

/**
 * A single model entry in a backend's cached model catalog
 * (`backends.model_catalog`).
 */
export interface CatalogEntry {
  id: string;
  kind: ModelKind;
  contextLength?: number;
  /** "native" = the provider told us; "heuristic" = guessed from the id. */
  source: "native" | "heuristic";
}

/**
 * Parses an OpenAI-compatible `GET /v1/models` response into catalog
 * entries, defaulting each entry's kind to a heuristic guess based on its
 * id. Tolerant of malformed bodies (mirrors the old `extractModelIds`
 * behaviour): a non-object body, a missing/non-array `data`, or a
 * non-string `id` are all skipped without throwing.
 */
export function parseOpenAiModelsResponse(body: unknown): CatalogEntry[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const entries: CatalogEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;

    const entry: CatalogEntry = {
      id,
      kind: classifyModelIdHeuristic(id),
      source: "heuristic",
    };
    const contextLength = (item as { context_length?: unknown }).context_length;
    if (typeof contextLength === "number") entry.contextLength = contextLength;
    entries.push(entry);
  }
  return entries;
}

/**
 * Parses LM Studio's `GET /api/v0/models` response into a map of native
 * kind/context-length info, keyed by model id. Returns an empty map for
 * any unparseable shape.
 */
export function parseLmStudioV0Models(
  body: unknown,
): Map<string, { kind: ModelKind; contextLength?: number }> {
  const result = new Map<string, { kind: ModelKind; contextLength?: number }>();
  if (!body || typeof body !== "object") return result;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return result;

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;

    const rawType = (item as { type?: unknown }).type;
    const kind: ModelKind =
      rawType === "llm" || rawType === "vlm" || rawType === "embeddings" ? rawType : "unknown";

    const entry: { kind: ModelKind; contextLength?: number } = { kind };
    const contextLength = (item as { max_context_length?: unknown }).max_context_length;
    if (typeof contextLength === "number") entry.contextLength = contextLength;
    result.set(id, entry);
  }
  return result;
}

/**
 * Parses Ollama's `POST /api/show` response into a model kind, from its
 * `capabilities` array. Returns "unknown" when `capabilities` is absent
 * (older Ollama versions) or unparseable.
 */
export function parseOllamaShow(body: unknown): ModelKind {
  if (!body || typeof body !== "object") return "unknown";
  const capabilities = (body as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return "unknown";
  if (capabilities.includes("embedding")) return "embeddings";
  if (capabilities.includes("completion")) return "llm";
  return "unknown";
}

/**
 * Parses Ollama's `GET /api/tags` response into a bare list of model
 * names. Not used to join against `backendModelId` (see model-probe.ts for
 * why) but useful for completeness / diagnostics.
 */
export function parseOllamaTags(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const item of models) {
    const name = (item as { name?: unknown })?.name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/**
 * Merges native kind/context-length info (from a provider-specific probe)
 * into a base catalog (from `/v1/models`), upgrading matching entries to
 * `source: "native"`. Entries with no native match are left as-is
 * (heuristic).
 */
export function mergeCatalog(
  base: CatalogEntry[],
  native: Map<string, { kind: ModelKind; contextLength?: number }>,
): CatalogEntry[] {
  if (native.size === 0) return base;
  return base.map((entry) => {
    const match = native.get(entry.id);
    if (!match) return entry;
    const merged: CatalogEntry = { ...entry, kind: match.kind, source: "native" };
    if (match.contextLength !== undefined) merged.contextLength = match.contextLength;
    return merged;
  });
}

export function serializeModelCatalog(entries: CatalogEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * Parses `backends.model_catalog`. Tolerates the legacy shape stored in
 * `backends.available_models` (a plain `string[]`) by mapping each id to an
 * "unknown"/"heuristic" entry — this is the backward-compatibility
 * guarantee for existing installs that haven't been re-polled yet. Returns
 * null for a missing/empty/malformed value.
 */
export function parseModelCatalogJson(raw: string | null | undefined): CatalogEntry[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entries: CatalogEntry[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      entries.push({ id: item, kind: "unknown", source: "heuristic" });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      const obj = item as { id: string; kind?: unknown; contextLength?: unknown; source?: unknown };
      const entry: CatalogEntry = {
        id: obj.id,
        kind:
          obj.kind === "llm" || obj.kind === "vlm" || obj.kind === "embeddings"
            ? obj.kind
            : "unknown",
        source: obj.source === "native" ? "native" : "heuristic",
      };
      if (typeof obj.contextLength === "number") entry.contextLength = obj.contextLength;
      entries.push(entry);
    }
  }
  return entries;
}

export function catalogModelIds(entries: CatalogEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

/**
 * Resolves a raw backend model id's kind, and whether that classification
 * is "positive" (should be treated as a confirmed fact that can block
 * routing) or merely a guess. Positive iff: the catalog entry was learned
 * from a provider-native probe, OR a heuristic guess came back
 * "embeddings". A missing catalog entry falls back to the heuristic
 * directly on the id.
 */
export function lookupModelKind(
  entries: CatalogEntry[] | null,
  id: string,
): { kind: ModelKind; positive: boolean } {
  const entry = entries?.find((e) => e.id === id);
  if (entry) {
    if (entry.source === "native") return { kind: entry.kind, positive: true };
    return { kind: entry.kind, positive: entry.kind === "embeddings" };
  }
  const guessed = classifyModelIdHeuristic(id);
  return { kind: guessed, positive: guessed === "embeddings" };
}
