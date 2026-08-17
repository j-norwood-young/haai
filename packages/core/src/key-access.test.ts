import { describe, expect, it } from "vitest";
import {
  hasModelSourceAccess,
  isBackendAllowed,
  isVModelAllowed,
  validateKeyModelAccess,
} from "./key-access.js";

describe("key-access", () => {
  it("allows full access when both lists are null", () => {
    expect(hasModelSourceAccess(null, null)).toBe(true);
    expect(validateKeyModelAccess(null, null)).toBeNull();
  });

  it("rejects when both restricted lists are empty", () => {
    expect(hasModelSourceAccess([], [])).toBe(false);
    expect(validateKeyModelAccess([], [])).toBeTruthy();
  });

  it("allows access when only v-models are restricted but non-empty", () => {
    expect(hasModelSourceAccess(["smart-chat"], [])).toBe(true);
  });

  it("allows access when only backends are restricted but non-empty", () => {
    expect(hasModelSourceAccess([], ["backend-1"])).toBe(true);
  });

  it("checks v-model and backend membership", () => {
    expect(isVModelAllowed(null, "smart-chat")).toBe(true);
    expect(isVModelAllowed(["smart-chat"], "smart-chat")).toBe(true);
    expect(isVModelAllowed(["smart-chat"], "other")).toBe(false);

    expect(isBackendAllowed(null, "backend-1")).toBe(true);
    expect(isBackendAllowed(["backend-1"], "backend-1")).toBe(true);
    expect(isBackendAllowed(["backend-1"], "backend-2")).toBe(false);
  });

  it("accepts either the public alias or the internal v-model id", () => {
    expect(isVModelAllowed(["vmodel-abc"], "smart-chat", "vmodel-abc")).toBe(true);
    expect(isVModelAllowed(["smart-chat"], "smart-chat", "vmodel-abc")).toBe(true);
    expect(isVModelAllowed(["vmodel-other"], "smart-chat", "vmodel-abc")).toBe(false);
  });
});
