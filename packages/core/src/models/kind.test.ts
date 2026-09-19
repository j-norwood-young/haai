import { describe, expect, it } from "vitest";
import {
  classifyModelIdHeuristic,
  modelKindRoutingClass,
  modelKindWireValue,
  parseModelKind,
  parseVModelKind,
} from "./kind.js";

describe("classifyModelIdHeuristic", () => {
  it.each([
    "text-embedding-3-small",
    "nomic-embed-text:v1.5",
    "bge-m3",
    "gte-large",
    "multilingual-e5-large",
    "all-MiniLM-L6-v2",
    "mxbai-embed-large",
    "snowflake-arctic-embed2",
    "jina-embeddings-v3",
    "Qwen3-Embedding-8B",
    "mistral-embed",
    "sentence-transformers/all-MiniLM-L6-v2",
    "voyage-3-large",
    "instructor-xl",
  ])("classifies %s as embeddings", (id) => {
    expect(classifyModelIdHeuristic(id)).toBe("embeddings");
  });

  it.each([
    "qwen3-32b",
    "llama-3.3-70b-instruct",
    "gpt-4o",
    "gemma-3-27b-it",
    "deepseek-r1:8b",
    "nomic-chat-hypothetical",
    "bge-reranker-v2-m3",
  ])("classifies %s as unknown", (id) => {
    expect(classifyModelIdHeuristic(id)).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(classifyModelIdHeuristic("BGE-M3")).toBe("embeddings");
  });

  it("strips an Ollama tag suffix before matching", () => {
    expect(classifyModelIdHeuristic("nomic-embed-text:latest")).toBe("embeddings");
  });

  it("never returns 'llm' for a chat-looking id", () => {
    expect(classifyModelIdHeuristic("gpt-4o")).not.toBe("llm");
  });
});

describe("modelKindRoutingClass", () => {
  it("maps embeddings to embedding", () => {
    expect(modelKindRoutingClass("embeddings")).toBe("embedding");
  });
  it("maps everything else to chat", () => {
    expect(modelKindRoutingClass("llm")).toBe("chat");
    expect(modelKindRoutingClass("vlm")).toBe("chat");
    expect(modelKindRoutingClass("unknown")).toBe("chat");
  });
});

describe("modelKindWireValue", () => {
  it("never emits 'unknown' on the wire", () => {
    expect(modelKindWireValue("unknown")).toBe("llm");
  });
  it("passes through known kinds", () => {
    expect(modelKindWireValue("llm")).toBe("llm");
    expect(modelKindWireValue("vlm")).toBe("vlm");
    expect(modelKindWireValue("embeddings")).toBe("embeddings");
  });
});

describe("parseModelKind", () => {
  it("accepts known kinds", () => {
    expect(parseModelKind("llm")).toBe("llm");
    expect(parseModelKind("vlm")).toBe("vlm");
    expect(parseModelKind("embeddings")).toBe("embeddings");
  });
  it("defaults unrecognized values to unknown", () => {
    expect(parseModelKind("bogus")).toBe("unknown");
    expect(parseModelKind(undefined)).toBe("unknown");
    expect(parseModelKind(null)).toBe("unknown");
  });
});

describe("parseVModelKind", () => {
  it("accepts chat and embedding", () => {
    expect(parseVModelKind("chat")).toBe("chat");
    expect(parseVModelKind("embedding")).toBe("embedding");
  });
  it("returns null for unrecognized values", () => {
    expect(parseVModelKind("bogus")).toBeNull();
    expect(parseVModelKind(undefined)).toBeNull();
  });
});
