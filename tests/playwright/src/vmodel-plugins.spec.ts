import { test, expect } from "@playwright/test";

const BACKENDS_COL = 6;
const PLUGINS_COL = 7;

test.describe("virtual model plugins", () => {
  test("new v-model form defers plugins until the v-model exists", async ({ page }) => {
    await page.goto("/vmodels/new");
    await expect(page.getByText("Save the v-model first")).toBeVisible();
    await expect(page.getByLabel("Plugin", { exact: true })).toHaveCount(0);
  });

  test("adds and removes plugins on the edit page and shows them on the index", async ({ page }) => {
    await page.goto("/vmodels");
    const row = page.locator("tr", { hasText: "pw-plugins-chat" });
    await expect(row.locator("td").nth(PLUGINS_COL)).toHaveText("0");

    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("No plugins bound to this v-model.")).toBeVisible();

    // A plugin without config can be added straight away.
    await page.getByLabel("Plugin", { exact: true }).selectOption({ label: "PW Plain Plugin" });
    await page.getByRole("button", { name: "Add", exact: true }).last().click();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toBeVisible();

    // A plugin with a required config field can't be added until it's filled in.
    await page.getByLabel("Plugin", { exact: true }).selectOption({ label: "PW Config Plugin" });
    const addButton = page.getByRole("button", { name: "Add", exact: true }).last();
    await expect(addButton).toBeDisabled();
    await page.fill("#cfg-greeting", "hello");
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page.getByRole("link", { name: "PW Config Plugin" })).toBeVisible();

    // Persisted: survives a reload, and bound plugins leave the picker.
    await page.reload();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toBeVisible();
    await expect(page.getByRole("link", { name: "PW Config Plugin" })).toBeVisible();
    await expect(page.getByText("All installed plugins are already added.")).toBeVisible();

    // Removing one returns it to the picker.
    await page.getByRole("button", { name: "Remove plugin PW Plain Plugin" }).click();
    await expect(page.getByRole("link", { name: "PW Plain Plugin" })).toHaveCount(0);
    await expect(page.getByLabel("Plugin", { exact: true })).toContainText("PW Plain Plugin");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page).toHaveURL(/\/vmodels\/?$/);

    // Index: the Plugins count lists the remaining plugin on hover.
    const indexRow = page.locator("tr", { hasText: "pw-plugins-chat" });
    await indexRow.locator("td").nth(PLUGINS_COL).getByText("1", { exact: true }).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Plugins");
    await expect(tooltip).toContainText("PW Config Plugin");
    await expect(tooltip).not.toContainText("PW Plain Plugin");

    // Index: the Backends count lists backend and model on hover.
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);
    await indexRow.locator("td").nth(BACKENDS_COL).getByText("1", { exact: true }).hover();
    await expect(tooltip).toContainText("Backends");
    await expect(tooltip).toContainText("pw-backend");
    await expect(tooltip).toContainText("pw-model");

    // Clean up so the spec can be re-run against the same proxy.
    await indexRow.getByRole("link", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Remove plugin PW Config Plugin" }).click();
    await expect(page.getByText("No plugins bound to this v-model.")).toBeVisible();
  });
});
