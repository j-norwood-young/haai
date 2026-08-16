import { describe, it, expect } from "vitest";
import {
  deriveVModelHealth,
  evaluateMappingAvailability,
  parseAvailableModelsJson,
} from "./vmodel-health.js";

describe("parseAvailableModelsJson", () => {
  it("returns null for empty/invalid", () => {
    expect(parseAvailableModelsJson(null)).toBeNull();
    expect(parseAvailableModelsJson("")).toBeNull();
    expect(parseAvailableModelsJson("not-json")).toBeNull();
    expect(parseAvailableModelsJson("{}")).toBeNull();
  });

  it("parses string id arrays", () => {
    expect(parseAvailableModelsJson('["a","b"]')).toEqual(["a", "b"]);
  });
});

describe("evaluateMappingAvailability", () => {
  it("marks disabled backends unavailable", () => {
    expect(
      evaluateMappingAvailability({
        backendEnabled: false,
        backendHealth: "healthy",
        backendModelId: "m",
        availableModels: ["m"],
      }),
    ).toEqual({ available: false, reason: "backend_disabled" });
  });

  it("marks unhealthy backends unavailable", () => {
    expect(
      evaluateMappingAvailability({
        backendEnabled: true,
        backendHealth: "unhealthy",
        backendModelId: "m",
        availableModels: ["m"],
      }),
    ).toEqual({ available: false, reason: "backend_unhealthy" });
  });

  it("marks missing inventory unknown", () => {
    expect(
      evaluateMappingAvailability({
        backendEnabled: true,
        backendHealth: "healthy",
        backendModelId: "m",
        availableModels: null,
      }),
    ).toEqual({ available: false, reason: "inventory_unknown" });
  });

  it("marks missing model unavailable", () => {
    expect(
      evaluateMappingAvailability({
        backendEnabled: true,
        backendHealth: "degraded",
        backendModelId: "m",
        availableModels: ["other"],
      }),
    ).toEqual({ available: false, reason: "model_missing" });
  });

  it("allows degraded hosts when model is present", () => {
    expect(
      evaluateMappingAvailability({
        backendEnabled: true,
        backendHealth: "degraded",
        backendModelId: "m",
        availableModels: ["m"],
      }),
    ).toEqual({ available: true, reason: null });
  });
});

describe("deriveVModelHealth", () => {
  it("is unhealthy with no mappings", () => {
    expect(deriveVModelHealth({ mappingCount: 0, availableCount: 0, reasons: [] }).status).toBe(
      "unhealthy",
    );
  });

  it("is healthy when all mappings available", () => {
    expect(deriveVModelHealth({ mappingCount: 2, availableCount: 2, reasons: [] })).toEqual({
      status: "healthy",
      error: null,
    });
  });

  it("is degraded when partially available", () => {
    const result = deriveVModelHealth({
      mappingCount: 2,
      availableCount: 1,
      reasons: ["gpu1: model missing"],
    });
    expect(result.status).toBe("degraded");
    expect(result.error).toContain("1/2");
  });

  it("is unhealthy when none available", () => {
    const result = deriveVModelHealth({
      mappingCount: 2,
      availableCount: 0,
      reasons: ["a: down", "b: missing"],
    });
    expect(result.status).toBe("unhealthy");
    expect(result.error).toContain("a: down");
  });
});
