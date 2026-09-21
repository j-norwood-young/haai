import { test, expect, type Locator, type Page } from "@playwright/test";
import { nanoid } from "nanoid";

// A non-UTC zone catches datetime-local values that are shifted by the UTC offset on load/save.
test.use({ timezoneId: "America/New_York" });

type Mode = "All" | "Specific" | "None";

function picker(page: Page, heading: "Virtual models" | "Pass-through backends"): Locator {
  return page.getByText(heading, { exact: true }).locator("xpath=..").locator("xpath=..");
}

async function setMode(page: Page, heading: "Virtual models" | "Pass-through backends", mode: Mode) {
  await picker(page, heading).getByRole("button", { name: mode, exact: true }).click();
}

async function expectMode(page: Page, heading: "Virtual models" | "Pass-through backends", mode: Mode) {
  const modes: Mode[] = ["All", "Specific", "None"];
  for (const m of modes) {
    const button = picker(page, heading).getByRole("button", { name: m, exact: true });
    if (m === mode) await expect(button, `${heading}: ${m} active`).toHaveClass(/bg-gray-700/);
    else await expect(button, `${heading}: ${m} inactive`).not.toHaveClass(/bg-gray-700/);
  }
}

async function createKey(
  page: Page,
  name: string,
  fill: (page: Page) => Promise<void> = async () => {},
) {
  await page.goto("/keys/new");
  await page.fill("#new-key-name", name);
  // Wait for both pickers to finish loading before interacting.
  await expect(picker(page, "Virtual models").getByRole("button", { name: "All" })).toBeVisible();
  await expect(picker(page, "Pass-through backends").getByRole("button", { name: "All" })).toBeVisible();
  await fill(page);
  await page.getByRole("button", { name: "Create Key" }).click();
  await expect(page.getByText(/Key created/)).toBeVisible();
}

async function openEdit(page: Page, name: string) {
  await page.goto("/keys");
  await page.locator("tr", { hasText: name }).getByRole("link", { name: "Edit" }).click();
  await expect(page.locator("#edit-key-name")).toHaveValue(name);
  await expect(picker(page, "Virtual models").getByRole("button", { name: "All" })).toBeVisible();
  await expect(picker(page, "Pass-through backends").getByRole("button", { name: "All" })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page).toHaveURL(/\/keys\/?$/);
}

test.describe("API key edit form persists settings", () => {
  test("pass-through backends = None survives opening and saving the edit form", async ({ page }) => {
    const name = `pw-none-${nanoid(6)}`;
    await createKey(page, name, (p) => setMode(p, "Pass-through backends", "None"));

    await openEdit(page, name);
    await expectMode(page, "Pass-through backends", "None");
    await expectMode(page, "Virtual models", "All");

    // Saving without touching the picker must not silently widen access to "All".
    await page.fill("#edit-key-name", `${name}-renamed`);
    await save(page);

    await openEdit(page, `${name}-renamed`);
    await expectMode(page, "Pass-through backends", "None");
    await expectMode(page, "Virtual models", "All");
  });

  test("v-models = None survives opening and saving the edit form", async ({ page }) => {
    const name = `pw-vmnone-${nanoid(6)}`;
    await createKey(page, name, (p) => setMode(p, "Virtual models", "None"));

    await openEdit(page, name);
    await expectMode(page, "Virtual models", "None");
    await expectMode(page, "Pass-through backends", "All");
    await save(page);

    await openEdit(page, name);
    await expectMode(page, "Virtual models", "None");
    await expectMode(page, "Pass-through backends", "All");
  });

  test("every setting round-trips through create → edit → save → edit", async ({ page }) => {
    const name = `pw-all-${nanoid(6)}`;

    await createKey(page, name, async (p) => {
      await p.fill("#new-rpm-limit", "30");
      await p.fill("#new-day-budget", "12.5");
      await p.fill("#new-expires", "2031-06-15T13:45");

      await setMode(p, "Virtual models", "Specific");
      // "Specific" pre-selects every v-model; narrow it to pw-chat only. (Unchecking the last
      // selection would flip the picker to "None", so leave pw-chat checked throughout.)
      for (const label of await picker(p, "Virtual models").locator("label").all()) {
        if (!(await label.innerText()).includes("pw-chat")) await label.getByRole("checkbox").uncheck();
      }

      await setMode(p, "Pass-through backends", "Specific");
    });

    // --- Created values load back exactly ---
    await openEdit(page, name);
    await expect(page.locator("#edit-rpm-limit")).toHaveValue("30");
    await expect(page.locator("#edit-day-budget")).toHaveValue("12.5");
    await expect(page.locator("#edit-expires")).toHaveValue("2031-06-15T13:45");
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expectMode(page, "Virtual models", "Specific");
    await expect(picker(page, "Virtual models").getByRole("checkbox", { checked: true })).toHaveCount(1);
    await expect(page.locator("label", { hasText: "pw-chat" }).getByRole("checkbox")).toBeChecked();
    await expectMode(page, "Pass-through backends", "Specific");
    await expect(page.locator("label", { hasText: "pw-backend" }).getByRole("checkbox")).toBeChecked();

    // Saving untouched must be a no-op (no drift, e.g. timezone shift on expiry).
    await save(page);
    await openEdit(page, name);
    await expect(page.locator("#edit-rpm-limit")).toHaveValue("30");
    await expect(page.locator("#edit-day-budget")).toHaveValue("12.5");
    await expect(page.locator("#edit-expires")).toHaveValue("2031-06-15T13:45");
    await expectMode(page, "Virtual models", "Specific");
    await expectMode(page, "Pass-through backends", "Specific");

    // --- Change every setting ---
    const renamed = `${name}-2`;
    await page.fill("#edit-key-name", renamed);
    await page.fill("#edit-rpm-limit", "99");
    await page.fill("#edit-day-budget", "3.25");
    await page.fill("#edit-expires", "2032-01-02T03:04");
    await page.getByRole("switch").click();
    await setMode(page, "Virtual models", "All");
    await setMode(page, "Pass-through backends", "None");
    await save(page);

    await openEdit(page, renamed);
    await expect(page.locator("#edit-rpm-limit")).toHaveValue("99");
    await expect(page.locator("#edit-day-budget")).toHaveValue("3.25");
    await expect(page.locator("#edit-expires")).toHaveValue("2032-01-02T03:04");
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await expectMode(page, "Virtual models", "All");
    await expectMode(page, "Pass-through backends", "None");

    // --- Clear optional limits, flip the access lists the other way ---
    await page.fill("#edit-rpm-limit", "");
    await page.fill("#edit-day-budget", "");
    await page.fill("#edit-expires", "");
    await page.getByRole("switch").click();
    await setMode(page, "Virtual models", "None");
    await setMode(page, "Pass-through backends", "All");
    await save(page);

    await openEdit(page, renamed);
    await expect(page.locator("#edit-rpm-limit")).toHaveValue("");
    await expect(page.locator("#edit-day-budget")).toHaveValue("");
    await expect(page.locator("#edit-expires")).toHaveValue("");
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expectMode(page, "Virtual models", "None");
    await expectMode(page, "Pass-through backends", "All");
  });
});
