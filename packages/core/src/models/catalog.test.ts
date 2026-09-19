import { describe, expect, it } from "vitest";
import {
  catalogModelIds,
  lookupModelKind,
  mergeCatalog,
  parseLmStudioV0Models,
  parseModelCatalogJson,
  parseOllamaShow,
  parseOllamaTags,
  parseOpenAiModelsResponse,
  serializeModelCatalog,
  type CatalogEntry,
} from "./catalog.js";

describe("parseOpenAiModelsResponse", () => {
  it("returns [] for a non-object body", () => {
    expect(parseOpenAiModelsResponse(null)).toEqual([]);
    expect(parseOpenAiModelsResponse("string")).toEqual([]);
  });

  it("returns [] when data is missing or not an array", () => {
    expect(parseOpenAiModelsResponse({})).toEqual([]);
    expect(parseOpenAiModelsResponse({ data: "nope" })).toEqual([]);
  });

  it("skips entries with a non-string id", () => {
    expect(parseOpenAiModelsResponse({ data: [{ id: 5 }, { notId: "x" }] })).toEqual([]);
  });

  it("classifies each entry heuristically and picks up context_length", () => {
    const result = parseOpenAiModelsResponse({
      data: [
        { id: "gpt-4o", context_length: 128000 },
        { id: "bge-m3" },
      ],
    });
    expect(result).toEqual([
      { id: "gpt-4o", kind: "unknown", source: "heuristic", contextLength: 128000 },
      { id: "bge-m3", kind: "embeddings", source: "heuristic" },
    ]);
  });
});

describe("parseLmStudioV0Models", () => {
  it("parses type and max_context_length", () => {
    const result = parseLmStudioV0Models({
      data: [
        { id: "qwen3-8b", type: "llm", max_context_length: 32768 },
        { id: "nomic-embed-text", type: "embeddings" },
        { id: "some-vision-model", type: "vlm" },
        { id: "weird", type: "something-else" },
      ],
    });
    expect(result.get("qwen3-8b")).toEqual({ kind: "llm", contextLength: 32768 });
    expect(result.get("nomic-embed-text")).toEqual({ kind: "embeddings" });
    expect(result.get("some-vision-model")).toEqual({ kind: "vlm" });
    expect(result.get("weird")).toEqual({ kind: "unknown" });
  });

  it("returns an empty map for malformed input", () => {
    expect(parseLmStudioV0Models(null).size).toBe(0);
    expect(parseLmStudioV0Models({}).size).toBe(0);
  });
});

describe("parseOllamaShow", () => {
  it("maps embedding capability", () => {
    expect(parseOllamaShow({ capabilities: ["embedding"] })).toBe("embeddings");
  });
  it("maps completion capability", () => {
    expect(parseOllamaShow({ capabilities: ["completion", "tools"] })).toBe("llm");
  });
  it("returns unknown when capabilities is missing (older Ollama)", () => {
    expect(parseOllamaShow({})).toBe("unknown");
    expect(parseOllamaShow(null)).toBe("unknown");
  });
});

describe("parseOllamaTags", () => {
  it("extracts model names", () => {
    expect(parseOllamaTags({ models: [{ name: "a:latest" }, { name: "b:latest" }] })).toEqual([
      "a:latest",
      "b:latest",
    ]);
  });
  it("returns [] for malformed input", () => {
    expect(parseOllamaTags(null)).toEqual([]);
    expect(parseOllamaTags({})).toEqual([]);
  });
});

describe("mergeCatalog", () => {
  it("upgrades matching entries to native and leaves others heuristic", () => {
    const base: CatalogEntry[] = [
      { id: "a", kind: "unknown", source: "heuristic" },
      { id: "b", kind: "embeddings", source: "heuristic" },
    ];
    const native = new Map([["a", { kind: "llm" as const, contextLength: 4096 }]]);
    expect(mergeCatalog(base, native)).toEqual([
      { id: "a", kind: "llm", source: "native", contextLength: 4096 },
      { id: "b", kind: "embeddings", source: "heuristic" },
    ]);
  });

  it("returns base unchanged when native is empty", () => {
    const base: CatalogEntry[] = [{ id: "a", kind: "unknown", source: "heuristic" }];
    expect(mergeCatalog(base, new Map())).toBe(base);
  });
});

describe("parseModelCatalogJson", () => {
  it("returns null for empty/invalid input", () => {
    expect(parseModelCatalogJson(null)).toBeNull();
    expect(parseModelCatalogJson(undefined)).toBeNull();
    expect(parseModelCatalogJson("")).toBeNull();
    expect(parseModelCatalogJson("not-json")).toBeNull();
    expect(parseModelCatalogJson("{}")).toBeNull();
  });

  it("tolerates the legacy string[] shape used by available_models", () => {
    expect(parseModelCatalogJson('["a","b"]')).toEqual([
      { id: "a", kind: "unknown", source: "heuristic" },
      { id: "b", kind: "unknown", source: "heuristic" },
    ]);
  });

  it("round-trips CatalogEntry objects", () => {
    const entries: CatalogEntry[] = [
      { id: "a", kind: "embeddings", source: "native", contextLength: 512 },
    ];
    expect(parseModelCatalogJson(serializeModelCatalog(entries))).toEqual(entries);
  });
});

describe("catalogModelIds", () => {
  it("extracts ids", () => {
    expect(
      catalogModelIds([
        { id: "a", kind: "llm", source: "heuristic" },
        { id: "b", kind: "embeddings", source: "native" },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("lookupModelKind", () => {
  it("is positive for a native entry regardless of kind", () => {
    expect(lookupModelKind([{ id: "a", kind: "llm", source: "native" }], "a")).toEqual({
      kind: "llm",
      positive: true,
    });
  });

  it("is positive for a heuristic embeddings hit", () => {
    expect(lookupModelKind([{ id: "bge-m3", kind: "embeddings", source: "heuristic" }], "bge-m3")).toEqual({
      kind: "embeddings",
      positive: true,
    });
  });

  it("is not positive for a heuristic unknown guess", () => {
    expect(lookupModelKind([{ id: "gpt-4o", kind: "unknown", source: "heuristic" }], "gpt-4o")).toEqual({
      kind: "unknown",
      positive: false,
    });
  });

  it("falls back to the id heuristic when the entry is missing", () => {
    expect(lookupModelKind([], "bge-m3")).toEqual({ kind: "embeddings", positive: true });
    expect(lookupModelKind(null, "gpt-4o")).toEqual({ kind: "unknown", positive: false });
  });
});
