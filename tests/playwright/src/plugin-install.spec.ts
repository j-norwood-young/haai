import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

/** Write a minimal installable plugin package and return its `local:` source */
function makePlugin(root: string, dir: string, name: string, version: string): string {
  const packageDir = join(root, dir);
  mkdirSync(join(packageDir, "dist"), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: dir,
      type: "module",
      main: "dist/index.js",
      "haai-plugin": { name, version, hooks: ["onRequest"] },
    }),
  );
  writeFileSync(join(packageDir, "dist", "index.js"), "export default { hooks: {} };");
  return `local:${packageDir}`;
}

test.describe("install plugin: unique names and upgrades", () => {
  let root: string;
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright, baseURL }, testInfo) => {
    root = mkdtempSync(join(tmpdir(), "haai-pw-plugins-"));
    api = await playwright.request.newContext({
      baseURL: baseURL!,
      storageState: testInfo.project.use.storageState as string,
    });
  });

  // The proxy instance is shared with other specs (e.g. vmodel-plugins expects a fixed plugin set),
  // so remove everything installed here. Deleting a plugin cascades to its bindings.
  test.afterAll(async () => {
    const plugins = (await (await api.get("/api/v1/plugins")).json()) as Array<{ id: string; name: string }>;
    for (const plugin of plugins.filter((p) => p.name.startsWith("PW Install:"))) {
      await api.delete(`/api/v1/plugins/${plugin.id}`);
    }
    await api.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  test("asks for a different name when the plugin is already installed", async ({ page }) => {
    const source = makePlugin(root, "dup-1", "PW Install: Duplicate", "1.0.0");

    await page.goto("/plugins/install");
    await page.getByLabel("Source").fill(source);
    await page.getByRole("button", { name: "Install Plugin" }).click();
    await expect(page).toHaveURL(/\/plugins\/plugin-/);

    await page.goto("/plugins/install");
    await page.getByLabel("Source").fill(source);
    await page.getByRole("button", { name: "Install Plugin" }).click();

    const nameField = page.getByLabel(/Name override/);
    await expect(page.getByText(/already installed\. Choose a different name/)).toBeVisible();
    await expect(nameField).toBeFocused();
    await expect(page).toHaveURL(/\/plugins\/install/);

    // Choosing a different name installs it alongside the original
    await nameField.fill("PW Install: Duplicate (copy)");
    await expect(page.getByText(/Choose a different name/)).toHaveCount(0);
    await page.getByRole("button", { name: "Install Plugin" }).click();
    await expect(page).toHaveURL(/\/plugins\/plugin-/);
  });

  test("confirms before upgrading to a newer version", async ({ page }) => {
    const v1 = makePlugin(root, "up-1", "PW Install: Upgrade", "1.0.0");
    const v2 = makePlugin(root, "up-2", "PW Install: Upgrade", "1.1.0");

    await page.goto("/plugins/install");
    await page.getByLabel("Source").fill(v1);
    await page.getByRole("button", { name: "Install Plugin" }).click();
    await expect(page).toHaveURL(/\/plugins\/plugin-/);
    const originalUrl = page.url();

    await page.goto("/plugins/install");
    await page.getByLabel("Source").fill(v2);
    await page.getByRole("button", { name: "Install Plugin" }).click();

    const dialog = page.getByRole("dialog", { name: "Upgrade plugin?" });
    await expect(dialog).toContainText("PW Install: Upgrade");
    await expect(dialog).toContainText("v1.0.0");
    await expect(dialog).toContainText("v1.1.0");

    // Cancelling leaves things as they were
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/plugins\/install/);

    // Confirming upgrades the existing plugin in place (same ID)
    await page.getByRole("button", { name: "Install Plugin" }).click();
    await page.getByRole("dialog", { name: "Upgrade plugin?" }).getByRole("button", { name: "Upgrade" }).click();
    await expect(page).toHaveURL(originalUrl);
  });

  test("shows each plugin's bindings on the Plugins index as a count with a hover list", async ({ page }) => {
    const source = makePlugin(root, "bound-1", "PW Install: Bound", "1.0.0");
    const created = await api.post("/api/v1/plugins", { data: { source } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await page.goto("/plugins");
    const row = page.locator("tr", { hasText: "PW Install: Bound" });
    const bindingsCell = row.locator("td").nth(3);
    await expect(bindingsCell).toHaveText("0");

    const bound = await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "global" } });
    expect(bound.ok()).toBe(true);
    await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "vmodel", scopeId: "does-not-exist" } });

    await page.reload();
    await expect(bindingsCell).toHaveText("2");
    await bindingsCell.getByText("2", { exact: true }).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Bindings");
    await expect(tooltip).toContainText("Global");
    // A scope that can't be resolved to a name falls back to its ID rather than disappearing
    await expect(tooltip).toContainText("V-Model: does-not-exist");

    // However many bindings there are, the cell stays a single number
    for (const scopeId of ["a", "b", "c", "d", "e"]) {
      await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "vmodel", scopeId } });
    }
    await page.reload();
    await expect(bindingsCell).toHaveText("7");
    // (the column is sized by its header, so this would be far wider if it were listing chips)
    expect((await bindingsCell.boundingBox())!.width).toBeLessThan(200);

    // The row action matches the other index pages
    await expect(row.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/plugins/${id}`);
  });

  test("the plugin page's scope picker only offers scopes the plugin isn't bound to yet", async ({ page }) => {
    const source = makePlugin(root, "picker-1", "PW Install: Picker", "1.0.0");
    const created = await api.post("/api/v1/plugins", { data: { source } });
    const { id } = (await created.json()) as { id: string };

    const vmodels = (await (await api.get("/api/v1/vmodels")).json()) as Array<{ id: string; modelId: string; displayName: string }>;
    const bound = vmodels.find((v) => v.modelId === "pw-plugins-chat")!;
    expect((await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "vmodel", scopeId: bound.id } })).status()).toBe(201);
    expect((await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "global" } })).status()).toBe(201);

    // The server refuses a duplicate outright, whatever the UI offers
    const dup = await api.post(`/api/v1/plugins/${id}/bindings`, { data: { scopeType: "vmodel", scopeId: bound.id } });
    expect(dup.status()).toBe(409);

    await page.goto(`/plugins/${id}`);
    await page.getByRole("button", { name: "V-Model", exact: true }).click();
    const options = page.locator("#new-scope-vmodel option");
    await expect(options.first()).toBeAttached();
    await expect(options.filter({ hasText: bound.displayName })).toHaveCount(0);

    await page.getByRole("button", { name: "Global", exact: true }).click();
    await expect(page.getByText("Already bound globally.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Binding" })).toBeDisabled();
  });
});
