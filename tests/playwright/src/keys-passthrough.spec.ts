import { test, expect } from "@playwright/test";
import { nanoid } from "nanoid";
import { playwrightCreds } from "./helpers/creds.js";

test.describe("key with no passthroughs", () => {
  test("lists virtual models when pass-through backends are None", async ({ page }) => {
    const name = `pw-key-${nanoid(6)}`;
    const { baseURL } = playwrightCreds();

    await page.goto("/keys/new");
    await page.fill("#new-key-name", name);

    await page.getByText("Pass-through backends", { exact: true }).locator("xpath=..").getByRole("button", { name: "None" }).click();

    await page.getByRole("button", { name: "Create Key" }).click();
    await expect(page.getByText(/Key created/)).toBeVisible();

    const keyText = await page.locator("code").filter({ hasText: "haai-sk-" }).first().textContent();
    expect(keyText).toMatch(/^haai-sk-/);

    const res = await page.request.get(`${baseURL}/v1/models`, {
      headers: { Authorization: `Bearer ${keyText?.trim()}` },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("pw-chat");
    expect(ids.some((id) => id.includes("pw-host"))).toBe(false);
  });
});
