import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * The shared ScopedPlugins component on the key and backend edit pages (the v-model page is
 * covered by vmodel-plugins.spec.ts). Uses the plugins seeded in global-setup.
 */
test.describe("plugins on key and backend edit pages", () => {
  let api: APIRequestContext;
  const created: Array<{ path: string; id: string }> = [];

  test.beforeAll(async ({ playwright, baseURL }, testInfo) => {
    api = await playwright.request.newContext({
      baseURL: baseURL!,
      storageState: testInfo.project.use.storageState as string,
    });
  });

  // Deleting the key/backend also removes its plugin bindings, leaving the shared instance clean.
  test.afterAll(async () => {
    for (const { path, id } of created) await api.delete(`${path}/${id}`);
    await api.dispose();
  });

  /** The Plugins count cell of an index row, found by its column header */
  async function pluginsCell(page: Page, indexUrl: string, rowText: string): Promise<Locator> {
    await page.goto(indexUrl);
    await expect(page.locator("tr", { hasText: rowText })).toBeVisible(); // table has loaded
    const headers = await page.locator("th").allInnerTexts();
    const col = headers.findIndex((h) => h.trim().toLowerCase() === "plugins");
    expect(col, `Plugins column on ${indexUrl}`).toBeGreaterThan(-1);
    return page.locator("tr", { hasText: rowText }).locator("td").nth(col);
  }

  async function exercise(page: Page, editUrl: string, noun: string, index: { url: string; rowText: string }) {
    await page.goto(editUrl);
    await expect(page.getByText(`No plugins bound to this ${noun}.`)).toBeVisible();

    // A plugin without config can be added straight away
    await page.getByLabel("Plugin", { exact: true }).selectOption({ label: "PW Plain Plugin" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toBeVisible();

    // A plugin with a required config field can't be added until it's filled in
    await page.getByLabel("Plugin", { exact: true }).selectOption({ label: "PW Config Plugin" });
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();

    // The index page counts it, and lists it on hover
    const cell = await pluginsCell(page, index.url, index.rowText);
    await expect(cell).toHaveText("1");
    await cell.getByText("1", { exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("PW Plain Plugin");
    await page.mouse.move(0, 0);

    // Persisted across a reload, and the bound plugin leaves the picker
    await page.goto(editUrl);
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toBeVisible();
    await expect(page.getByLabel("Plugin", { exact: true }).getByRole("option", { name: "PW Plain Plugin" })).toHaveCount(0);

    await page.getByRole("button", { name: "Remove plugin PW Plain Plugin" }).click();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(`No plugins bound to this ${noun}.`)).toBeVisible();
    await expect(await pluginsCell(page, index.url, index.rowText)).toHaveText("0");
  }

  test("adds and removes plugins on an API key", async ({ page }) => {
    const res = await api.post("/api/v1/keys", { data: { name: "pw-scoped-plugins-key" } });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    created.push({ path: "/api/v1/keys", id });

    await exercise(page, `/keys/${id}/edit`, "API key", { url: "/keys", rowText: "pw-scoped-plugins-key" });
  });

  test("adds and removes plugins on a backend", async ({ page }) => {
    const res = await api.post("/api/v1/backends", {
      data: { name: "pw-scoped-plugins-be", hostName: "pw-scoped-plugins-host", provider: "generic", baseUrl: "http://127.0.0.1:9" },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    created.push({ path: "/api/v1/backends", id });

    await exercise(page, `/backends/${id}/edit`, "backend", { url: "/backends", rowText: "pw-scoped-plugins-be" });
  });

  test("a binding made on the edit page shows up on the Plugins index, and disappears with its key", async ({ page }) => {
    const res = await api.post("/api/v1/keys", { data: { name: "pw-scoped-plugins-key-2" } });
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/keys/${id}/edit`);
    await page.getByLabel("Plugin", { exact: true }).selectOption({ label: "PW Plain Plugin" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toBeVisible();

    await page.goto("/plugins");
    const bindingsCell = page.locator("tr", { hasText: "PW Plain Plugin" }).locator("td").nth(3);
    await expect(bindingsCell).toHaveText("1");
    await bindingsCell.getByText("1", { exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Key: pw-scoped-plugins-key-2");

    await api.delete(`/api/v1/keys/${id}`);
    await page.reload();
    await expect(bindingsCell).toHaveText("0");
  });
});
