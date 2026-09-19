/**
 * Classification of a backend (upstream) model. Wire-compatible with the
 * `type` field LM Studio's `/api/v0/models` endpoint reports.
 */
export type ModelKind = "llm" | "vlm" | "embeddings" | "unknown";

/** A v-model's routing class: which inference endpoint it may serve. */
export type VModelKind = "chat" | "embedding";

/**
 * Maps a model kind to the endpoint class that should serve it. An
 * unclassified ("unknown") model degrades to "chat" — this is the single
 * place that degradation rule lives, so a guess never blocks routing.
 */
export function modelKindRoutingClass(kind: ModelKind): VModelKind {
  return kind === "embeddings" ? "embedding" : "chat";
}

/**
 * Maps an internal model kind to the value reported on the wire (`GET
 * /v1/models`'s `type` field). "unknown" is never emitted on the wire —
 * it degrades to "llm" so unclassified models still look like ordinary
 * chat models to clients.
 */
export function modelKindWireValue(kind: ModelKind): "llm" | "vlm" | "embeddings" {
  return kind === "unknown" ? "llm" : kind;
}

/** Tolerantly parses a model kind from an arbitrary upstream/DB value. */
export function parseModelKind(raw: unknown): ModelKind {
  if (raw === "llm" || raw === "vlm" || raw === "embeddings") return raw;
  return "unknown";
}

/** Tolerantly parses a v-model kind, returning null if unrecognized. */
export function parseVModelKind(raw: unknown): VModelKind | null {
  if (raw === "chat" || raw === "embedding") return raw;
  return null;
}

// Rerankers (e.g. "bge-reranker-v2-m3") are served on neither /v1/chat/completions
// nor /v1/embeddings — check this first so they aren't misclassified as embeddings.
const RERANK_PATTERN = /rerank/;

// Positive embedding-model name patterns, checked against the lowercased id
// and against its final "/" path segment (for ids like
// "sentence-transformers/all-MiniLM-L6-v2").
const EMBEDDING_PATTERNS: RegExp[] = [
  /embed/, // covers *embed*, text-embedding-*, nomic-embed-*, mxbai-embed-*,
  // arctic-embed*, jina-embed*, jina-embeddings-*, mistral-embed, *-Embedding-*
  /^bge-/,
  /^gte-/,
  /(^|[-_/])e5-/, // boundary-anchored so it doesn't match unrelated ids
  /minilm/,
  /^stella/,
  /^gtr-/,
  /sentence-t5/,
  /^instructor-/,
  /^voyage-/,
];

/**
 * Guesses a model's kind from its id alone. Only ever returns "embeddings"
 * (a positive classification) or "unknown" (no signal either way) — it
 * never returns "llm", because a guess must not be treated as a positive
 * confirmation that a model is a chat model.
 */
export function classifyModelIdHeuristic(id: string): "embeddings" | "unknown" {
  const normalized = id.toLowerCase().replace(/:[^:/]+$/, ""); // strip an Ollama ":tag" suffix
  const segment = normalized.split("/").pop() ?? normalized;

  if (RERANK_PATTERN.test(normalized) || RERANK_PATTERN.test(segment)) {
    return "unknown";
  }

  for (const pattern of EMBEDDING_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(segment)) {
      return "embeddings";
    }
  }

  return "unknown";
}
