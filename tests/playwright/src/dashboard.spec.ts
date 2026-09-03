import { test, expect } from "@playwright/test";

test.describe("dashboard live operations", () => {
  test("renders all dashboard sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await expect(page.getByTestId("live-status-strip")).toBeVisible();
    await expect(page.getByTestId("kpi-requests")).toBeVisible();
    await expect(page.getByTestId("live-throughput")).toBeVisible();
    await expect(page.getByTestId("active-requests")).toBeVisible();
    await expect(page.getByTestId("backend-fleet")).toBeVisible();
    await expect(page.getByTestId("perf-breakdown")).toBeVisible();
    await expect(page.getByTestId("request-volume")).toBeVisible();
    await expect(page.getByTestId("recent-errors")).toBeVisible();
  });

  test("window toggle changes KPI label text", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("kpi-card-requests")).toBeVisible();

    const label = page.getByTestId("kpi-card-requests").locator("p").first();
    await expect(label).toContainText(/· 24h/);

    await page.getByTestId("window-1h").click();
    await expect(label).toContainText(/· 1h/);

    await page.getByTestId("window-6h").click();
    await expect(label).toContainText(/· 6h/);

    await page.getByTestId("window-24h").click();
    await expect(label).toContainText(/· 24h/);
  });

  test("breakdown tab switch updates table", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("perf-breakdown")).toBeVisible();

    await page.getByRole("tab", { name: "Virtual Models" }).click();
    await expect(page.getByRole("tab", { name: "Virtual Models" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.getByRole("tab", { name: "Backend Models" }).click();
    await expect(page.getByRole("tab", { name: "Backend Models" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.getByRole("tab", { name: "Backends" }).click();
    await expect(page.getByRole("tab", { name: "Backends" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("backend fleet card Metrics link deep-links into analytics", async ({ page }) => {
    await page.goto("/");
    const fleet = page.getByTestId("backend-fleet");

    const metricsLink = fleet.locator('a[href^="/analytics?backendId="]').first();
    await expect(metricsLink).toBeVisible();
    await metricsLink.click();

    await expect(page).toHaveURL(/\/analytics\?backendId=/);
    await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  });
});
