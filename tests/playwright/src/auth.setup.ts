import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(resolve(dir, "../.auth/credentials.json"), "utf8")) as {
  username: string;
  password: string;
};

setup("authenticate as admin", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: resolve(dir, "../.auth/admin.json") });
});
