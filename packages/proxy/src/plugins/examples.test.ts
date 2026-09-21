import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findExamplesDir, listExamplePlugins } from "./examples.js";

function makeExample(root: string, dir: string, pkg: Record<string, unknown>, built: boolean): void {
  const packageDir = join(root, dir);
  mkdirSync(join(packageDir, "dist"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify(pkg));
  if (built) writeFileSync(join(packageDir, "dist", "index.js"), "");
}

describe("listExamplePlugins", () => {
  it("lists packages with a haai-plugin manifest, sorted by name, with local: sources", () => {
    const root = mkdtempSync(join(tmpdir(), "haai-examples-"));
    makeExample(root, "b-plugin", { main: "dist/index.js", "haai-plugin": { name: "Bravo", hooks: ["onRequest"] } }, true);
    makeExample(root, "a-plugin", { main: "dist/index.js", version: "2.0.0", description: "From pkg", "haai-plugin": { name: "Alpha" } }, false);
    makeExample(root, "not-a-plugin", { name: "plain-package" }, true);
    mkdirSync(join(root, "no-package-json"));

    const examples = listExamplePlugins(root);

    expect(examples.map((e) => e.name)).toEqual(["Alpha", "Bravo"]);
    expect(examples[0]).toMatchObject({
      id: "a-plugin",
      description: "From pkg",
      version: "2.0.0",
      source: `local:${join(root, "a-plugin")}`,
      built: false,
    });
    expect(examples[1]).toMatchObject({ hooks: ["onRequest"], built: true });
  });

  it("returns an empty list when there is no examples directory", () => {
    expect(listExamplePlugins(null)).toEqual([]);
  });
});

describe("findExamplesDir", () => {
  it("finds the repo's examples/plugins from the proxy source directory", () => {
    const dir = findExamplesDir();
    expect(dir).not.toBeNull();
    expect(listExamplePlugins(dir).map((e) => e.id)).toContain("talk-like-a-pirate");
  });
});
