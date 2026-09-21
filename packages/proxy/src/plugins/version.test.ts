import { describe, expect, it } from "vitest";
import type { plugins as pluginsTable } from "@haai/core";
import { checkInstallConflict, compareVersions, samePluginName } from "./version.js";

type PluginRow = typeof pluginsTable.$inferSelect;

function row(name: string, version: string | null): PluginRow {
  return { id: `plugin-${name}`, name, version } as PluginRow;
}

describe("compareVersions", () => {
  it.each([
    ["1.0.1", "1.0.0", 1],
    ["1.0.0", "1.0.1", -1],
    ["1.10.0", "1.9.0", 1], // numeric, not lexical
    ["2.0.0", "1.99.99", 1],
    ["1.0.0", "1.0.0", 0],
    ["v1.2.0", "1.2.0", 0],
    ["1.2", "1.2.0", 0],
    ["1.0.0", "1.0.0-beta.1", 1], // release beats its prerelease
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0+build5", "1.0.0", 0],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b)!)).toBe(sign);
  });

  it("returns null when a version isn't parseable", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "")).toBeNull();
  });
});

describe("samePluginName", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(samePluginName("Talk like a Pirate", "  talk LIKE a pirate ")).toBe(true);
    expect(samePluginName("Caveman", "Caveman 2")).toBe(false);
  });
});

describe("checkInstallConflict", () => {
  const installed = [row("Pirate", "1.0.0"), row("Legacy", null)];

  it("allows a name that isn't installed", () => {
    expect(checkInstallConflict(installed, "Caveman", "1.0.0")).toEqual({ kind: "none" });
  });

  it("offers an upgrade for the same name at a newer version", () => {
    const result = checkInstallConflict(installed, "pirate", "1.1.0");
    expect(result).toMatchObject({ kind: "upgrade", existing: { id: "plugin-Pirate" } });
  });

  it.each([
    ["same version", "1.0.0"],
    ["older version", "0.9.0"],
    ["unparseable version", "banana"],
    ["missing version", null],
  ])("rejects the name for %s", (_label, version) => {
    expect(checkInstallConflict(installed, "Pirate", version).kind).toBe("name_taken");
  });

  it("rejects the name when the installed version is unknown", () => {
    expect(checkInstallConflict(installed, "Legacy", "2.0.0").kind).toBe("name_taken");
  });
});
