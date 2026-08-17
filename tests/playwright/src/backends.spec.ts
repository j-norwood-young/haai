import { test, expect } from "@playwright/test";
import { nanoid } from "nanoid";
import { playwrightCreds } from "./helpers/creds.js";

test.describe("backend CRUD", () => {
  test("creates, edits, and deletes a backend", async ({ page }) => {
    const name = `pw-be-${nanoid(6)}`;
    const renamed = `${name}-renamed`;
    const { mockUrl } = playwrightCreds();

    await page.goto("/backends/new");
    await page.fill("#backend-new-name", name);
    await page.selectOption("#backend-new-provider", "other");
    await page.fill("#backend-host", "pw-laptop");
    await page.fill("#backend-new-url", mockUrl);
    await page.getByRole("button", { name: "Add Backend" }).click();

    await expect(page).toHaveURL(/\/backends\/?$/);
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.locator("tr", { hasText: name }).getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("#backend-edit-name")).toHaveValue(name);
    await page.fill("#backend-edit-name", renamed);
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page).toHaveURL(/\/backends\/?$/);
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();

    await page.locator("tr", { hasText: renamed }).getByRole("button", { name: "Delete" }).click();
    await page.locator("tr", { hasText: renamed }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
  });
});
