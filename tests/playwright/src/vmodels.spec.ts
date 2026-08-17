import { test, expect } from "@playwright/test";
import { nanoid } from "nanoid";

test.describe("virtual model CRUD", () => {
  test("creates, edits, and deletes a virtual model", async ({ page }) => {
    const alias = `pw-vm-${nanoid(6)}`;
    const display = `PW VModel ${alias}`;
    const renamed = `${display} Renamed`;

    await page.goto("/vmodels/new");
    await page.fill("#new-model-id", alias);
    await page.fill("#new-display-name", display);

    const backendRow = page.locator("label").filter({ hasText: "pw-backend" });
    await expect(backendRow).toBeVisible();
    await backendRow.locator("select").selectOption("pw-model");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page).toHaveURL(/\/vmodels\/?$/);
    await expect(page.getByText(alias, { exact: true })).toBeVisible();
    await expect(page.getByText(display, { exact: true })).toBeVisible();

    await page.locator("tr", { hasText: alias }).getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("#edit-model-id")).toHaveValue(alias);
    await page.fill("#edit-display-name", renamed);
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page).toHaveURL(/\/vmodels\/?$/);
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("tr", { hasText: alias }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(alias, { exact: true })).toHaveCount(0);
  });
});
